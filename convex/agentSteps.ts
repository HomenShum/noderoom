/**
 * Step-level agent trace — APPEND-ONLY, tamper-evident, the audit + trajectory-eval record.
 * Written once per run by the runRoomAgent action; never updated or deleted (corrections
 * are new compensating runs, per SEC 17a-4(f) / SOX §802).
 *
 *   - record:    insert the run's steps, each chained by SHA-256 (recordHash ← prevStepHash).
 *   - byRun:     the full ordered (tool · args → result · status) sequence — trajectory eval + replay.
 *   - byElement: every agent write that touched a cell — finance provenance ("why is this value").
 *   - verify:    re-walk the hash chain — proves no past step was altered.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

const statusV = v.union(v.literal("ok"), v.literal("conflict"), v.literal("locked"), v.literal("error"));
const stepV = v.object({
  idx: v.number(), tool: v.string(), args: v.string(), result: v.string(),
  status: statusV, ms: v.number(), elementId: v.optional(v.string()),
  affectedObjectIds: v.optional(v.array(v.string())),
  mutationReceiptIds: v.optional(v.array(v.id("agentMutationReceipts"))),
});

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Deterministic, sorted-key serialization (DETERMINISTIC rule) for stable hashing. */
const canonical = (o: Record<string, unknown>) =>
  JSON.stringify(Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = o[k]; return acc; }, {}));
const core = (s: { runId: string; roomId: string; agentId: string; idx: number; tool: string; args: string; result: string; status: string; ms: number; elementId?: string; prevStepHash: string }) =>
  ({ runId: s.runId, roomId: s.roomId, agentId: s.agentId, idx: s.idx, tool: s.tool, args: s.args, result: s.result, status: s.status, ms: s.ms, elementId: s.elementId ?? "", prevStepHash: s.prevStepHash });

export const record = internalMutation({
  args: { jobId: v.optional(v.id("agentJobs")), runId: v.id("agentRuns"), roomId: v.id("rooms"), agentId: v.string(), steps: v.array(stepV) },
  handler: async (ctx, a) => {
    const ts = Date.now();
    let prevStepHash = `genesis:${a.runId}`;
    for (const s of a.steps) {
      const recordHash = await sha256hex(canonical(core({ runId: a.runId, roomId: a.roomId, agentId: a.agentId, ...s, prevStepHash })));
      await ctx.db.insert("agentSteps", { jobId: a.jobId, runId: a.runId, roomId: a.roomId, agentId: a.agentId, idx: s.idx, tool: s.tool, args: s.args, result: s.result, status: s.status, ms: s.ms, elementId: s.elementId, affectedObjectIds: s.affectedObjectIds, mutationReceiptIds: s.mutationReceiptIds, ts, recordHash, prevStepHash });
      prevStepHash = recordHash;
    }
  },
});

export const byRun = query({
  args: { runId: v.id("agentRuns"), requester: actorProofV },
  handler: async (ctx, { runId, requester }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
    await requireActorProof(ctx, run.roomId, requester);
    return ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  },
});

export const byElement = query({
  args: { roomId: v.id("rooms"), elementId: v.string(), requester: actorProofV },
  handler: async (ctx, { roomId, elementId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("agentSteps").withIndex("by_room_element", (q) => q.eq("roomId", roomId).eq("elementId", elementId)).order("desc").collect();
  },
});

export const verify = query({
  args: { runId: v.id("agentRuns"), requester: actorProofV },
  handler: async (ctx, { runId, requester }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { valid: false, steps: 0, reason: "run_not_found" };
    await requireActorProof(ctx, run.roomId, requester);
    const steps = await ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    let prevStepHash = `genesis:${runId}`;
    for (const s of steps) {
      if (s.prevStepHash !== prevStepHash) return { valid: false, brokenAt: s.idx, reason: "chain link mismatch" };
      const expected = await sha256hex(canonical(core({ ...s, runId: s.runId, roomId: s.roomId, prevStepHash })));
      if (expected !== s.recordHash) return { valid: false, brokenAt: s.idx, reason: "record hash mismatch — tampered" };
      prevStepHash = s.recordHash;
    }
    return { valid: true, steps: steps.length };
  },
});
