/** Rooms + anonymous join. The short code is generated client-side and passed in
 * (mutations are deterministic — no Math.random/uuid inside). Anonymous join is a
 * stand-in for `@convex-dev/auth`'s Anonymous provider (see docs/STACK.md). */
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, getRequiredProductionIdentity, hashToken, requireActorProof, type ActorValue } from "./lib";
import { syncSpreadsheetIndexFromSeed } from "./spreadsheetIndexLib";

const palette = ["#d97757", "#5b9bf5", "#7bd089", "#a78bfa", "#e4c567", "#e8845f"];

// ── Production abuse gates (anon-join surface) ──────────────────────────────────────────────────
// VITE_CONVEX_URL ships in the public bundle, so every mutation is directly callable by a scripted
// client. These deterministic caps bound the blast radius: code entropy stops enumeration, the
// member cap stops room flooding, the join-rate window stops scripted mass-joins.
const ROOM_CODE_RE = /^[A-Z0-9]{6,12}$/; // ≥6 of [A-Z0-9] → 36^6 ≈ 2.2B codes; enumeration is impractical
const MAX_MEMBERS_PER_ROOM = 32;
const MAX_JOINS_PER_MINUTE = 10;
const MAX_NAME_LEN = 40;
const MAX_TITLE_LEN = 80;

const STARTER_SHEET_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];

function starterSheetSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const r of STARTER_SHEET_ROWS) {
    seed.push({ id: `${r.id}__label`, value: r.label });
    seed.push({ id: `${r.id}__q2`, value: r.q2 });
    seed.push({ id: `${r.id}__q3`, value: r.q3 });
    seed.push({ id: `${r.id}__variance`, value: "" });
    seed.push({ id: `${r.id}__note`, value: "" });
  }
  return seed;
}

const starterNoteSeed = () => [
  {
    id: "doc",
    value: "<h1>Team notes</h1><p>Shared notes for the Q3 review. Type here, or ask your NodeAgent to draft and update this note.</p>",
  },
];

const starterWallSeed = () => [
  { id: "s_welcome", value: { text: "Drop ideas here - drag to rearrange.", x: 64, y: 64, color: "#FDE68A" } },
  { id: "s_agent", value: { text: "Ask an agent to add post-its in the Room lane.", x: 280, y: 150, color: "#BBF7D0" } },
];

async function insertStarterArtifact(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    kind: "sheet" | "note" | "wall";
    title: string;
    seed: Array<{ id: string; value: unknown }>;
    actor: ActorValue;
    now: number;
  },
) {
  const artifactId = await ctx.db.insert("artifacts", {
    roomId: args.roomId,
    kind: args.kind,
    title: args.title,
    version: 1,
    order: args.seed.map((s) => s.id),
    updatedAt: args.now,
  });
  for (const s of args.seed) {
    await ctx.db.insert("elements", { artifactId, elementId: s.id, value: s.value, version: 1, updatedAt: args.now, updatedBy: args.actor });
  }
  await syncSpreadsheetIndexFromSeed(ctx, { artifactId, title: args.title, kind: args.kind, seed: args.seed, now: args.now });
  await ctx.db.insert("traces", {
    roomId: args.roomId,
    ts: args.now,
    actor: args.actor,
    type: "edit_applied",
    summary: `${args.actor.name} added ${args.title}`,
    detail: `create_artifact - ${args.kind} - ${String(artifactId)}`,
  });
  return artifactId;
}

export const create = mutation({
  args: { code: v.string(), title: v.string(), hostName: v.string(), authToken: v.string(), autoAllow: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const identity = await getRequiredProductionIdentity(ctx);
    const code = a.code.toUpperCase();
    if (!ROOM_CODE_RE.test(code)) throw new Error("weak_room_code"); // server-enforced entropy floor
    if (a.title.length > MAX_TITLE_LEN || a.hostName.length > MAX_NAME_LEN) throw new Error("field_too_long");
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (existing) throw new Error("room_code_taken");
    const roomId = await ctx.db.insert("rooms", { code, title: a.title, hostId: "", autoAllow: a.autoAllow ?? false, status: "live", createdAt: now });
    const memberId = await ctx.db.insert("members", { roomId, name: a.hostName, role: "host", anon: false, color: palette[0], authTokenHash: await hashToken(a.authToken), authSubject: identity?.subject, lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: memberId });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public", status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: memberId, status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("traces", { roomId, ts: now, actor: { kind: "user", id: memberId, name: a.hostName }, type: "room_created", summary: `${a.hostName} created the room` });
    return { roomId, memberId };
  },
});

export const createStarterRoom = mutation({
  args: { code: v.string(), title: v.string(), hostName: v.string(), authToken: v.string(), autoAllow: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const identity = await getRequiredProductionIdentity(ctx);
    const code = a.code.toUpperCase();
    if (!ROOM_CODE_RE.test(code)) throw new Error("weak_room_code");
    if (a.title.length > MAX_TITLE_LEN || a.hostName.length > MAX_NAME_LEN) throw new Error("field_too_long");
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (existing) throw new Error("room_code_taken");
    const roomId = await ctx.db.insert("rooms", { code, title: a.title, hostId: "", autoAllow: a.autoAllow ?? false, status: "live", createdAt: now });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: a.hostName,
      role: "host",
      anon: false,
      color: palette[0],
      authTokenHash: await hashToken(a.authToken),
      authSubject: identity?.subject,
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: memberId });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public", status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: memberId, status: "idle", lastAction: "started", updatedAt: now });
    const actor = { kind: "user" as const, id: String(memberId), name: a.hostName };
    await ctx.db.insert("traces", { roomId, ts: now, actor, type: "room_created", summary: `${a.hostName} created the room` });
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Team notes", seed: starterNoteSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "wall", title: "Ideas wall", seed: starterWallSeed(), actor, now });
    return { roomId, memberId };
  },
});

export const joinAnonymous = mutation({
  args: { code: v.string(), name: v.string(), authToken: v.string(), anon: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", a.code.toUpperCase())).first();
    if (!room) return null;
    const identity = await getRequiredProductionIdentity(ctx);
    const now = Date.now();
    const anon = a.anon ?? true;
    if (a.name.length > MAX_NAME_LEN) throw new Error("field_too_long");
    const existing = await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect();
    // Abuse gates: room capacity + join-rate window (joins are members created in the last 60s).
    if (existing.length >= MAX_MEMBERS_PER_ROOM) return { error: "room_full" as const };
    const recentJoins = existing.filter((m) => m._creationTime > now - 60_000).length;
    if (recentJoins >= MAX_JOINS_PER_MINUTE) return { error: "join_rate_limited" as const };
    const count = existing.length;
    const memberId = await ctx.db.insert("members", { roomId: room._id, name: a.name, role: "member", anon, color: palette[count % palette.length], authTokenHash: await hashToken(a.authToken), authSubject: identity?.subject, lastSeenAt: now });
    await ctx.db.insert("traces", { roomId: room._id, ts: now, actor: { kind: "user", id: memberId, name: a.name }, type: "member_joined", summary: `${a.name} joined${anon ? " (anon)" : ""}` });
    return { roomId: room._id, memberId };
  },
});

export const leave = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (!member || String(member.roomId) !== String(roomId)) throw new Error("actor_not_in_room");
    const now = Date.now();
    await ctx.db.patch(member._id, { revokedAt: now, lastSeenAt: now });
    await ctx.db.insert("traces", {
      roomId,
      ts: now,
      actor,
      type: "member_left",
      summary: `${actor.name} left the room`,
    });
    return { ok: true as const };
  },
});

export const get = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.get(roomId);
  },
});
export const members = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
  },
});

export const byCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code.toUpperCase())).first();
    return r ? { roomId: r._id } : null;
  },
});

/** One reactive query that returns the whole room reshaped into the engine's
 * types, so the existing presentational components render Convex data unchanged. */
export const full = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    await requireActorProof(ctx, roomId, requester);
    const members = (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
    const arts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const artifacts = [];
    for (const a of arts) {
      const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a._id)).collect();
      const elements: Record<string, unknown> = {};
      for (const e of els) elements[e.elementId] = { id: e.elementId, version: e.version, value: e.value, updatedAt: e.updatedAt, updatedBy: e.updatedBy };
      artifacts.push({ id: a._id, roomId: a.roomId, kind: a.kind, title: a.title, version: a.version, order: a.order, elements, updatedAt: a.updatedAt, meta: a.meta });
    }
    const locks = (await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect())
      .map((l) => ({ id: l._id, roomId: l.roomId, artifactId: l.artifactId, elementIds: l.elementIds, holder: l.holder, sessionId: l.sessionId, reason: l.reason, status: l.status, createdAt: l._creationTime }));
    const sessions = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((s) => ({ id: s._id, roomId: s.roomId, agentId: s.agentId, agentName: s.agentName, scope: s.scope, ownerId: s.ownerId, status: s.status, heldLockId: s.heldLockId, lastAction: s.lastAction, updatedAt: s.updatedAt }));
    // P1-1: a private-scoped draft must redact its OPS too, not just the note — `ops` carries the
    // actual cell edits (elementId + value), which previously leaked verbatim to every member.
    // The draft's owner still sees their own ops; everyone else gets [] + an opsRedacted count.
    const drafts = (await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect())
      .map((d) => {
        const redact = d.author.scope === "private" && !(d.author.ownerId !== undefined && d.author.ownerId === requester.actor.id);
        return {
          id: d._id, roomId: d.roomId, artifactId: d.artifactId, author: d.author,
          ops: redact ? [] : d.ops,
          opsRedacted: redact ? d.ops.length : undefined,
          note: redact ? "[private draft]" : d.note,
          blockedByLockId: d.blockedByLockId, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt,
        };
      });
    return {
      room: { id: room._id, code: room.code, title: room.title, hostId: room.hostId, autoAllow: room.autoAllow, status: room.status, createdAt: room.createdAt },
      members, artifacts, locks, sessions, drafts,
    };
  },
});

// B1: the narrow companion to `full` — the room shell WITHOUT cell elements. Its read-set is the
// rooms/members/artifacts/locks/sessions/drafts rows, none of which change on a cell edit, so a
// keystroke does NOT re-run/re-ship this query. Clients pair it with `artifacts.elements(openArtifactId)`
// so one edit re-ships only the edited artifact's cells, not the whole room (O(E·U) -> O(edited-artifact)).
// `full` is kept for back-compat until the client migrates.
export const meta = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    await requireActorProof(ctx, roomId, requester);
    const members = (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
    const arts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const artifacts = arts.map((a) => ({ id: a._id, roomId: a.roomId, kind: a.kind, title: a.title, version: a.version, order: a.order, updatedAt: a.updatedAt, meta: a.meta }));
    const locks = (await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect())
      .map((l) => ({ id: l._id, roomId: l.roomId, artifactId: l.artifactId, elementIds: l.elementIds, holder: l.holder, sessionId: l.sessionId, reason: l.reason, status: l.status, createdAt: l._creationTime }));
    const sessions = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((s) => ({ id: s._id, roomId: s.roomId, agentId: s.agentId, agentName: s.agentName, scope: s.scope, ownerId: s.ownerId, status: s.status, heldLockId: s.heldLockId, lastAction: s.lastAction, updatedAt: s.updatedAt }));
    const drafts = (await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect())
      .map((d) => {
        const redact = d.author.scope === "private" && !(d.author.ownerId !== undefined && d.author.ownerId === requester.actor.id);
        return {
          id: d._id, roomId: d.roomId, artifactId: d.artifactId, author: d.author,
          ops: redact ? [] : d.ops,
          opsRedacted: redact ? d.ops.length : undefined,
          note: redact ? "[private draft]" : d.note,
          blockedByLockId: d.blockedByLockId, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt,
        };
      });
    return {
      room: { id: room._id, code: room.code, title: room.title, hostId: room.hostId, autoAllow: room.autoAllow, status: room.status, createdAt: room.createdAt },
      members, artifacts, locks, sessions, drafts,
    };
  },
});

export const toggleAutoAllow = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const r = await ctx.db.get(roomId);
    if (!r) return;
    const actor = await requireActorProof(ctx, roomId, requester);
    if (String(r.hostId) !== actor.id) throw new Error("host_required");
    await ctx.db.patch(roomId, { autoAllow: !r.autoAllow });
    await ctx.db.insert("traces", { roomId, ts: Date.now(), actor, type: "auto_allow_toggled", summary: `${actor.name} turned auto-allow ${!r.autoAllow ? "on" : "off"}` });
  },
});
