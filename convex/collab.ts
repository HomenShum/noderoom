/** Awareness + agent sessions + traces — the "what else is happening" the agent
 * (and the UI) reads before acting. awareness() is the query buildContext() pulls. */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

export const awareness = internalQuery({
  args: { roomId: v.id("rooms"), excludeAgentId: v.optional(v.string()) },
  handler: async (ctx, { roomId, excludeAgentId }) => {
    const locks = await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect();
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const traces = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(6);
    const room = await ctx.db.get(roomId);
    return {
      activeLocks: locks.filter((l) => l.holder.id !== excludeAgentId).map((l) => ({ lockId: l._id, elementIds: l.elementIds, holder: l.holder.name, reason: l.reason })),
      agents: sessions.filter((s) => s.agentId !== excludeAgentId).map((s) => ({ name: s.agentName, scope: s.scope, status: s.status })),
      recentTrace: traces.reverse().map((t) => `${t.type}: ${t.summary}`),
      // Surfaced so the agent's context can explain REVIEW MODE — without it the model reads
      // pendingApproval tool results as failures (live 0/3 incident: budget-burn or wander-and-quit).
      autoAllow: room?.autoAllow,
    };
  },
});

export const startSession = internalMutation({
  args: { roomId: v.id("rooms"), agentId: v.string(), agentName: v.string(), scope: v.union(v.literal("public"), v.literal("private")), ownerId: v.optional(v.string()) },
  handler: (ctx, a) => ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: a.agentId, agentName: a.agentName, scope: a.scope, ownerId: a.ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() }),
});

/** Ensure (upsert) the PUBLIC-acting personal agent session for a member, so their agent can act in the
 * shared room (edit the sheet, post public chat) attributed to them. Returns the session id. */
export const ensurePersonalPublicSession = internalMutation({
  args: { roomId: v.id("rooms"), ownerId: v.string() },
  handler: async (ctx, a) => {
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).collect();
    const found = sessions.find((s) => s.agentId === "agent_priv" && s.scope === "public" && s.ownerId === a.ownerId);
    if (found) return found._id;
    return ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "public", ownerId: a.ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() });
  },
});

export const updateSession = internalMutation({
  args: { sessionId: v.id("agentSessions"), status: v.optional(v.union(v.literal("idle"), v.literal("working"), v.literal("blocked"), v.literal("drafting"), v.literal("done"))), heldLockId: v.optional(v.string()), lastAction: v.optional(v.string()) },
  handler: async (ctx, { sessionId, ...patch }) => { await ctx.db.patch(sessionId, { ...patch, updatedAt: Date.now() }); },
});

export const traces = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  },
});
