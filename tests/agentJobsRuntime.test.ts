// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

describe("agentJobs runtime contract", () => {
  it("dedupes createOrReuse by idempotency key and records one creation operation", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const args = jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-dedupe" });

    const first = await t.mutation(api.agentJobs.createOrReuse, args);
    const second = await t.mutation(api.agentJobs.createOrReuse, args);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(String(second.jobId)).toBe(String(first.jobId));

    const detail = await t.query(api.agentJobs.detail, { jobId: first.jobId, requester: proof });
    expect(detail?.operations.filter((event) => event.name === "agentJobs.createOrReuse")).toHaveLength(1);
    expect(detail?.job.mutationCount).toBe(1);
  });

  it("finishInteractive writes attempts, operation events, and materialized counters", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-finish" }));

    await t.mutation(internal.agentJobs.finishInteractive, {
      jobId,
      status: "completed",
      finalText: "done",
      resolvedModel: "test-model",
      stopReason: "done",
      ms: 1200,
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.001,
      modelCalls: 1,
      toolCalls: 2,
      queryCount: 3,
      mutationCount: 4,
      receiptCount: 1,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.attempts).toHaveLength(1);
    expect(detail?.job.status).toBe("completed");
    expect(detail?.job.finalText).toBe("done");
    expect(detail?.operations.map((event) => event.kind)).toEqual(expect.arrayContaining(["action", "model_call", "tool_call", "checkpoint"]));
    expect(detail?.job.queryCount).toBe(3);
    expect(detail?.job.mutationCount).toBe(5);
    expect(detail?.job.receiptCount).toBe(1);
  });

  it("records durable model-step journal rows and replays without overwriting", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-journal" }));
    const result = {
      text: "",
      toolCalls: [{ id: "call-1", tool: "read_range", args: { elementIds: ["row1__variance"] } }],
      done: false,
      usage: { inputTokens: 12, outputTokens: 3 },
    };

    const first = await t.mutation(internal.agentStepJournal.record, {
      jobId,
      sliceKey: "slice-a",
      step: 0,
      model: "gemini-3.5-flash",
      inputHash: "slice-a",
      outputHash: "out-a",
      result,
    });
    const replay = await t.query(internal.agentStepJournal.get, { jobId, sliceKey: "slice-a", step: 0 });
    const second = await t.mutation(internal.agentStepJournal.record, {
      jobId,
      sliceKey: "slice-a",
      step: 0,
      model: "gemini-3.5-flash",
      inputHash: "slice-a",
      outputHash: "out-b",
      result: { text: "overwritten", toolCalls: [], done: true },
    });
    const replayAfterDuplicate = await t.query(internal.agentStepJournal.get, { jobId, sliceKey: "slice-a", step: 0 });
    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(replay).toEqual(result);
    expect(replayAfterDuplicate).toEqual(result);
    expect(detail?.modelJournal).toHaveLength(1);
    expect(detail?.modelJournal[0].outputHash).toBe("out-a");
  });

  it("claimSlice creates an active lease and finishSlice releases it only for the matching lease", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-lease" }));

    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-ok", leaseMs: 60_000 });
    expect(claimed?.attempt).toBe(1);

    const mismatch = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-wrong", attempt: 1 }));
    expect(mismatch).toEqual({ ok: false, reason: "lease_mismatch" });

    const finished = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-ok", attempt: 1 }));
    expect(finished).toEqual({ ok: true });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.leases.map((lease) => lease.status)).toContain("released");
    expect(detail?.job.leaseId).toBe("");
  });

  it("agent cell edits write mutation receipts and stale CAS conflicts do not", async () => {
    const { t, proof, actor, roomId, artifactId } = await setupRoom({ seedElement: true });
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-receipt" }));

    const applied = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__variance",
      value: "8%",
      baseVersion: 1,
      actor,
      jobId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("expected applyAgentCellEdit to succeed");
    expect(applied.mutationReceiptId).toBeTruthy();

    const conflict = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__variance",
      value: "9%",
      baseVersion: 1,
      actor,
      jobId,
    });
    expect(conflict).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.receipts).toHaveLength(1);
    expect(detail?.job.receiptCount).toBe(1);
  });

  it("restricts cancel and retry controls to the requester or room host", async () => {
    const { t, proof, memberProof, roomId, artifactId } = await setupRoom({ extraMember: true });
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-rbac" }));

    const deniedCancel = await t.mutation(api.agentJobs.cancel, { jobId, requester: memberProof });
    const deniedRetry = await t.mutation(api.agentJobs.retry, { jobId, requester: memberProof });
    const allowedCancel = await t.mutation(api.agentJobs.cancel, { jobId, requester: proof });

    expect(deniedCancel).toEqual({ ok: false, reason: "forbidden" });
    expect(deniedRetry).toEqual({ ok: false, reason: "forbidden" });
    expect(allowedCancel).toEqual({ ok: true });
  });
});

async function setupRoom(options: { seedElement?: boolean; extraMember?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: "Agent job runtime test",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  const proof = { actor, token };
  const memberToken = "abcdefghijklmnopqrstuvwxyz0123456789MEMBER";
  let memberProof = proof;
  if (options.extraMember) {
    const memberTokenHash = await hashToken(memberToken);
    const memberId = await t.run((ctx) =>
      ctx.db.insert("members", {
        roomId,
        name: "Member",
        role: "member" as const,
        anon: true,
        color: "#222222",
        authTokenHash: memberTokenHash,
        lastSeenAt: now,
      }),
    );
    memberProof = { actor: { kind: "user" as const, id: String(memberId), name: "Member" }, token: memberToken };
  }
  const order = options.seedElement ? ["row1__variance"] : [];
  const artifactId = await t.run((ctx) =>
    ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Runtime sheet",
      version: 1,
      order,
      updatedAt: now,
    }),
  );
  if (options.seedElement) {
    await t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId,
        elementId: "row1__variance",
        value: "7%",
        version: 1,
        updatedAt: now,
        updatedBy: actor,
      }),
    );
  }
  return { t, proof, memberProof, actor, roomId, artifactId };
}

function jobArgs(args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  proof: { actor: { kind: "user"; id: string; name: string }; token: string };
  idempotencyKey: string;
}) {
  return {
    roomId: args.roomId,
    artifactId: args.artifactId,
    requester: args.proof,
    goal: "Verify the unified agent job runtime",
    entrypoint: "public_ask" as const,
    scope: "public_room" as const,
    modelPolicy: "test-model",
    idempotencyKey: args.idempotencyKey,
    approvalPolicy: "auto_commit_safe" as const,
    evidencePolicy: "public_only" as const,
    autoAllow: true,
  };
}

function finishSliceArgs(args: { jobId: Id<"agentJobs">; leaseId: string; attempt: number }) {
  return {
    jobId: args.jobId,
    leaseId: args.leaseId,
    attempt: args.attempt,
    status: "completed" as const,
    resolvedModel: "test-model",
    stopReason: "done",
    ms: 100,
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.0001,
  };
}
