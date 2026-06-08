import { v } from "convex/values";
import { WorkflowManager, getStatus, vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 3,
    retryActionsByDefault: false,
    defaultRetryBehavior: {
      maxAttempts: 2,
      initialBackoffMs: 2_000,
      base: 2,
    },
  },
});

const MAX_WORKFLOW_SLICES = 200;

export const freeAutoWorkflow = workflow.define({
  args: { jobId: v.id("agentJobs") },
  returns: v.null(),
}).handler(async (step, { jobId }): Promise<null> => {
  for (let slice = 0; slice < MAX_WORKFLOW_SLICES; slice++) {
    const before = await step.runMutation(internal.agentJobs.workflowState, { jobId }, { name: `free-auto-state-before-${slice}` });
    if (before.terminal) return null;
    const delayMs = Math.max(0, (before.nextRunAt ?? before.now) - before.now);
    if (delayMs > 0) await step.sleep(delayMs, { name: `free-auto-delay-${slice}` });
    await step.runAction(internal.agentJobRunner.runFreeAutoJobSlice, { jobId }, { name: `free-auto-slice-${slice + 1}`, retry: false });
    const after = await step.runMutation(internal.agentJobs.workflowState, { jobId }, { name: `free-auto-state-after-${slice}` });
    if (after.terminal) return null;
  }
  await step.runMutation(internal.agentJobs.markWorkflowExceeded, { jobId }, { name: "free-auto-workflow-exceeded" });
  return null;
});

export const freeAutoWorkflowComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("agentJobs") }),
  },
  handler: async (ctx, { workflowId, result, context }) => {
    await ctx.runMutation(internal.agentJobs.recordWorkflowComplete, {
      jobId: context.jobId,
      workflowId,
      resultKind: result.kind,
      error: result.kind === "failed" ? result.error : undefined,
    });
  },
});

export const status = query({
  args: { workflowId: v.string() },
  handler: async (ctx, { workflowId }) => getStatus(ctx, components.workflow, workflowId as never),
});
