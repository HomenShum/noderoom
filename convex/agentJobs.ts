import { v } from "convex/values";
import { cancel as cancelWorkflow, start } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { actorProofV, requireActorProof, requireArtifactInRoom } from "./lib";

const attemptStatusV = v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("failed"));

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

export const startFreeAuto = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    const now = Date.now();
    const maxAttempts = Math.max(1, Math.min(a.maxAttempts ?? 20, 100));
    const jobId = await ctx.db.insert("agentJobs", clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: actor,
      goal: a.goal,
      mode: a.mode,
      status: "queued",
      modelPolicy: "openrouter/free-auto",
      runtime: "workflow",
      attempts: 0,
      maxAttempts,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    const workflowId = await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    });
    await ctx.db.patch(jobId, { workflowId: String(workflowId), updatedAt: now });
    return jobId;
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(20);
  },
});

export const attempts = query({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return [];
    await requireActorProof(ctx, job.roomId, requester);
    return ctx.db.query("agentJobAttempts").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
  },
});

export const cancel = mutation({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    await requireActorProof(ctx, job.roomId, requester);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal" as const };
    }
    const now = Date.now();
    if (job.workflowId) await cancelWorkflow(ctx, components.workflow, job.workflowId as never);
    await ctx.db.patch(jobId, {
      status: "cancelled",
      leaseId: "",
      leaseUntil: 0,
      error: "cancelled_by_user",
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const retry = mutation({
  args: {
    jobId: v.id("agentJobs"),
    requester: actorProofV,
    additionalAttempts: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, requester, additionalAttempts }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    await requireActorProof(ctx, job.roomId, requester);
    if (job.status === "completed" || job.status === "running") {
      return { ok: false as const, reason: "not_retryable" as const };
    }
    const now = Date.now();
    const extra = Math.max(1, Math.min(additionalAttempts ?? 10, 50));
    const maxAttempts = Math.max(job.maxAttempts, job.attempts + extra);
    const workflowId = await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    });
    await ctx.db.patch(jobId, {
      status: "queued",
      maxAttempts,
      leaseId: "",
      leaseUntil: 0,
      nextRunAt: now,
      runtime: "workflow",
      workflowId: String(workflowId),
      error: undefined,
      updatedAt: now,
    });
    return { ok: true as const, maxAttempts };
  },
});

export const workflowState = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    const terminal = !job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled";
    return {
      terminal,
      status: job?.status ?? "missing",
      nextRunAt: job?.nextRunAt,
      attempts: job?.attempts ?? 0,
      maxAttempts: job?.maxAttempts ?? 0,
      now: Date.now(),
    };
  },
});

export const markWorkflowExceeded = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal_or_missing" as const };
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "failed",
      leaseId: "",
      leaseUntil: 0,
      error: "workflow_slice_limit_exceeded",
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const recordWorkflowComplete = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    workflowId: v.string(),
    resultKind: v.union(v.literal("success"), v.literal("failed"), v.literal("canceled")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, workflowId, resultKind, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "missing" as const };
    if (job.workflowId && job.workflowId !== workflowId) return { ok: false as const, reason: "stale_workflow" as const };
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: true as const, terminal: true as const };
    }
    if (resultKind === "success") return { ok: true as const, terminal: false as const };
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: resultKind === "canceled" ? "cancelled" : "failed",
      leaseId: "",
      leaseUntil: 0,
      error: resultKind === "canceled" ? "workflow_cancelled" : error ?? "workflow_failed",
      updatedAt: now,
    });
    return { ok: true as const, terminal: true as const };
  },
});

export const claimSlice = internalMutation({
  args: { jobId: v.id("agentJobs"), leaseId: v.string(), leaseMs: v.number() },
  handler: async (ctx, { jobId, leaseId, leaseMs }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") return null;
    const now = Date.now();
    if (job.status === "running" && job.leaseUntil && job.leaseUntil > now) return null;

    const art = await ctx.db.get(job.artifactId);
    if (!art || String(art.roomId) !== String(job.roomId)) {
      await ctx.db.patch(jobId, { status: "failed", error: "artifact_room_mismatch", updatedAt: now });
      return null;
    }
    let session = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", job.roomId)).collect())
      .find((s) => s.scope === "public");
    if (!session) {
      const sessionId = await ctx.db.insert("agentSessions", {
        roomId: job.roomId,
        agentId: "agent_room",
        agentName: "Room NodeAgent",
        scope: "public",
        status: "idle",
        lastAction: "started",
        updatedAt: now,
      });
      session = await ctx.db.get(sessionId) ?? undefined;
    }
    if (!session) {
      await ctx.db.patch(jobId, { status: "blocked", error: "agent_session_create_failed", updatedAt: now });
      return null;
    }

    const attempt = job.attempts + 1;
    await ctx.db.patch(jobId, {
      status: "running",
      attempts: attempt,
      leaseId,
      leaseUntil: now + Math.max(1_000, leaseMs),
      updatedAt: now,
    });

    return {
      jobId,
      roomId: job.roomId,
      artifactId: job.artifactId,
      requester: job.requester,
      goal: job.goal,
      mode: job.mode,
      modelPolicy: job.modelPolicy,
      cursor: job.cursor,
      handoff: job.handoff,
      attempt,
      maxAttempts: job.maxAttempts,
      sessionId: session._id,
      agentId: session.agentId,
      agentName: session.agentName,
    };
  },
});

export const finishSlice = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    attempt: v.number(),
    status: attemptStatusV,
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    runId: v.optional(v.id("agentRuns")),
    error: v.optional(v.string()),
    handoff: v.optional(v.any()),
    cursor: v.optional(v.any()),
    finalText: v.optional(v.string()),
    scheduledNextAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (job.leaseId !== a.leaseId) return { ok: false as const, reason: "lease_mismatch" as const };
    const now = Date.now();
    await ctx.db.insert("agentJobAttempts", clean({
      jobId: a.jobId,
      runId: a.runId,
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
      startedAt: now - a.ms,
      endedAt: now,
    }));

    const nextStatus =
      a.status === "completed" ? "completed" :
      a.status === "failed" ? "failed" :
      a.status === "retrying" ? "retrying" :
      "paused";

    const patch: Record<string, unknown> = {
      status: nextStatus,
      leaseId: "",
      leaseUntil: 0,
      updatedAt: now,
    };
    if (a.runId) patch.latestRunId = a.runId;
    if (a.handoff !== undefined) patch.handoff = a.handoff;
    if (a.cursor !== undefined) patch.cursor = a.cursor;
    if (a.finalText !== undefined) patch.finalText = a.finalText;
    if (a.error !== undefined) patch.error = a.error;
    if (a.scheduledNextAt !== undefined) patch.nextRunAt = a.scheduledNextAt;
    if (nextStatus === "completed") patch.completedAt = now;
    await ctx.db.patch(a.jobId, patch as any);
    if (a.scheduledNextAt !== undefined && nextStatus !== "failed" && job.runtime !== "workflow") {
      await ctx.scheduler.runAfter(Math.max(0, a.scheduledNextAt - now), internal.agentJobRunner.runFreeAutoJobSlice, { jobId: a.jobId });
    }
    return { ok: true as const };
  },
});
