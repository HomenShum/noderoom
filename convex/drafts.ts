/**
 * The backend for the create_draft tool + the smart-merge.
 *
 * A draft is what a blocked actor produces: it read a locked range as context and
 * queued ops to apply once the lock lifts. `mergeBlockedDrafts` is the
 * deterministic resolver (the LLM-resolver seam): for each op, clean-apply if the
 * element is still at the drafted baseline, no-op if it already holds the value,
 * and FLAG-don't-apply if it diverged — so committed work is never clobbered.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorV, activeLockOn, getElement, requireActorInRoom, requireArtifactInRoom, sameActor } from "./lib";

const opV = v.object({
  opId: v.string(),
  artifactId: v.string(),
  elementId: v.string(),
  kind: v.union(v.literal("set"), v.literal("create"), v.literal("delete")),
  value: v.optional(v.any()),
  baseVersion: v.number(),
});

export const createDraft = internalMutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), author: actorV, ops: v.array(opV), note: v.string(), blockedByLockId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.author);
    const now = Date.now();
    const draftId = await ctx.db.insert("drafts", { roomId: a.roomId, artifactId: a.artifactId, author: a.author, ops: a.ops, note: a.note, blockedByLockId: a.blockedByLockId, status: "pending", createdAt: now });
    const note = a.author.scope === "private" ? "[private draft]" : a.note;
    await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor: a.author, type: "draft_created", summary: `${a.author.name} drafted ${a.ops.length} change(s): ${note}`, detail: `create_draft · ${a.ops.length} ops · blockedBy ${a.blockedByLockId ?? "—"}` });
    return { draftId };
  },
});

export async function mergeBlockedDrafts(ctx: MutationCtx, roomId: Id<"rooms">, lockId: string) {
  const drafts = await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect();
  const now = Date.now();
  const results: { draftId: Id<"drafts">; verdict: string; applied: number; conflicts: number }[] = [];

  for (const d of drafts) {
    if (d.blockedByLockId !== lockId) continue;
    const applied: string[] = [];
    const conflicts: { opId: string; elementId: string }[] = [];

    for (const op of d.ops) {
      const lock = await activeLockOn(ctx, d.artifactId, op.elementId);
      if (lock && !sameActor(lock.holder, d.author)) {
        conflicts.push({ opId: op.opId, elementId: op.elementId });
        continue;
      }
      const el = await getElement(ctx, d.artifactId, op.elementId);
      const cur = el?.version ?? 0;
      if (cur === op.baseVersion) {
        if (el) await ctx.db.patch(el._id, { value: op.value, version: cur + 1, updatedAt: now, updatedBy: d.author });
        else await ctx.db.insert("elements", { artifactId: d.artifactId, elementId: op.elementId, value: op.value, version: 1, updatedAt: now, updatedBy: d.author });
        applied.push(op.opId);
      } else if (el && JSON.stringify(el.value) === JSON.stringify(op.value)) {
        applied.push(op.opId); // already there — no-op
      } else {
        conflicts.push({ opId: op.opId, elementId: op.elementId }); // diverged — flag, never clobber
      }
    }

    const verdict = conflicts.length ? "needs_review" : "clean";
    await ctx.db.patch(d._id, { status: conflicts.length ? "conflict" : "merged", resolvedAt: now });
    if (applied.length) { const art = await ctx.db.get(d.artifactId); if (art) await ctx.db.patch(d.artifactId, { version: art.version + 1, updatedAt: now }); }
    const note = d.author.scope === "private" ? "[private draft]" : d.note;
    await ctx.db.insert("traces", { roomId, ts: now, actor: d.author, type: conflicts.length ? "draft_conflict" : "draft_merged", summary: `Smart-merge (${verdict}): ${applied.length} applied, ${conflicts.length} flagged — ${note}`, detail: `smart_merge · ${applied.length} applied, ${conflicts.length} flagged → ${verdict}` });
    results.push({ draftId: d._id, verdict, applied: applied.length, conflicts: conflicts.length });
  }
  return results;
}
