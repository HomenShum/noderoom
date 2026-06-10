/**
 * RoomStore — the seam between the UI and its data source.
 *
 * The presentational components (Chat, Artifact, LeftRail, RoomShell) call
 * `useStore()` and never touch the engine or Convex directly. Two providers
 * satisfy the same interface:
 *   - EngineStoreProvider — the in-memory RoomEngine (no keys; the demo).
 *   - ConvexStoreProvider — live Convex (reactive useQuery + optimistic mutations).
 * App picks the provider based on whether VITE_CONVEX_URL is set.
 */

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { engine, demo, useEngineRev, runDemo } from "./roomStore";
// Specific imports (NOT the ../agent barrel) so the AI-SDK-bearing model.ts never reaches the client bundle.
import { InMemoryRoomTools } from "../agent/roomTools";
import { ROOM_TOOLS } from "../agent/tools";
import { runAgent as runHarness } from "../agent/runtime";
import { scriptedModel } from "../agent/scripted";
import { recomputeVariancePlan, companyResearchPlan } from "../agent/plans";
import { buildResearchContext } from "../agent/context";
import { RESEARCH_PLAN } from "../engine/demoRoom";
import type { Actor, Artifact, ArtifactMeta, Channel, Lock, Member, Message, Room, TraceEvent, AgentSession, Draft, ChangeOp, Proposal, ResearchRowInput } from "../engine/types";
import type { ArtifactRef } from "../ui/artifactRefs";

/** The canonical Q3 variance the Room Agent computes (used by the no-keys /ask + collab). */
const VARIANCE: Record<string, string> = { r_rev: "+24%", r_cogs: "+27.5%", r_gp: "+21.7%", r_ni: "+22.4%" };

export type EditFeedback = { ok: boolean; reason?: string; version?: number };
type UndoEntry = { roomId: string; op: ChangeOp };
export type AgentRunTelemetry = { model: string; steps: number; toolCalls: number; inputTokens: number; outputTokens: number; costUsd: number; ms: number };
export type AgentJobTelemetry = {
  id: string;
  status: string;
  entrypoint?: string;
  scope?: string;
  runtime?: string;
  attempts: number;
  maxAttempts: number;
  modelPolicy: string;
  approvalPolicy?: string;
  evidencePolicy?: string;
  stopReason?: string;
  nextRunAt?: number;
  finalText?: string;
  error?: string;
  latestRunId?: string;
  actionSliceCount?: number;
  queryCount?: number;
  mutationCount?: number;
  modelCallCount?: number;
  toolCallCount?: number;
  schedulerHandoffCount?: number;
  receiptCount?: number;
  createdAt?: number;
  updatedAt: number;
};
export type AgentJobAttemptTelemetry = {
  attempt: number;
  status: string;
  resolvedModel: string;
  stopReason: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  scheduledNextAt?: number;
};
export type AgentJobDetailTelemetry = {
  operations: Array<{ sequence: number; kind: string; name: string; status: string; countDelta?: number; targetKind?: string; targetId?: string }>;
  receipts: Array<{ id: string; mutationName: string; affectedIds: string[]; createdAt: number }>;
  leases: Array<{ targetKind: string; targetId: string; mode: string; status: string; expiresAt: number }>;
  draftOperations: Array<{ operationName: string; status: string; affectedIds: string[]; createdAt: number }>;
  latestSteps: Array<{ idx: number; tool: string; status: string; elementId?: string; mutationReceiptIds?: string[] }>;
};
export type UploadedArtifactInput = {
  kind: "sheet" | "note";
  title: string;
  seed: Array<{ id: string; value: unknown }>;
  meta?: ArtifactMeta;
};
export type AgentAskInput = { goal: string; references?: ArtifactRef[] };
type ActorProof = { actor: Actor; token: string };

export interface RoomStore {
  mode: "memory" | "convex";
  getRoom(roomId: string): Room | undefined;
  listMembers(roomId: string): Member[];
  listArtifacts(roomId: string): Artifact[];
  getArtifact(id: string): Artifact | undefined;
  listMessages(roomId: string, channel: Channel): Message[];
  listTraces(roomId: string): TraceEvent[];
  listSessions(roomId: string): AgentSession[];
  listDrafts(roomId: string): Draft[];
  listProposals(roomId: string): Proposal[];
  lockFor(artifactId: string, elementId: string): Lock | undefined;
  awareness(roomId: string, agentId?: string): { activeLocks: Lock[] };
  /** Apply a hand edit (CAS). Returns feedback so the UI can surface a conflict honestly. */
  applyEdit(args: { roomId: string; op: ChangeOp; actor: Actor }): Promise<EditFeedback>;
  canUndo(roomId: string): boolean;
  undoLastEdit(roomId: string, actor: Actor): Promise<EditFeedback>;
  /** Send a chat message. Returns feedback so the UI can surface a failed send (and offer retry) instead of letting the optimistic bubble silently vanish. */
  postMessage(args: { roomId: string; channel: Channel; author: Actor; text: string; clientMsgId: string; kind?: Message["kind"] }): Promise<EditFeedback>;
  /** Edit your own already-sent message in place. Returns feedback so a rejected edit reverts visibly, not silently. */
  editMessage(messageId: string, text: string, author: Actor): Promise<EditFeedback>;
  toggleAutoAllow(roomId: string, actor: Actor): void;
  /** Approve/reject a proposal. Returns feedback so an approve that loses a CAS race surfaces the conflict instead of a false "applied". */
  resolveProposal(proposalId: string, approve: boolean, actor: Actor): Promise<EditFeedback>;
  addResearchRows(args: { roomId: string; artifactId: string; rows: ResearchRowInput[]; actor: Actor }): Promise<number>;
  uploadArtifact(args: { roomId: string; artifact: UploadedArtifactInput; actor: Actor }): Promise<string>;
  canRunCollab: boolean;
  runCollab(): Promise<void>;
  /** Drive the public Room NodeAgent on a free-form goal — the `/ask` path. */
  askAgent(input: AgentAskInput): Promise<void>;
  /** Drive the per-user PRIVATE NodeAgent. Default: reads the room, replies in the user's own private
   * channel. With `{ publish: true }`: the agent acts in the shared room (edits the sheet + posts public
   * chat) as the user's personal agent, attributed to them. */
  askPrivateAgent(goal: string, opts?: { publish?: boolean }): Promise<void>;
  startLongFreeAgent(input: AgentAskInput): Promise<void>;
  /** Enrich every PENDING company on the research sheet (ParselyFi loop) — status-gated, sourced. */
  askResearch(): Promise<void>;
  /** The most recent agent run's telemetry (model · tokens · cost · latency), or null. */
  lastRun(): AgentRunTelemetry | null;
  lastLongFreeJob(): AgentJobTelemetry | null;
  lastLongFreeJobAttempts(): AgentJobAttemptTelemetry[];
  lastLongFreeJobDetail(): AgentJobDetailTelemetry | null;
  cancelLongFreeJob(jobId: string): Promise<EditFeedback>;
  retryLongFreeJob(jobId: string): Promise<EditFeedback>;
}

const Ctx = createContext<RoomStore | null>(null);
export function useStore(): RoomStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside a RoomStore provider");
  return s;
}
export const HAS_CONVEX =
  !!import.meta.env.VITE_CONVEX_URL &&
  !(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "memory");

function researchRowIds(art: Artifact): string[] {
  const ids: string[] = [];
  for (const eid of art.order) { const rid = eid.split("__")[0]; if (!ids.includes(rid)) ids.push(rid); }
  return ids;
}
function slugCompany(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "company";
}
function researchTargetFor(art: Artifact, rowId: string) {
  const seeded = RESEARCH_PLAN.find((p) => p.rowId === rowId);
  if (seeded) return seeded;
  const company = String(art.elements[`${rowId}__company`]?.value ?? rowId);
  const website = String(art.elements[`${rowId}__website`]?.value ?? "") || `https://www.${slugCompany(company)}.com`;
  return {
    rowId,
    summary: `${company} - sourced account profile with GTM fit and recent signal.`,
    funding: "Funding signal captured from sourced research.",
    headcount: "Headcount signal captured from sourced research.",
    recentSignal: "Recent GTM signal captured from sourced research.",
    sourceUrl: website,
    source2Url: `https://en.wikipedia.org/wiki/${encodeURIComponent(company.replace(/\s+/g, "_"))}`,
  };
}

function targetSheet(artifacts: Artifact[], refs?: ArtifactRef[]): Artifact | undefined {
  const refSheet = refs
    ?.map((ref) => artifacts.find((a) => a.id === ref.id && a.kind === "sheet"))
    .find(Boolean);
  return refSheet ?? artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet");
}

/** Kind-agnostic target: a referenced note/wall/sheet is selectable so the live agent can edit ANY
 *  artifact (not just the variance sheet). Falls back to the variance sheet, any sheet, then artifact[0]. */
function targetArtifact(artifacts: Artifact[], refs?: ArtifactRef[]): Artifact | undefined {
  const ref = refs?.map((r) => artifacts.find((a) => a.id === r.id)).find(Boolean);
  return ref ?? artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet") ?? artifacts[0];
}

function canonicalRefs(artifacts: Artifact[], refs?: ArtifactRef[]): ArtifactRef[] | undefined {
  const canonical = refs
    ?.map((ref) => artifacts.find((a) => a.id === ref.id))
    .filter((art): art is Artifact => !!art)
    .map((art) => ({ id: art.id, title: art.title, kind: art.kind }));
  return canonical?.length ? canonical : undefined;
}

function isVarianceSheet(art: Artifact): boolean {
  return ["r_rev__variance", "r_cogs__variance", "r_gp__variance", "r_ni__variance"].some((id) => !!art.elements[id]);
}

function referenceNames(refs?: ArtifactRef[]): string {
  return refs?.length ? refs.map((ref) => ref.title).join(", ") : "the referenced artifact";
}

function withReferenceContext(goal: string, refs?: ArtifactRef[]): string {
  if (!refs?.length) return goal;
  const context = refs.map((ref) => `${ref.title} (${ref.kind}, id=${ref.id})`).join("; ");
  return `${goal}\n\nStructured references: ${context}`;
}

function makeUndoEntry(roomId: string, art: Artifact | undefined, op: ChangeOp, appliedVersion?: number): UndoEntry | null {
  const before = art?.elements[op.elementId];
  if (op.kind === "create") {
    return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "delete", value: null, baseVersion: appliedVersion ?? 1 } };
  }
  if (!before) return null;
  if (op.kind === "delete") {
    return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "create", value: before.value, baseVersion: 0 } };
  }
  return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "set", value: before.value, baseVersion: appliedVersion ?? before.version + 1 } };
}

function pushUndo(stack: Map<string, UndoEntry[]>, entry: UndoEntry | null) {
  if (!entry) return;
  const rows = stack.get(entry.roomId) ?? [];
  rows.push(entry);
  if (rows.length > 50) rows.splice(0, rows.length - 50);
  stack.set(entry.roomId, rows);
}

function withAppliedVersion(entry: UndoEntry | null, version?: number): UndoEntry | null {
  if (!entry || version === undefined || entry.op.kind === "create") return entry;
  return { ...entry, op: { ...entry.op, baseVersion: version } };
}

/* ── in-memory (RoomEngine) ── */
export function EngineStoreProvider({ roomId, children }: { roomId: string; me: Actor; children: ReactNode }) {
  const rev = useEngineRev();
  const undoStack = useRef(new Map<string, UndoEntry[]>());
  const store = useMemo<RoomStore>(() => ({
    mode: "memory",
    getRoom: (id) => engine.getRoom(id),
    listMembers: (id) => engine.listMembers(id),
    listArtifacts: (id) => engine.listArtifacts(id),
    getArtifact: (id) => engine.getArtifact(id),
    listMessages: (id, ch) => engine.listMessages(id, ch),
    listTraces: (id) => engine.listTraces(id),
    listSessions: (id) => engine.listSessions(id),
    listDrafts: (id) => engine.listDrafts(id),
    listProposals: (id) => engine.listProposals(id),
    lockFor: (aid, eid) => engine.lockFor(aid, eid),
    awareness: (id, aid) => engine.awareness(id, aid),
    applyEdit: async (args) => {
      const undo = makeUndoEntry(args.roomId, engine.getArtifact(args.op.artifactId), args.op);
      const r = engine.applyEdit(args);
      if (r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.toVersion));
      return r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason };
    },
    canUndo: (id) => (undoStack.current.get(id)?.length ?? 0) > 0,
    undoLastEdit: async (id, actor) => {
      const stack = undoStack.current.get(id) ?? [];
      const entry = stack.pop();
      if (!entry) return { ok: false, reason: "nothing_to_undo" };
      const r = engine.applyEdit({ roomId: id, op: entry.op, actor });
      if (!r.ok) stack.push(entry);
      return r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason };
    },
    postMessage: async (args) => { engine.postMessage(args); return { ok: true }; },
    editMessage: async (id, text) => { engine.updateMessage(id, { text }); return { ok: true }; },
    toggleAutoAllow: (id, actor) => { engine.toggleAutoAllow(id, actor); },
    resolveProposal: async (id, approve, actor) => {
      const proposal = [...engine.listProposals(roomId)].find((p) => p.id === id);
      const undo = proposal ? makeUndoEntry(proposal.roomId, engine.getArtifact(proposal.artifactId), proposal.op) : null;
      const r = engine.resolveProposal(id, approve, actor);
      if (approve && r?.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.toVersion));
      return r ? (r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason }) : { ok: false, reason: "not_found" };
    },
    addResearchRows: async ({ roomId, artifactId, rows, actor }) => engine.addResearchRows({ roomId, artifactId, rows, by: actor }).length,
    uploadArtifact: async ({ roomId, artifact, actor }) => engine.createArtifact({ roomId, kind: artifact.kind, title: artifact.title, seed: artifact.seed, meta: artifact.meta, by: actor }).id,
    canRunCollab: roomId === demo.roomId,
    runCollab: () => runDemo(false),
    askAgent: async (input) => {
      const artifacts = engine.listArtifacts(roomId);
      const references = canonicalRefs(artifacts, input.references);
      const goal = withReferenceContext(input.goal, references);
      const sheet = targetSheet(artifacts, references);
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!sheet || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      if (!isVarianceSheet(sheet)) {
        engine.postMessage({
          roomId,
          channel: "public",
          author: actor,
          text: `I received ${referenceNames(references)} as structured dataframe context (${sheet.meta?.dataframe?.rowCount ?? "unknown"} rows). Dynamic ENRICH/CLASSIFY execution is staged next; variance recompute only runs on Q3 variance.`,
          clientMsgId: crypto.randomUUID(),
          kind: "agent",
        });
        return;
      }
      // NAIVE-DEMO (demo/v0-naive-agent): the naive agent recomputes EVERY variance cell
      // unconditionally — it assumes it owns the latest state, so a human's freshly-committed
      // figure is just another cell to overwrite. (Main filters to empty cells.)
      const targets: Record<string, string> = {};
      for (const rid of Object.keys(VARIANCE)) targets[`${rid}__variance`] = VARIANCE[rid];
      const rt = new InMemoryRoomTools(engine, roomId, sheet.id, actor, sess.id);
      const result = await runHarness({ rt, goal, model: scriptedModel(recomputeVariancePlan(targets, { lock: true })), tools: ROOM_TOOLS, maxSteps: 16 });
      // The scripted plan narrates via the model's text, not the say tool — post that summary to the room
      // (the live path narrates through the real say tool inside the action).
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    askPrivateAgent: async () => { /* memory mode replies inline in Chat.tsx */ },
    startLongFreeAgent: async (input) => {
      const artifacts = engine.listArtifacts(roomId);
      const references = canonicalRefs(artifacts, input.references);
      const sheet = targetSheet(artifacts, references);
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!sheet || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      engine.postMessage({
        roomId,
        channel: "public",
        author: actor,
        text: "Queued the long-running free-auto job path. Memory mode uses the deterministic local agent; Convex mode checkpoints and resumes across action slices.",
        clientMsgId: crypto.randomUUID(),
        kind: "agent",
      });
      const rt = new InMemoryRoomTools(engine, roomId, sheet.id, actor, sess.id);
      const result = await runHarness({
        rt,
        goal: withReferenceContext(input.goal, references),
        model: scriptedModel(recomputeVariancePlan({ r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" }, { lock: true })),
        tools: ROOM_TOOLS,
        maxSteps: 16,
      });
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    askResearch: async () => {
      const research = engine.listArtifacts(roomId).find((a) => a.title === "Company research");
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!research || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      const pending = researchRowIds(research)
        .filter((rowId) => String(research.elements[`${rowId}__status`]?.value ?? "pending") === "pending")
        .map((rowId) => researchTargetFor(research, rowId));
      if (pending.length === 0) {
        engine.postMessage({ roomId, channel: "public", author: actor, text: "Every company on the research sheet is already complete.", clientMsgId: crypto.randomUUID(), kind: "agent" });
        return;
      }
      const rt = new InMemoryRoomTools(engine, roomId, research.id, actor, sess.id);
      const result = await runHarness({ rt, goal: "Research every pending company.", model: scriptedModel(companyResearchPlan(pending)), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 60 });
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    lastRun: () => null, // the in-memory scripted agent makes no API calls — no token/cost telemetry
    lastLongFreeJob: () => null,
    lastLongFreeJobAttempts: () => [],
    lastLongFreeJobDetail: () => null,
    cancelLongFreeJob: async () => ({ ok: true }),
    retryLongFreeJob: async () => ({ ok: true }),
  }), [rev, roomId]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/* ── live Convex ── */
const chanStr = (ch: Channel): string => (ch === "public" ? "public" : ch.private);

/* ── optimistic-update helpers ─────────────────────────────────────────────
   Convex semantics (convex@1.40 optimistic_updates.d.ts): the update is rolled back
   ATOMICALLY with the authoritative query results when the mutation completes — so
   zero TEMPORAL flicker is the platform's guarantee. What's ours: (1) SHAPE PARITY —
   the optimistic value must equal what the server will compute, or the swap shows a
   content jump; (2) REPLAY IDEMPOTENCE — "optimistic updates can be called multiple
   times … replayed" on fresh server state while the mutation is in flight, so every
   update must recompute from current state and tolerate its own server echo. */

/** Mirror of applyCellEditCore's apply step (convex/artifacts.ts): version bump, order
 *  handling for create/delete, updatedBy attribution. Shared by the hand-edit and the
 *  proposal-approve optimistic paths so both paint the exact server outcome. */
function withCellApplied(artifacts: Artifact[], artifactId: string, elementId: string, kind: "set" | "create" | "delete", value: unknown, actor: Actor): Artifact[] {
  return artifacts.map((a) => {
    if (a.id !== artifactId) return a;
    const prev = (a.elements[elementId] ?? { version: 0 }) as { version: number };
    const elements = { ...a.elements };
    const order = kind === "create" && !elements[elementId] ? [...a.order, elementId] : kind === "delete" ? a.order.filter((id) => id !== elementId) : a.order;
    if (kind === "delete") delete elements[elementId];
    else elements[elementId] = { id: elementId, value, version: prev.version + 1, updatedAt: Date.now(), updatedBy: actor } as Artifact["elements"][string];
    return { ...a, version: a.version + 1, order, elements };
  });
}

/* Client mirrors of convex/artifacts.ts research-row helpers — MUST stay in lockstep
   (they make addResearchRows deterministic, which is what makes its optimistic insert
   parity-exact: same slugs, same suffix-dedup, same default column values). */
const RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
function slugResearchRowClient(company: string): string {
  const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return base ? `rc_${base}` : `rc_company`;
}
function defaultWebsiteClient(company: string): string {
  const host = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return host ? `https://www.${host}.com` : "";
}
function normalizeResearchIdentityClient(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function normalizeResearchDomainClient(value?: string): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}
function rowIdsFromOrderClient(order: string[]): string[] {
  return [...new Set(order.map((id) => id.split("__")[0]))];
}
function cellStringClient(art: Artifact, rid: string, col: string): string {
  const raw = art.elements[`${rid}__${col}`]?.value;
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : String(raw);
}
function findExistingResearchRowClient(art: Artifact, row: ResearchRowInput): string | null {
  const wantedCompany = normalizeResearchIdentityClient(row.company);
  const wantedDomain = normalizeResearchDomainClient(row.website);
  return rowIdsFromOrderClient(art.order).find((rid) => {
    const company = normalizeResearchIdentityClient(cellStringClient(art, rid, "company"));
    if (wantedCompany && company === wantedCompany) return true;
    const domain = normalizeResearchDomainClient(cellStringClient(art, rid, "website"));
    return !!wantedDomain && domain === wantedDomain;
  }) ?? null;
}

export function ConvexStoreProvider({ roomId, me, proof, children }: { roomId: string; me: Actor; proof: ActorProof; children: ReactNode }) {
  const undoStack = useRef(new Map<string, UndoEntry[]>());
  const rid = roomId as never;
  const data = useQuery(api.rooms.full, { roomId: rid, requester: proof });
  const pubQuery = { roomId: rid, channel: "public", requester: proof };
  const privQuery = { roomId: rid, channel: me.id, requester: proof };
  const pub = useQuery(api.messages.list, pubQuery) ?? [];
  const priv = useQuery(api.messages.list, privQuery) ?? [];
  const traces = useQuery(api.collab.traces, { roomId: rid, requester: proof }) ?? [];
  const runs = useQuery(api.agentRuns.list, { roomId: rid, requester: proof }) ?? [];
  const jobs = useQuery(api.agentJobs.list, { roomId: rid, requester: proof }) ?? [];
  const latestJobId = (jobs as Array<{ _id: string }>)[0]?._id;
  const jobAttempts = useQuery(api.agentJobs.attempts, latestJobId ? { jobId: latestJobId as never, requester: proof } : "skip") ?? [];
  const jobDetail = useQuery(api.agentJobs.detail, latestJobId ? { jobId: latestJobId as never, requester: proof } : "skip");
  const proposals = useQuery(api.artifacts.listProposals, { roomId: rid, requester: proof }) ?? [];

  const applyCellEdit = useMutation(api.artifacts.applyCellEdit).withOptimisticUpdate((local, args) => {
    const cur = local.getQuery(api.rooms.full, { roomId: args.roomId, requester: args.proof });
    if (!cur) return;
    const artifacts = withCellApplied(cur.artifacts as unknown as Artifact[], args.artifactId as unknown as string, args.elementId, args.kind ?? "set", args.value, args.proof.actor);
    local.setQuery(api.rooms.full, { roomId: args.roomId, requester: args.proof }, { ...cur, artifacts } as typeof cur);
  });
  const sendMsg = useMutation(api.messages.send).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, channel: args.channel, requester: args.proof };
    const cur = local.getQuery(api.messages.list, q) ?? [];
    // Replay/retry guard: if the list already holds this clientMsgId (retrySend re-sends with the
    // SAME cid, and the first attempt may have landed server-side), appending again would paint a
    // duplicate bubble for the whole in-flight window. Idempotent by clientMsgId.
    if (cur.some((m) => m.clientMsgId === args.clientMsgId)) return;
    local.setQuery(api.messages.list, q, [...cur, { _id: ("opt-" + args.clientMsgId) as never, _creationTime: Date.now(), roomId: args.roomId, channel: args.channel, author: args.proof.actor, text: args.text, clientMsgId: args.clientMsgId, kind: "chat", createdAt: Date.now() }]);
  });
  // QA P1: the auto-allow switch flips instantly (server toggle reconciles) — matches applyCellEdit's pattern.
  const toggle = useMutation(api.rooms.toggleAutoAllow).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, requester: args.requester };
    const cur = local.getQuery(api.rooms.full, q);
    if (!cur) return;
    local.setQuery(api.rooms.full, q, { ...cur, room: { ...cur.room, autoAllow: !cur.room.autoAllow } } as typeof cur);
  });
  // Optimistic edit: text is reversible + predictable (patch same _id) + author-authoritative → optimistic-safe.
  // Match by _id across every loaded messages.list ref (public + the actor's private channel); the editor only
  // has the messageId, so do NOT reconstruct query args — update whichever loaded list holds the row.
  const editMsg = useMutation(api.messages.update).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.messages.list)) {
      if (!value || !value.some((m) => m._id === args.messageId)) continue;
      local.setQuery(api.messages.list, qargs, value.map((m) => (m._id === args.messageId ? { ...m, text: args.text } : m)));
    }
  });
  // QA P1: a resolved proposal leaves the pending list instantly (approve that loses CAS still
  // surfaces via the mutation's returned feedback — optimistic removal never hides the conflict).
  // Zero-flicker deepening: an APPROVE also paints the cell value now — previously the chip vanished
  // instantly but the cell landed a beat later (a visible two-phase flick). The op comes from the
  // proposals query itself; the server applies with proposal.author, so attribution matches exactly.
  const resolveProposalMutation = useMutation(api.artifacts.resolveProposal).withOptimisticUpdate((local, args) => {
    const q = { roomId: rid, requester: args.requester };
    const cur = local.getQuery(api.artifacts.listProposals, q);
    if (!cur) return;
    const prop = cur.find((p) => String(p.id) === String(args.proposalId));
    local.setQuery(api.artifacts.listProposals, q, cur.filter((p) => String(p.id) !== String(args.proposalId)));
    if (!args.approve || !prop) return;
    const op = prop.op as { elementId: string; kind: "set" | "create" | "delete"; value: unknown };
    const full = local.getQuery(api.rooms.full, q);
    if (!full) return;
    const artifacts = withCellApplied(full.artifacts as unknown as Artifact[], String(prop.artifactId), op.elementId, op.kind, op.value, prop.author as Actor);
    local.setQuery(api.rooms.full, q, { ...full, artifacts } as typeof full);
  });
  // "Add accounts" paints instantly: an EXACT client mirror of the server's deterministic row
  // builder (same slugs, same suffix-dedup against order, same default column values), recomputed
  // from fresh state on every replay — so the authoritative swap is pixel-identical.
  const addResearchRowsMutation = useMutation(api.artifacts.addResearchRows).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, requester: args.requester };
    const cur = local.getQuery(api.rooms.full, q);
    if (!cur) return;
    const now = Date.now();
    const artifacts = (cur.artifacts as unknown as Artifact[]).map((a) => {
      if (a.id !== (args.artifactId as unknown as string)) return a;
      const nextOrder = [...a.order];
      const elements = { ...a.elements };
      let changed = false;
      for (const row of args.rows as ResearchRowInput[]) {
        const company = row.company.trim();
        if (!company) continue;
        let rowChanged = false;
        const base = slugResearchRowClient(company);
        const existing = findExistingResearchRowClient({ ...a, order: nextOrder, elements } as Artifact, row);
        let rowId = existing ?? base, suffix = 1;
        while (!existing && nextOrder.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
        const vals: Record<(typeof RESEARCH_COLS)[number], string> = {
          company,
          website: row.website?.trim() || defaultWebsiteClient(company),
          status: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "status") || "pending" : "pending",
          tier: row.tier?.trim() || "B",
          intent: row.intent?.trim() ?? "",
          owner: row.owner?.trim() || args.requester.actor.name,
          crm_status: row.crmStatus?.trim() || "Research",
          summary: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "summary") : "",
          funding: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "funding") : "",
          headcount: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "headcount") : "",
          recent_signal: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "recent_signal") : "",
          source: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "source") : "",
          source2: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "source2") : "",
          last_researched: existing ? cellStringClient({ ...a, elements } as Artifact, rowId, "last_researched") : "",
        };
        const writableCols = existing ? ["company", "website", "tier", "intent", "owner", "crm_status"] as const : RESEARCH_COLS;
        for (const col of writableCols) {
          const elementId = `${rowId}__${col}`;
          const prev = elements[elementId];
          if (prev) {
            if (Object.is(prev.value, vals[col])) continue;
            elements[elementId] = { ...prev, value: vals[col], version: prev.version + 1, updatedAt: now, updatedBy: args.requester.actor } as Artifact["elements"][string];
          } else {
            nextOrder.push(elementId);
            elements[elementId] = { id: elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: args.requester.actor } as Artifact["elements"][string];
          }
          rowChanged = true;
        }
        if (!existing) {
          for (const col of RESEARCH_COLS) {
            const elementId = `${rowId}__${col}`;
            if (elements[elementId]) continue;
            nextOrder.push(elementId);
            elements[elementId] = { id: elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: args.requester.actor } as Artifact["elements"][string];
            rowChanged = true;
          }
        }
        changed = changed || rowChanged;
      }
      return changed ? { ...a, order: nextOrder, elements, version: a.version + 1, updatedAt: now } : a;
    });
    local.setQuery(api.rooms.full, q, { ...cur, artifacts } as typeof cur);
  });
  // Upload/new-artifact paints instantly under a placeholder id; the authoritative id swaps in
  // atomically at completion (tab is labeled by title, selection happens post-await with the real
  // id — no visible jump). Echo guard: skip if this mutation's artifact already streamed in.
  const createArtifactMutation = useMutation(api.artifacts.createArtifact).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, requester: args.proof };
    const cur = local.getQuery(api.rooms.full, q);
    if (!cur) return;
    const arts = cur.artifacts as unknown as Artifact[];
    if (arts.some((a) => a.title === args.title && a.kind === args.kind && a.order.length === args.seed.length)) return;
    const now = Date.now();
    const elements: Artifact["elements"] = {};
    for (const s of args.seed as Array<{ id: string; value: unknown }>) {
      elements[s.id] = { id: s.id, value: s.value, version: 1, updatedAt: now, updatedBy: args.proof.actor } as Artifact["elements"][string];
    }
    const optimistic = {
      id: `opt-art-${args.kind}-${args.title}`, roomId: args.roomId as unknown as string, kind: args.kind, title: args.title,
      version: 1, order: (args.seed as Array<{ id: string }>).map((s) => s.id), elements, updatedAt: now, meta: args.meta,
    } as unknown as Artifact;
    local.setQuery(api.rooms.full, q, { ...cur, artifacts: [...arts, optimistic] } as typeof cur);
  });
  const runAgent = useAction(api.agent.runRoomAgent);
  const runPrivateAgent = useAction(api.agent.runPrivateAgent);
  const startFreeAutoJob = useMutation(api.agentJobs.startFreeAuto);
  // Job-strip controls flip instantly. Mirrors the server's transition + ITS guards (cancel: no-op
  // on terminal; retry: no-op on completed/running) so an ok:false result reconciles honestly via
  // rollback + the returned feedback. Args carry only jobId — patch whichever loaded list holds it.
  const cancelFreeAutoJob = useMutation(api.agentJobs.cancel).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.agentJobs.list)) {
      if (!value?.some((j) => String(j._id) === String(args.jobId))) continue;
      local.setQuery(api.agentJobs.list, qargs, value.map((j) =>
        String(j._id) === String(args.jobId) && !["completed", "failed", "cancelled"].includes(j.status)
          ? { ...j, status: "cancelled", error: "cancelled_by_user", updatedAt: Date.now() } : j));
    }
  });
  const retryFreeAutoJob = useMutation(api.agentJobs.retry).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.agentJobs.list)) {
      if (!value?.some((j) => String(j._id) === String(args.jobId))) continue;
      local.setQuery(api.agentJobs.list, qargs, value.map((j) =>
        String(j._id) === String(args.jobId) && !["completed", "running"].includes(j.status)
          ? { ...j, status: "queued", error: undefined, nextRunAt: Date.now(), updatedAt: Date.now() } : j));
    }
  });

  const store = useMemo<RoomStore>(() => {
    const room = (data?.room ?? undefined) as unknown as Room | undefined;
    const members = (data?.members ?? []) as unknown as Member[];
    const artifacts = (data?.artifacts ?? []) as unknown as Artifact[];
    const locks = (data?.locks ?? []) as unknown as Lock[];
    const sessions = (data?.sessions ?? []) as unknown as AgentSession[];
    const drafts = (data?.drafts ?? []) as unknown as Draft[];
    const isHost = members.some((m) => m.id === me.id && m.role === "host");
    const reshapeMsgs = (rows: typeof pub): Message[] => rows.map((m: { _id: string; roomId: string; channel: string; author: Actor; text: string; clientMsgId: string; kind: Message["kind"]; createdAt: number }) => ({ id: m._id as string, roomId: m.roomId as string, channel: m.channel === "public" ? "public" : { private: m.channel }, author: m.author as Actor, text: m.text, clientMsgId: m.clientMsgId, kind: m.kind, createdAt: m.createdAt }));
    const allTraces = (traces as { _id: string; roomId: string; ts: number; actor: Actor; type: string; summary: string; detail?: string }[]).map((t) => ({ id: t._id, roomId: t.roomId, ts: t.ts, actor: t.actor, type: t.type as TraceEvent["type"], summary: t.summary, detail: t.detail }));

    return {
      mode: "convex",
      getRoom: () => room,
      listMembers: () => members,
      listArtifacts: () => artifacts,
      getArtifact: (id) => artifacts.find((a) => a.id === id),
      listMessages: (_id, ch) => (ch === "public" ? reshapeMsgs(pub) : reshapeMsgs(priv)),
      listTraces: () => allTraces,
      listSessions: () => sessions,
      listDrafts: () => drafts,
      listProposals: () => proposals as unknown as Proposal[],
      lockFor: (aid, eid) => locks.find((l) => l.artifactId === aid && l.elementIds.includes(eid)),
      awareness: (_id, aid) => ({ activeLocks: locks.filter((l) => l.holder.id !== aid) }),
      applyEdit: async ({ op }) => {
        const undo = makeUndoEntry(roomId, artifacts.find((a) => a.id === op.artifactId), op);
        const r = await applyCellEdit({ roomId: rid, artifactId: op.artifactId as never, elementId: op.elementId, kind: op.kind, value: op.value, baseVersion: op.baseVersion, proof });
        if (r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.version));
        return r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason };
      },
      canUndo: (id) => (undoStack.current.get(id)?.length ?? 0) > 0,
      undoLastEdit: async (id) => {
        const stack = undoStack.current.get(id) ?? [];
        const entry = stack.pop();
        if (!entry) return { ok: false, reason: "nothing_to_undo" };
        try {
          const r = await applyCellEdit({ roomId: rid, artifactId: entry.op.artifactId as never, elementId: entry.op.elementId, kind: entry.op.kind, value: entry.op.value, baseVersion: entry.op.baseVersion, proof });
          if (!r.ok) stack.push(entry);
          return r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason };
        } catch (e) {
          stack.push(entry);
          return { ok: false, reason: e instanceof Error ? e.message : "undo_failed" };
        }
      },
      postMessage: async ({ channel, text, clientMsgId }) => {
        try { await sendMsg({ roomId: rid, channel: chanStr(channel), proof, text, clientMsgId }); return { ok: true }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "send_failed" }; }
      },
      editMessage: async (id, text) => {
        try { const r = await editMsg({ messageId: id as never, text, requester: proof }); return r?.ok ? { ok: true } : { ok: false, reason: r?.reason ?? "edit_failed" }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "edit_failed" }; }
      },
      toggleAutoAllow: () => { void toggle({ roomId: rid, requester: proof }); },
      resolveProposal: async (proposalId, approve) => {
        const proposal = (proposals as unknown as Proposal[]).find((p) => p.id === proposalId);
        const undo = proposal ? makeUndoEntry(roomId, artifacts.find((a) => a.id === proposal.artifactId), proposal.op) : null;
        try {
          const r = await resolveProposalMutation({ proposalId: proposalId as never, approve, requester: proof });
          const version = r.ok && "version" in r ? r.version : undefined;
          if (approve && r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, version));
          return r.ok ? { ok: true, version } : { ok: false, reason: r.reason };
        }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "resolve_failed" }; }
      },
      addResearchRows: async ({ artifactId, rows }) => {
        const ids = await addResearchRowsMutation({ roomId: rid, artifactId: artifactId as never, rows, requester: proof });
        return ids.length;
      },
      uploadArtifact: async ({ artifact }) => {
        const id = await createArtifactMutation({ roomId: rid, kind: artifact.kind, title: artifact.title, seed: artifact.seed, meta: artifact.meta, proof });
        return String(id);
      },
      canRunCollab: isHost,
      runCollab: async () => {
        if (!isHost) return;
        const sheet = artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet");
        const sess = sessions.find((s) => s.scope === "public");
        if (!sheet || !sess) return;
        await runAgent({ roomId: rid, artifactId: sheet.id as never, requester: proof, goal: "Fill the remaining Q3 variance cells: Gross profit (r_gp__variance)=+21.7% and Net income (r_ni__variance)=+22.4%. Lock them, edit with CAS, then release." });
      },
      askAgent: async (input) => {
        const references = canonicalRefs(artifacts, input.references);
        // Kind-agnostic target: /ask + a referenced note/wall/sheet edits THAT artifact; the agent's
        // context builder is routed by kind server-side. No more variance-only refusal.
        const target = targetArtifact(artifacts, references);
        const sess = sessions.find((s) => s.scope === "public");
        if (!target || !sess) return;
        await runAgent({
          roomId: rid,
          artifactId: target.id as never,
          requester: proof,
          mode: target.title === "Company research" ? "research" : undefined,
          goal: withReferenceContext(input.goal, references),
        });
      },
      askPrivateAgent: async (goal, opts) => {
        if (opts?.publish) {
          const target = targetArtifact(artifacts);
          if (target) {
            await runAgent({ roomId: rid, artifactId: target.id as never, requester: proof, mode: target.title === "Company research" ? "research" : undefined, goal, asOwner: { id: me.id, name: me.name } });
            return;
          }
        }
        await runPrivateAgent({ roomId: rid, requester: proof, goal });
      },
      startLongFreeAgent: async (input) => {
        const references = canonicalRefs(artifacts, input.references);
        const sheet = targetSheet(artifacts, references);
        const sess = sessions.find((s) => s.scope === "public");
        if (!sheet || !sess) return;
        await sendMsg({
          roomId: rid,
          channel: "public",
          proof,
          text: `Queued long-running free-auto job for ${referenceNames(references)}. It will checkpoint and resume across Convex action slices.`,
          clientMsgId: crypto.randomUUID(),
        });
        await startFreeAutoJob({
          roomId: rid,
          artifactId: sheet.id as never,
          requester: proof,
          goal: withReferenceContext(input.goal, references),
          mode: sheet.title === "Company research" ? "research" : "variance",
        });
      },
      askResearch: async () => {
        const research = artifacts.find((a) => a.title === "Company research");
        const sess = sessions.find((s) => s.scope === "public");
        if (!research || !sess) return;
        await runAgent({ roomId: rid, artifactId: research.id as never, requester: proof, mode: "research", goal: "Research every pending or stale company: claim its editable research cells, set status to running, fetch the website plus a corroborating source when available, write summary/funding/headcount/recent_signal, write citations into __source and __source2, set last_researched to today's ISO date, set status to complete, then release. Cite only sources you fetched." });
      },
      lastRun: () => {
        const r = (runs as unknown as AgentRunTelemetry[])[0];
        return r ? { model: r.model, steps: r.steps, toolCalls: r.toolCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, ms: r.ms } : null;
      },
      lastLongFreeJob: () => {
        const j = (jobs as Array<{
          _id: string; status: string; entrypoint?: string; scope?: string; runtime?: string; attempts: number; maxAttempts: number;
          modelPolicy: string; approvalPolicy?: string; evidencePolicy?: string; handoff?: { reason?: string }; nextRunAt?: number;
          finalText?: string; error?: string; latestRunId?: string; actionSliceCount?: number; queryCount?: number; mutationCount?: number;
          modelCallCount?: number; toolCallCount?: number; schedulerHandoffCount?: number; receiptCount?: number; createdAt?: number; updatedAt: number;
        }>)[0];
        return j ? {
          id: String(j._id),
          status: j.status,
          entrypoint: j.entrypoint,
          scope: j.scope,
          runtime: j.runtime,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          modelPolicy: j.modelPolicy,
          approvalPolicy: j.approvalPolicy,
          evidencePolicy: j.evidencePolicy,
          stopReason: j.handoff?.reason,
          nextRunAt: j.nextRunAt,
          finalText: j.finalText,
          error: j.error,
          latestRunId: j.latestRunId ? String(j.latestRunId) : undefined,
          actionSliceCount: j.actionSliceCount,
          queryCount: j.queryCount,
          mutationCount: j.mutationCount,
          modelCallCount: j.modelCallCount,
          toolCallCount: j.toolCallCount,
          schedulerHandoffCount: j.schedulerHandoffCount,
          receiptCount: j.receiptCount,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
        } : null;
      },
      lastLongFreeJobAttempts: () => (jobAttempts as Array<{
        attempt: number;
        status: string;
        resolvedModel: string;
        stopReason: string;
        ms: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        error?: string;
        scheduledNextAt?: number;
      }>).map((a) => ({
        attempt: a.attempt,
        status: a.status,
        resolvedModel: a.resolvedModel,
        stopReason: a.stopReason,
        ms: a.ms,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        costUsd: a.costUsd,
        error: a.error,
        scheduledNextAt: a.scheduledNextAt,
      })),
      lastLongFreeJobDetail: () => {
        if (!jobDetail) return null;
        const d = jobDetail as {
          operations?: Array<{ sequence: number; kind: string; name: string; status: string; countDelta?: number; targetKind?: string; targetId?: string }>;
          receipts?: Array<{ _id: string; mutationName: string; affectedIds: string[]; createdAt: number }>;
          leases?: Array<{ targetKind: string; targetId: string; mode: string; status: string; expiresAt: number }>;
          draftOperations?: Array<{ operationName: string; status: string; affectedIds: string[]; createdAt: number }>;
          latestSteps?: Array<{ idx: number; tool: string; status: string; elementId?: string; mutationReceiptIds?: string[] }>;
        };
        return {
          operations: (d.operations ?? []).map((o) => ({ sequence: o.sequence, kind: o.kind, name: o.name, status: o.status, countDelta: o.countDelta, targetKind: o.targetKind, targetId: o.targetId })),
          receipts: (d.receipts ?? []).map((r) => ({ id: String(r._id), mutationName: r.mutationName, affectedIds: r.affectedIds, createdAt: r.createdAt })),
          leases: (d.leases ?? []).map((l) => ({ targetKind: l.targetKind, targetId: l.targetId, mode: l.mode, status: l.status, expiresAt: l.expiresAt })),
          draftOperations: (d.draftOperations ?? []).map((op) => ({ operationName: op.operationName, status: op.status, affectedIds: op.affectedIds, createdAt: op.createdAt })),
          latestSteps: (d.latestSteps ?? []).map((s) => ({ idx: s.idx, tool: s.tool, status: s.status, elementId: s.elementId, mutationReceiptIds: s.mutationReceiptIds?.map(String) })),
        };
      },
      cancelLongFreeJob: async (jobId) => {
        try { const r = await cancelFreeAutoJob({ jobId: jobId as never, requester: proof }); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "cancel_failed" }; }
      },
      retryLongFreeJob: async (jobId) => {
        try { const r = await retryFreeAutoJob({ jobId: jobId as never, requester: proof }); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "retry_failed" }; }
      },
    };
  }, [data, pub, priv, traces, runs, jobs, jobAttempts, jobDetail, proposals, applyCellEdit, sendMsg, toggle, editMsg, resolveProposalMutation, addResearchRowsMutation, createArtifactMutation, runAgent, startFreeAutoJob, cancelFreeAutoJob, retryFreeAutoJob, rid, roomId, proof, me.id]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
