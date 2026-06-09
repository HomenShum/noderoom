import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
  args: {
    jobId: v.id("agentJobs"),
    sliceKey: v.string(),
    step: v.number(),
  },
  handler: async (ctx, { jobId, sliceKey, step }) => {
    const row = await ctx.db
      .query("agentModelStepJournal")
      .withIndex("by_job_slice_step", (q) => q.eq("jobId", jobId).eq("sliceKey", sliceKey).eq("step", step))
      .order("asc")
      .first();
    return row?.result;
  },
});

export const record = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    sliceKey: v.string(),
    step: v.number(),
    model: v.string(),
    inputHash: v.string(),
    outputHash: v.string(),
    result: v.any(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("agentModelStepJournal")
      .withIndex("by_job_slice_step", (q) => q.eq("jobId", a.jobId).eq("sliceKey", a.sliceKey).eq("step", a.step))
      .order("asc")
      .first();
    if (existing) return { id: existing._id, reused: true as const };
    const now = Date.now();
    const id = await ctx.db.insert("agentModelStepJournal", {
      jobId: a.jobId,
      sliceKey: a.sliceKey,
      step: a.step,
      model: a.model,
      inputHash: a.inputHash,
      outputHash: a.outputHash,
      result: a.result,
      createdAt: now,
      updatedAt: now,
    });
    return { id, reused: false as const };
  },
});
