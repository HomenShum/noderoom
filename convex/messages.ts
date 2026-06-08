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

export const list = query({
  args: { roomId: v.id("rooms"), channel: v.string(), requester: actorProofV },
  handler: async (ctx, { roomId, channel, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    await requireActorCanUseChannel(ctx, roomId, actor, channel);
    return ctx.db.query("messages").withIndex("by_room_channel", (q) => q.eq("roomId", roomId).eq("channel", channel)).collect();
  },
});

/** Edit your own message in place — only the original author may. */
export const update = mutation({
  args: { messageId: v.id("messages"), text: v.string(), requester: actorProofV },
  handler: async (ctx, { messageId, text, requester }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return;
    const actor = await requireActorProof(ctx, m.roomId, requester);
    if (m.author.id !== actor.id) return;
    await requireActorInRoom(ctx, m.roomId, actor);
    await ctx.db.patch(messageId, { text });
  },
});
