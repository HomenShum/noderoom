/**
 * Backend for propose_lock / release_lock.
 *
 * Locks protect an affected element range. For spreadsheet artifacts the range
 * is expanded through formula dependencies before the lock is granted, so a
 * write to a driver cell also protects downstream formula cells from concurrent
 * human or agent edits.
 */

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, actorV, activeLockOn, requireActorInRoom, requireActorProof, requireAgentSession, requireArtifactInRoom, sameActor } from "./lib";
import { mergeBlockedDrafts } from "./drafts";
import { expandElementIdsWithSpreadsheetDependencies } from "./spreadsheetIndexLib";

export const proposeLock = internalMutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), elementIds: v.array(v.string()), holder: actorV, sessionId: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.holder);
    await requireAgentSession(ctx, a.roomId, a.sessionId, a.holder);
    const elementIds = await expandElementIdsWithSpreadsheetDependencies(ctx, a.artifactId, a.elementIds);

    for (const id of elementIds) {
      const lk = await activeLockOn(ctx, a.artifactId, id);
      if (lk && lk.holder.id !== a.holder.id) {
        return { ok: false as const, reason: `range already locked by ${lk.holder.name}`, lockId: lk._id };
      }
    }

    const now = Date.now();
    const LOCK_TTL_MS = 5 * 60_000; // lease TTL — a crashed holder's lock auto-expires (no cell blocks forever)
    const lockId = await ctx.db.insert("locks", {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementIds,
      holder: a.holder,
      sessionId: a.sessionId,
      reason: a.reason,
      status: "active",
      createdAt: now,
      expiresAt: now + LOCK_TTL_MS,
    });
    if (a.holder.kind === "agent") {
      await ctx.db.patch(a.sessionId as never, {
        status: "working",
        heldLockId: String(lockId),
        lastAction: `locked ${elementIds.join(",")}`,
        updatedAt: now,
      });
    }
    const expansion = elementIds.length > a.elementIds.length
      ? `; expanded to [${elementIds.join(", ")}] via spreadsheet dependencies`
      : "";
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: a.holder,
      type: "lock_acquired",
      summary: `${a.holder.name} locked ${elementIds.join(", ")} - ${a.reason}`,
      detail: `propose_lock [${a.elementIds.join(", ")}]${expansion} reason="${a.reason}" -> ok`,
    });
    return { ok: true as const, lockId };
  },
});

export const releaseLock = internalMutation({
  args: { lockId: v.id("locks"), actor: actorV },
  handler: async (ctx, { lockId, actor }) => {
    const lock = await ctx.db.get(lockId);
    if (!lock || lock.status !== "active") return { ok: false as const, reason: "not_active", merged: [] };
    await requireActorInRoom(ctx, lock.roomId, actor);
    if (!sameActor(lock.holder, actor)) {
      await ctx.db.insert("traces", {
        roomId: lock.roomId,
        ts: Date.now(),
        actor,
        type: "lock_denied",
        summary: `${actor.name} tried to release a lock held by ${lock.holder.name}`,
        detail: `release_lock ${lockId} -> denied: not holder`,
      });
      return { ok: false as const, reason: "not_holder", merged: [] };
    }
    const now = Date.now();
    await ctx.db.patch(lockId, { status: "released", releasedAt: now });
    if (actor.kind === "agent") await ctx.db.patch(lock.sessionId as never, { status: "done", heldLockId: undefined, lastAction: "released lock", updatedAt: now });
    await ctx.db.insert("traces", {
      roomId: lock.roomId,
      ts: now,
      actor,
      type: "lock_released",
      summary: `${actor.name} released the lock on ${lock.elementIds.join(", ")}`,
      detail: `release_lock ${lockId} -> smart-merge waiting drafts`,
    });
    const merged = await mergeBlockedDrafts(ctx, lock.roomId, lockId);
    return { ok: true as const, merged };
  },
});

export const activeLocks = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect();
  },
});
