/** The chat backend. send() is IDEMPOTENT on clientMsgId — the same key collapses
 * to one row, which is exactly what makes the UI's optimistic insert safe to
 * reconcile (the optimistic row and the server row share the clientMsgId). */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, actorV, requireActorCanUseChannel, requireActorInRoom, requireActorProof, type ActorValue } from "./lib";

type SendArgs = {
  roomId: Id<"rooms">;
  channel: string;
  author: ActorValue;
  text: string;
  clientMsgId: string;
  kind?: "chat" | "agent" | "system";
};

async function sendCore(ctx: MutationCtx, a: SendArgs) {
    await requireActorCanUseChannel(ctx, a.roomId, a.author, a.channel);
    const existing = await ctx.db.query("messages").withIndex("by_clientMsgId", (q) => q.eq("roomId", a.roomId).eq("clientMsgId", a.clientMsgId)).unique();
    if (existing) return existing._id; // idempotent send
    return ctx.db.insert("messages", { roomId: a.roomId, channel: a.channel, author: a.author, text: a.text, clientMsgId: a.clientMsgId, kind: a.kind ?? "chat", createdAt: Date.now() });
}

export const send = mutation({
  args: { roomId: v.id("rooms"), channel: v.string(), proof: actorProofV, text: v.string(), clientMsgId: v.string(), kind: v.optional(v.union(v.literal("chat"), v.literal("agent"), v.literal("system"))) },
  handler: async (ctx, a) => sendCore(ctx, { ...a, author: await requireActorProof(ctx, a.roomId, a.proof), kind: "chat" }),
});

export const sendAgent = internalMutation({
  args: { roomId: v.id("rooms"), channel: v.string(), author: actorV, text: v.string(), clientMsgId: v.string(), kind: v.optional(v.union(v.literal("chat"), v.literal("agent"), v.literal("system"))) },
  handler: sendCore,
});

/** Trusted (server-only) post of a PRIVATE NodeAgent reply to a member's own private channel.
 * Ensures the member's private agent session exists (joiners don't get one at join time), then posts
 * as the private agent. Idempotent on clientMsgId. Never callable from the client. */
export const postPrivateAgentReply = internalMutation({
  args: { roomId: v.id("rooms"), ownerId: v.string(), text: v.string(), clientMsgId: v.string() },
  handler: async (ctx, a) => {
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).collect();
    const has = sessions.some((s) => s.agentId === "agent_priv" && s.scope === "private" && s.ownerId === a.ownerId);
    if (!has) {
      await ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: a.ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() });
    }
    const existing = await ctx.db.query("messages").withIndex("by_clientMsgId", (q) => q.eq("roomId", a.roomId).eq("clientMsgId", a.clientMsgId)).unique();
    if (existing) return existing._id;
    const author: ActorValue = { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: a.ownerId };
    // channel for a private message is the owning member id; only that member's client subscribes to it.
    return ctx.db.insert("messages", { roomId: a.roomId, channel: a.ownerId, author, text: a.text, clientMsgId: a.clientMsgId, kind: "agent", createdAt: Date.now() });
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), channel: v.string(), requester: actorProofV },
  handler: async (ctx, { roomId, channel, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    await requireActorCanUseChannel(ctx, roomId, actor, channel);
    return ctx.db.query("messages").withIndex("by_room_channel", (q) => q.eq("roomId", roomId).eq("channel", channel)).collect();
  },
});

/** Edit your own message in place — only the original author may.
 * Returns a discriminated result so the client can surface a rejected edit honestly
 * instead of silently no-op'ing (HONEST_STATUS). */
export const update = mutation({
  args: { messageId: v.id("messages"), text: v.string(), requester: actorProofV },
  handler: async (ctx, { messageId, text, requester }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return { ok: false as const, reason: "not_found" as const };
    const actor = await requireActorProof(ctx, m.roomId, requester);
    if (m.author.id !== actor.id) return { ok: false as const, reason: "not_author" as const };
    await requireActorInRoom(ctx, m.roomId, actor);
    await ctx.db.patch(messageId, { text });
    return { ok: true as const };
  },
});
