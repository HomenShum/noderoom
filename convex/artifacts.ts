/**
 * The backend for the read_range / edit_cell tools.
 *
 * `applyCellEdit` is the single most important function in the whole system: it
 * is the application-level CAS that makes "no silent clobber" true. Convex's
 * built-in OCC will RETRY a transaction that loses a write race, but it will
 * happily commit a write whose BASELINE is stale — that's the clobber. The
 * `version` check below rejects a stale write and returns the conflict as DATA
 * (not a thrown error), which the agent runtime feeds back to the model so it
 * re-reads and retries. Same function backs hand-edits from the UI.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, actorV, getElement, activeLockOn, requireActorInRoom, requireActorProof, requireArtifactInRoom, type ActorValue } from "./lib";
import { syncSpreadsheetIndexFromDb, syncSpreadsheetIndexFromSeed } from "./spreadsheetIndexLib";

const MAX_ARTIFACT_TITLE_CHARS = 180;
const MAX_ARTIFACT_SEED_ELEMENTS = 20_000;
const MAX_ARTIFACT_SEED_BYTES = 5_000_000;
const MAX_ELEMENT_ID_CHARS = 160;

function assertCreateArtifactLimits(a: { title: string; seed: Array<{ id: string; value: unknown }>; meta?: unknown }) {
  if (a.title.length > MAX_ARTIFACT_TITLE_CHARS) throw new Error("Artifact title is too long.");
  if (a.seed.length > MAX_ARTIFACT_SEED_ELEMENTS) throw new Error("Artifact seed has too many elements for one mutation.");
  const ids = new Set<string>();
  for (const s of a.seed) {
    if (!s.id || s.id.length > MAX_ELEMENT_ID_CHARS) throw new Error("Artifact seed contains an invalid element id.");
    if (ids.has(s.id)) throw new Error(`Artifact seed contains duplicate element id: ${s.id}`);
    ids.add(s.id);
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ seed: a.seed, meta: a.meta ?? null })).byteLength;
  if (bytes > MAX_ARTIFACT_SEED_BYTES) throw new Error("Artifact seed payload is too large for one mutation.");
}

function displayValue(value: unknown): string {
  const raw = value && typeof value === "object" && "value" in value ? (value as { value?: unknown }).value : value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

/** read_range tool — returns values + versions + lock flags. Works on locked cells. */
export const readRange = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), elementIds: v.array(v.string()) },
  handler: async (ctx, { roomId, artifactId, elementIds }) => {
    await requireArtifactInRoom(ctx, roomId, artifactId);
    const out = [];
    for (const id of elementIds) {
      const el = await getElement(ctx, artifactId, id);
      const lock = await activeLockOn(ctx, artifactId, id);
      out.push({ id, value: el?.value ?? null, version: el?.version ?? 0, locked: lock ? { by: lock.holder.name, reason: lock.reason } : null });
    }
    return out;
  },
});

export const searchSheetContext = internalQuery({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, artifactId, query, limit }) => {
    await requireArtifactInRoom(ctx, roomId, artifactId);
    const capped = Math.max(1, Math.min(limit ?? 8, 20));
    const terms = query.toLowerCase().split(/[^a-z0-9$%._-]+/).filter(Boolean);
    if (!terms.length) return [];
    const cells = await ctx.db.query("spreadsheetCells").withIndex("by_artifact_element", (q) => q.eq("artifactId", artifactId)).collect();
    const chunks = await ctx.db.query("spreadsheetChunks").withIndex("by_artifact_chunk", (q) => q.eq("artifactId", artifactId)).collect();
    const cellHits = cells.map((cell) => ({
      kind: "cell" as const,
      elementId: cell.elementId,
      coordinate: cell.coordinate,
      rowHeader: cell.rowHeader,
      columnHeader: cell.columnHeader,
      rawValue: cell.rawValue,
      semanticSummary: cell.semanticSummary,
      score: scoreText(cell.semanticSummary, terms),
    }));
    const chunkHits = chunks.map((chunk) => ({
      kind: "chunk" as const,
      chunkId: chunk.chunkId,
      elementIds: chunk.elementIds,
      text: chunk.text,
      score: scoreText(chunk.text, terms),
    }));
    return [...cellHits, ...chunkHits].filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, capped);
  },
});

/** snapshot for the agent's context + the UI grid. */
export const getSheet = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts") },
  handler: async (ctx, { roomId, artifactId }) => {
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    const byId = new Map(els.map((e) => [e.elementId, e]));
    const lockedSet = new Set<string>();
    const locks = await ctx.db.query("locks").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "active")).collect();
    for (const l of locks) for (const id of l.elementIds) lockedSet.add(id);
    const rowIds: string[] = [];
    for (const e of art.order) { const r = e.split("__")[0]; if (!rowIds.includes(r)) rowIds.push(r); }
    const cell = (rid: string, c: string) => displayValue(byId.get(`${rid}__${c}`)?.value);
    const rows = rowIds.map((rid) => {
      const cells: Record<string, { value: string; version: number; locked: boolean }> = {};
      for (const e of els) {
        if (!e.elementId.startsWith(`${rid}__`)) continue;
        cells[e.elementId.slice(rid.length + 2)] = { value: displayValue(e.value), version: e.version, locked: lockedSet.has(e.elementId) };
      }
      return {
        rowId: rid, label: cell(rid, "label"), q2: cell(rid, "q2"), q3: cell(rid, "q3"),
        variance: cell(rid, "variance"), note: cell(rid, "note"),
        varianceVersion: byId.get(`${rid}__variance`)?.version ?? 0,
        locked: lockedSet.has(`${rid}__variance`),
        cells,
      };
    });
    return { artifactId, version: art.version, kind: art.kind, rows };
  },
});

type ApplyCellEditArgs = {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  elementId: string;
  kind?: "set" | "create" | "delete";
  value: unknown;
  baseVersion: number;
  actor: ActorValue;
  jobId?: Id<"agentJobs">;
  runId?: Id<"agentRuns">;
};

type ProposalOp = {
  opId: string;
  artifactId: string;
  elementId: string;
  kind: "set" | "create" | "delete";
  value: unknown;
  baseVersion: number;
};

function parseProposalOp(op: unknown): ProposalOp {
  const o = op as Partial<ProposalOp> | null;
  if (!o || typeof o.opId !== "string" || typeof o.artifactId !== "string" || typeof o.elementId !== "string" || !["set", "create", "delete"].includes(String(o.kind)) || typeof o.baseVersion !== "number") {
    throw new Error("invalid_proposal_op");
  }
  return { opId: o.opId, artifactId: o.artifactId, elementId: o.elementId, kind: o.kind as ProposalOp["kind"], value: o.value, baseVersion: o.baseVersion };
}

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = canonical((value as Record<string, unknown>)[key]);
    return acc;
  }, {});
}

async function applyApprovedProposal(ctx: MutationCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts">, op: ProposalOp, author: ActorValue) {
  if (String(op.artifactId) !== String(artifactId)) throw new Error("proposal_artifact_mismatch");
  const art = await requireArtifactInRoom(ctx, roomId, artifactId);
  const el = await getElement(ctx, artifactId, op.elementId);
  const actual = el?.version ?? 0;
  if (actual !== op.baseVersion) {
    return { ok: false as const, reason: "conflict" as const, expected: op.baseVersion, actual };
  }
  const now = Date.now();
  if (el) await ctx.db.patch(el._id, { value: op.value, version: actual + 1, updatedAt: now, updatedBy: author });
  else await ctx.db.insert("elements", { artifactId, elementId: op.elementId, value: op.value, version: 1, updatedAt: now, updatedBy: author });
  await ctx.db.patch(artifactId, { version: art.version + 1, updatedAt: now });
  await ctx.db.insert("traces", { roomId, ts: now, actor: author, type: "edit_applied", summary: `${author.name} set ${op.elementId} = ${String(op.value)}`, detail: `edit_cell · ${op.elementId} = ${String(op.value)} · v${actual} -> v${actual + 1}` });
  return { ok: true as const, version: actual + 1 };
}

async function applyCellEditCore(ctx: MutationCtx, a: ApplyCellEditArgs) {
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const job = a.jobId ? await ctx.db.get(a.jobId) : null;
    if (a.jobId && (!job || String(job.roomId) !== String(a.roomId))) throw new Error("job_room_mismatch");
    const kind = a.kind ?? "set";
    // 1. LOCK gate — a held range is read-only for non-holders.
    const lock = await activeLockOn(ctx, a.artifactId, a.elementId);
    if (lock && lock.holder.id !== a.actor.id) {
      return { ok: false as const, reason: "locked" as const, by: lock.holder.name };
    }
    // 2. CAS gate — reject a stale baseline (this is the anti-clobber check).
    const el = await getElement(ctx, a.artifactId, a.elementId);
    const actual = el?.version ?? 0;
    if (actual !== a.baseVersion) {
      return { ok: false as const, reason: "conflict" as const, expected: a.baseVersion, actual };
    }
    const room = await ctx.db.get(a.roomId);
    if (a.actor.kind === "agent" && room && !room.autoAllow) {
      const proposalId = await ctx.db.insert("proposals", {
        roomId: a.roomId,
        artifactId: a.artifactId,
        op: { opId: `proposal_${a.elementId}_${Date.now()}`, artifactId: String(a.artifactId), elementId: a.elementId, kind, value: a.value, baseVersion: a.baseVersion },
        author: a.actor,
        status: "pending",
        createdAt: Date.now(),
      });
      return { ok: false as const, reason: "pending_approval" as const, proposalId };
    }
    // 3. APPLY — bump the per-element version + the artifact clock.
    const now = Date.now();
    const nextOrder = kind === "create" && !el ? [...art.order, a.elementId] : kind === "delete" ? art.order.filter((id) => id !== a.elementId) : art.order;
    if (kind === "delete") {
      if (el) await ctx.db.delete(el._id);
    } else if (el) {
      await ctx.db.patch(el._id, { value: a.value, version: actual + 1, updatedAt: now, updatedBy: a.actor });
    } else {
      await ctx.db.insert("elements", { artifactId: a.artifactId, elementId: a.elementId, value: a.value, version: 1, updatedAt: now, updatedBy: a.actor });
    }
    await ctx.db.patch(a.artifactId, { version: art.version + 1, updatedAt: now, order: nextOrder });
    await syncSpreadsheetIndexFromDb(ctx, art);
    const nextVersion = kind === "delete" ? actual : actual + 1;
    // 4. TRACE — every applied edit is auditable.
    await ctx.db.insert("traces", { roomId: art.roomId, ts: now, actor: a.actor, type: "edit_applied", summary: `${a.actor.name} set ${a.elementId} = ${String(a.value)}`, detail: `edit_cell · ${a.elementId} = ${String(a.value)} · v${actual} → v${actual + 1}` });
    let mutationReceiptId: Id<"agentMutationReceipts"> | undefined;
    if (a.jobId && job) {
      mutationReceiptId = await ctx.db.insert("agentMutationReceipts", clean({
        jobId: a.jobId,
        runId: a.runId,
        mutationName: "artifacts.applyAgentCellEdit",
        permission: a.actor.kind === "agent" ? "agent_session" : "actor_proof",
        inputHash: await sha256hex(JSON.stringify(canonical({
          roomId: String(a.roomId),
          artifactId: String(a.artifactId),
          elementId: a.elementId,
          kind,
          value: a.value,
          baseVersion: a.baseVersion,
        }))),
        output: { ok: true, version: nextVersion },
        affectedIds: [String(a.artifactId), `${String(a.artifactId)}:${a.elementId}`],
        beforeVersions: { [a.elementId]: actual },
        afterVersions: { [a.elementId]: kind === "delete" ? null : nextVersion },
        createdAt: now,
      }));
      await ctx.db.patch(a.jobId, {
        mutationCount: (job.mutationCount ?? 0) + 1,
        receiptCount: (job.receiptCount ?? 0) + 1,
        updatedAt: now,
      });
    }
    return clean({ ok: true as const, version: nextVersion, mutationReceiptId });
}

/** UI hand-edit path — token-bound user proof plus the same CAS write. */
export const applyCellEdit = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    kind: v.optional(v.union(v.literal("set"), v.literal("create"), v.literal("delete"))),
    value: v.any(),
    baseVersion: v.number(),
    proof: actorProofV,
  },
  handler: async (ctx, a) => applyCellEditCore(ctx, { ...a, actor: await requireActorProof(ctx, a.roomId, a.proof) }),
});

/** Agent tool path — callable only from Convex actions through `internal`. */
/** List the room's artifacts (id/title/kind) — the multi-artifact tool layer's cross-file reach.
 *  internalQuery: called server-side by ConvexRoomTools inside an already-authorized agent action. */
export const listForRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const arts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    return arts.map((a) => ({ id: String(a._id), title: a.title, kind: a.kind }));
  },
});

export const listProposals = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const rows = await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect();
    return rows.map((p) => ({
      id: String(p._id),
      roomId: String(p.roomId),
      artifactId: String(p.artifactId),
      op: p.op,
      author: p.author,
      status: p.status,
      createdAt: p.createdAt,
    }));
  },
});

export const resolveProposal = mutation({
  args: { proposalId: v.id("proposals"), approve: v.boolean(), requester: actorProofV },
  handler: async (ctx, { proposalId, approve, requester }) => {
    const proposal = await ctx.db.get(proposalId);
    if (!proposal) return { ok: false as const, reason: "not_found" as const };
    const actor = await requireActorProof(ctx, proposal.roomId, requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (member?.role !== "host") throw new Error("host_required");
    if (proposal.status !== "pending") return { ok: false as const, reason: "not_pending" as const };

    const now = Date.now();
    await ctx.db.patch(proposalId, { status: approve ? "approved" : "rejected", resolvedAt: now });
    const result = approve ? await applyApprovedProposal(ctx, proposal.roomId, proposal.artifactId, parseProposalOp(proposal.op), proposal.author as ActorValue) : null;
    await ctx.db.insert("traces", {
      roomId: proposal.roomId,
      ts: now,
      actor,
      type: "proposal_resolved",
      summary: `${actor.name} ${approve ? "approved" : "rejected"} ${proposal.author.name}'s edit`,
      detail: `proposal ${String(proposalId)} · ${approve ? "approved" : "rejected"}${result && !result.ok ? ` · ${result.reason}` : ""}`,
    });
    return result ?? { ok: true as const, rejected: true as const };
  },
});

const researchRowInputV = v.object({
  company: v.string(),
  website: v.optional(v.string()),
  tier: v.optional(v.string()),
  intent: v.optional(v.string()),
  owner: v.optional(v.string()),
  crmStatus: v.optional(v.string()),
});
const researchCols = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
function slugResearchRow(company: string) {
  const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return base ? `rc_${base}` : `rc_company`;
}
function defaultWebsite(company: string) {
  const host = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return host ? `https://www.${host}.com` : "";
}

export const addResearchRows = mutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), rows: v.array(researchRowInputV), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, rows, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    const now = Date.now();
    const nextOrder = [...art.order];
    const added: string[] = [];
    for (const row of rows) {
      const company = row.company.trim();
      if (!company) continue;
      const base = slugResearchRow(company);
      let rowId = base, suffix = 1;
      while (nextOrder.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
      const vals: Record<(typeof researchCols)[number], string> = {
        company,
        website: row.website?.trim() || defaultWebsite(company),
        status: "pending",
        tier: row.tier?.trim() || "B",
        intent: row.intent?.trim() ?? "",
        owner: row.owner?.trim() || actor.name,
        crm_status: row.crmStatus?.trim() || "Research",
        summary: "",
        funding: "",
        headcount: "",
        recent_signal: "",
        source: "",
        source2: "",
        last_researched: "",
      };
      for (const col of researchCols) {
        const elementId = `${rowId}__${col}`;
        nextOrder.push(elementId);
        await ctx.db.insert("elements", { artifactId, elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: actor });
      }
      added.push(rowId);
    }
    if (added.length) {
      await ctx.db.patch(artifactId, { order: nextOrder, version: art.version + 1, updatedAt: now });
      await ctx.db.insert("traces", { roomId, ts: now, actor, type: "edit_applied", summary: `${actor.name} added ${added.length} research row(s)`, detail: `add_research_rows ${added.join(", ")}` });
    }
    return added;
  },
});

export const applyAgentCellEdit = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    value: v.any(),
    baseVersion: v.number(),
    actor: actorV,
    jobId: v.optional(v.id("agentJobs")),
    runId: v.optional(v.id("agentRuns")),
  },
  handler: applyCellEditCore,
});

/** Seed an artifact + its elements (used once per room). */
export const createArtifact = mutation({
  args: {
    roomId: v.id("rooms"),
    kind: v.union(v.literal("sheet"), v.literal("note"), v.literal("wall")),
    title: v.string(),
    seed: v.array(v.object({ id: v.string(), value: v.any() })),
    meta: v.optional(v.any()),
    proof: actorProofV,
  },
  handler: async (ctx, a) => {
    const by = await requireActorProof(ctx, a.roomId, a.proof);
    assertCreateArtifactLimits(a);
    const now = Date.now();
    const artifactId = await ctx.db.insert("artifacts", { roomId: a.roomId, kind: a.kind, title: a.title, version: 1, order: a.seed.map((s) => s.id), updatedAt: now, meta: a.meta });
    for (const s of a.seed) await ctx.db.insert("elements", { artifactId, elementId: s.id, value: s.value, version: 1, updatedAt: now, updatedBy: by });
    await syncSpreadsheetIndexFromSeed(ctx, { artifactId, title: a.title, kind: a.kind, meta: a.meta, seed: a.seed, now });
    await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor: by, type: "edit_applied", summary: `${by.name} added ${a.title}`, detail: `create_artifact · ${a.kind} · ${String(artifactId)}` });
    return artifactId;
  },
});
