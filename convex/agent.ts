/**
 * The agent runtime on Convex.
 *
 * This is the production entry point. It is intentionally tiny: build a
 * ConvexRoomTools (the Convex-backed port), pick the real model, and call the
 * SAME runAgent the demo/tests use. The action returns a summary; the live
 * effects (locks, edits, traces, chat) are written through the mutations and
 * stream to every client via their reactive useQuery subscriptions.
 *
 * Requires the selected provider key in the Convex environment, e.g.
 *   npx convex env set OPENROUTER_API_KEY sk-or-...
 *
 * For thread/message persistence, retries past the 10-min action cap, and RAG,
 * wrap this with `@convex-dev/agent` + `@convex-dev/workflow` (see docs/STACK.md);
 * the harness below is the same loop those components run.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV } from "./lib";
import { ConvexRoomTools } from "./convexRoomTools";
import type { Actor } from "../src/engine/types";

/** Explicit return type — breaks the circular inference from referencing `api` inside an action that is itself in `api`. */
type RunResult = {
  finalText: string; jobId: Id<"agentJobs">; roomId: Id<"rooms">; agentId: string; model: string; goal: string;
  steps: number; toolCalls: number; conflictsSurvived: number; inputTokens: number; outputTokens: number;
  costUsd: number; ms: number; exhausted: boolean; stopReason: string; remainingMs: number | null; deadlineAt: number;
  modelCalls: number; runId: Id<"agentRuns">; handoff: unknown | null;
};
import { AgentRunError, runAgent } from "../src/agent/runtime";
import { ROOM_TOOLS } from "../src/agent/tools";
import { convexModel as agentModel, convexPriceRun as priceRun } from "../src/agent/convexModel";
import { buildResearchContext, buildNoteContext, buildWallContext } from "../src/agent/context";
import { runIdempotencyKey } from "../src/agent/idempotency";
import { compactMessages } from "../src/agent/compaction";
import { journalSliceKey } from "../src/agent/journal";
import { makeConvexStepJournal } from "./agentStepJournalClient";

const CONVEX_ACTION_LIMIT_MS = 10 * 60_000;
const DEFAULT_ACTION_RESERVE_MS = 30_000;
const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
const DEFAULT_CONTEXT_KEEP_RECENT = 10;
const roomsFullRef = makeFunctionReference<"query">("rooms:full");
const agentJobsCreateOrReuseRef = makeFunctionReference<"mutation">("agentJobs:createOrReuse") as any;
const agentJobsFinishInteractiveRef = makeFunctionReference<"mutation">("agentJobs:finishInteractive") as any;
const agentRunsClaimOrReuseRef = makeFunctionReference<"mutation">("agentRuns:claimOrReuse") as any;
const agentRunsFinishRef = makeFunctionReference<"mutation">("agentRuns:finish") as any;
const agentStepsRecordRef = makeFunctionReference<"mutation">("agentSteps:record") as any;
const postPrivateReplyRef = makeFunctionReference<"mutation">("messages:postPrivateAgentReply") as any;
const ensurePersonalPublicSessionRef = makeFunctionReference<"mutation">("collab:ensurePersonalPublicSession") as any;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

export const runRoomAgent = action({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    maxSteps: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    // When set, run as this member's PERSONAL agent acting publicly (attributed via ownerId) instead of the shared Room agent.
    asOwner: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  handler: async (ctx, a): Promise<RunResult> => {
    const t0 = Date.now();
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    const requester = roomState.members.find((m: { id: unknown }) => String(m.id) === a.requester.actor.id);
    if (!requester) throw new Error("member_required");
    const targetArtifact = roomState.artifacts.find((art: { id: unknown }) => String(art.id) === String(a.artifactId)) as { id: unknown; version?: number; kind?: string } | undefined;
    if (!targetArtifact) throw new Error("artifact_room_mismatch");
    let actor: Actor;
    let sessionId: string;
    if (a.asOwner) {
      // Personal agent acting publicly for a member: edits the shared sheet + posts public chat, attributed
      // via ownerId. Reuses this whole runner (idempotency, jobs, CAS, proposals, traces) — no fork of the spine.
      const sid = await ctx.runMutation(ensurePersonalPublicSessionRef, { roomId: a.roomId, ownerId: a.asOwner.id });
      actor = { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "public", ownerId: a.asOwner.id };
      sessionId = String(sid);
    } else {
      const session = roomState.sessions.find((s: { scope?: string; ownerId?: string; agentId: string; agentName: string; id: unknown }) => s.scope === "public" && !s.ownerId);
      if (!session) throw new Error("agent_session_mismatch");
      actor = { kind: "agent", id: session.agentId, name: session.agentName, scope: "public" };
      sessionId = String(session.id);
    }
    const model = agentModel(process.env.AGENT_MODEL ?? "gemini-3.5-flash"); // current recorded L1-L4 collaboration-safe fallback; override via AGENT_MODEL.
    const requestedSteps = a.maxSteps ?? (a.mode === "research" ? 60 : 10);
    const maxSteps = Math.max(1, Math.min(requestedSteps, a.mode === "research" ? 80 : 24));
    const actionBudgetMs = envNumber("AGENT_ACTION_BUDGET_MS", CONVEX_ACTION_LIMIT_MS, 60_000, CONVEX_ACTION_LIMIT_MS);
    const actionReserveMs = envNumber("AGENT_ACTION_RESERVE_MS", DEFAULT_ACTION_RESERVE_MS, 1_000, 120_000);
    const deadlineAt = t0 + actionBudgetMs;
    const compaction = {
      maxChars: envNumber("AGENT_CONTEXT_MAX_CHARS", DEFAULT_CONTEXT_MAX_CHARS, 4_000, 120_000),
      keepRecent: envNumber("AGENT_CONTEXT_KEEP_RECENT", DEFAULT_CONTEXT_KEEP_RECENT, 2, 40),
    };
    const cap = (s: string) => (s.length > 2000 ? s.slice(0, 2000) + "...[truncated]" : s);
    const errorText = (error: unknown) => {
      if (error instanceof Error) return `${error.name}: ${error.message}`;
      return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
    };
    const stepStatus = (e: { tool: string; result: unknown }): "ok" | "conflict" | "locked" | "error" => {
      const r = (e.result ?? {}) as { ok?: boolean; conflict?: boolean; locked?: boolean; error?: unknown; pendingApproval?: boolean };
      if (e.tool === "edit_cell") { if (r.conflict) return "conflict"; if (r.locked) return "locked"; }
      if (r.pendingApproval) return "ok"; // review mode: proposal filed = success, not an error
      if (r.error || r.ok === false) return "error";
      return "ok";
    };
    const traceStep = (e: { tool: string; args: unknown; result: unknown; ms: number }, i: number) => {
      const elementId = e.tool === "edit_cell" ? (String((e.args as { elementId?: string }).elementId ?? "") || undefined) : undefined;
      const mutationReceiptId = typeof (e.result as { mutationReceiptId?: unknown } | null)?.mutationReceiptId === "string"
        ? (e.result as { mutationReceiptId: Id<"agentMutationReceipts"> }).mutationReceiptId
        : undefined;
      return {
        idx: i, tool: e.tool, args: cap(JSON.stringify(e.args)), result: cap(JSON.stringify(e.result)), status: stepStatus(e), ms: e.ms,
        elementId,
        affectedObjectIds: elementId ? [elementId] : undefined,
        mutationReceiptIds: mutationReceiptId ? [mutationReceiptId] : undefined,
      };
    };
    const checkpointCursor = async (r: {
      messages: unknown[];
      handoff?: { remainingToolCalls?: unknown[] };
      stopReason: string;
    }) => {
      const compacted = await compactMessages(r.messages as any, compaction);
      return {
        messages: compacted.messages,
        remainingToolCalls: r.handoff?.remainingToolCalls ?? [],
        stopReason: r.stopReason,
        compacted: compacted.compacted,
        elided: compacted.elided,
        updatedAt: Date.now(),
      };
    };
    // Idempotency (async_reliability layer 1): a double-submit / client retry must not launch a second
    // concurrent run racing the same locks/CAS. ATOMIC claim-or-reuse (one serializable mutation) — no
    // TOCTOU window between the dedup check and the claim. Runtime-proven in tests/idempotencyRuntime.test.ts.
    const idempotencyKey = runIdempotencyKey({ roomId: String(a.roomId), artifactId: String(a.artifactId), actorId: String(a.requester.actor.id), goal: a.goal });
    const jobClaim = await ctx.runMutation(agentJobsCreateOrReuseRef, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: a.requester,
      goal: a.goal,
      entrypoint: "public_ask",
      scope: "public_room",
      modelPolicy: model.name,
      idempotencyKey,
      mode: a.mode,
      maxAttempts: a.mode === "research" ? 40 : 20,
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      autoAllow: true,
      traceLevel: "full_operation_ledger",
      request: {
        roomId: String(a.roomId),
        targetArtifactId: String(a.artifactId),
        commandText: a.goal,
        entrypoint: "public_ask",
        scope: "public_room",
        approvalPolicy: "auto_commit_safe",
        evidencePolicy: "public_only",
        maxSteps,
        traceLevel: "full_operation_ledger",
        idempotencyKey,
      },
    }) as { jobId: Id<"agentJobs">; reused: boolean; status: string; latestRunId?: Id<"agentRuns"> };
    const jobId = jobClaim.jobId;
    const rt = new ConvexRoomTools(ctx, a.roomId, a.artifactId, actor, sessionId, jobId);
    const modelJournal = makeConvexStepJournal({
      ctx,
      jobId,
      sliceKey: journalSliceKey({
        entrypoint: "public_ask",
        jobId: String(jobId),
        artifactId: String(a.artifactId),
        artifactVersion: targetArtifact.version ?? null,
        goal: a.goal,
        mode: a.mode ?? "variance",
        modelPolicy: model.name,
        maxSteps,
      }),
      modelName: () => model.name,
    });
    const claim = await ctx.runMutation(agentRunsClaimOrReuseRef, { jobId, roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal, idempotencyKey }) as {
      runId: Id<"agentRuns">;
      reused: boolean;
      row: null | {
        _id: Id<"agentRuns">; model: string; steps: number; toolCalls: number; conflictsSurvived: number;
        inputTokens: number; outputTokens: number; costUsd: number; ms: number; exhausted: boolean;
        stopReason?: string; remainingMs?: number; deadlineAt?: number; handoff?: unknown;
      };
    };
    if (claim.reused && claim.row) {
      const row = claim.row;
      return {
        finalText: row.stopReason ? "Deduplicated: an identical run just completed." : "Deduplicated: an identical run is already in progress.",
        jobId, roomId: a.roomId, agentId: actor.id, model: row.model, goal: a.goal,
        steps: row.steps, toolCalls: row.toolCalls, conflictsSurvived: row.conflictsSurvived,
        inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd, ms: row.ms, exhausted: row.exhausted,
        stopReason: row.stopReason ?? "in_flight", remainingMs: row.remainingMs ?? null, deadlineAt: row.deadlineAt ?? deadlineAt,
        modelCalls: 0, runId: row._id, handoff: row.handoff ?? null,
      };
    }
    const runId = claim.runId;

    const persistFailure = async (error: unknown) => {
      const partial = error instanceof AgentRunError ? error.partial : undefined;
      const rootError = error instanceof AgentRunError ? error.cause : error;
      const ms = Date.now() - t0;
      const inputTokens = partial?.usage.inputTokens ?? 0;
      const outputTokens = partial?.usage.outputTokens ?? 0;
      const costUsd = priceRun(model.name, inputTokens, outputTokens);
      const conflictsSurvived = partial?.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length ?? 0;
      const telemetry = {
        roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal,
        steps: partial?.steps ?? 0, toolCalls: partial?.trace.length ?? 0, conflictsSurvived,
        inputTokens, outputTokens, costUsd, ms, exhausted: partial?.exhausted ?? false,
        stopReason: partial?.stopReason ?? "error",
        remainingMs: partial?.budget.remainingMs,
        deadlineAt,
        handoff: partial?.handoff,
      };
      await ctx.runMutation(agentRunsFinishRef, { runId, model: model.name, steps: telemetry.steps, toolCalls: telemetry.toolCalls, conflictsSurvived, inputTokens, outputTokens, costUsd, ms, exhausted: telemetry.exhausted, stopReason: telemetry.stopReason, remainingMs: telemetry.remainingMs, deadlineAt, handoff: telemetry.handoff });
      await ctx.runMutation(agentJobsFinishInteractiveRef, {
        jobId,
        runId,
        status: "failed",
        finalText: "Agent run failed.",
        error: errorText(rootError),
        resolvedModel: model.name,
        stopReason: telemetry.stopReason,
        ms,
        inputTokens,
        outputTokens,
        costUsd,
        modelCalls: partial?.usage.modelCalls ?? 0,
        toolCalls: telemetry.toolCalls,
      });
      const priorSteps = partial?.trace.map(traceStep) ?? [];
      await ctx.runMutation(agentStepsRecordRef, {
        jobId, runId, roomId: a.roomId, agentId: actor.id,
        steps: [...priorSteps, {
          idx: priorSteps.length,
          tool: "run_error",
          args: cap(JSON.stringify({ goal: a.goal, mode: a.mode ?? "variance", maxSteps })),
          result: cap(errorText(rootError)),
          status: "error",
          ms,
        }],
      });
    };

    let result;
    try {
      result = await runAgent({
        rt,
        goal: a.goal,
        model,
        tools: ROOM_TOOLS,
        maxSteps,
        // Route the JIT context by artifact kind so the agent can edit ANY artifact, not just the
        // variance sheet: research sheet → research builder; note → note builder; wall → wall builder;
        // any other sheet → the default variance/sheet builder (runtime falls back when undefined).
        contextBuilder: a.mode === "research" ? buildResearchContext : targetArtifact.kind === "note" ? buildNoteContext : targetArtifact.kind === "wall" ? buildWallContext : undefined,
        compaction,
        journal: modelJournal,
        deadlineAt,
        reserveMs: actionReserveMs,
        // P0-4: interactive runs get the same token + dollar ceiling as the durable lane.
        spendLimits: {
          maxTokens: envNumber("AGENT_MAX_TOKENS_PER_RUN", 250_000, 1_000, 4_000_000),
          maxCostUsd: envNumber("AGENT_MAX_USD_PER_RUN", 2, 0.01, 100),
        },
        priceStep: (modelName, inputTokens, outputTokens) => priceRun(modelName, inputTokens, outputTokens),
      });
    } catch (error) {
      await persistFailure(error);
      throw error;
    }
    const ms = Date.now() - t0;

    const costUsd = priceRun(model.name, result.usage.inputTokens, result.usage.outputTokens);
    const conflictsSurvived = result.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
    const telemetry = {
      roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal,
      steps: result.steps, toolCalls: result.trace.length, conflictsSurvived,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd, ms, exhausted: result.exhausted,
      stopReason: result.stopReason,
      remainingMs: result.budget.remainingMs,
      deadlineAt,
      handoff: result.handoff,
    };
    // Patch the claimed run row with final telemetry + the APPEND-ONLY step-level trace (audit + trajectory eval).
    await ctx.runMutation(agentRunsFinishRef, { runId, model: model.name, steps: telemetry.steps, toolCalls: telemetry.toolCalls, conflictsSurvived, inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens, costUsd, ms, exhausted: telemetry.exhausted, stopReason: telemetry.stopReason, remainingMs: telemetry.remainingMs, deadlineAt, handoff: telemetry.handoff });
    const done = result.stopReason === "done" && !result.exhausted;
    const scheduledNextAt = done ? undefined : Date.now() + 5_000;
    const cursor = done ? undefined : await checkpointCursor(result);
    await ctx.runMutation(agentJobsFinishInteractiveRef, {
      jobId,
      runId,
      status: done ? "completed" : "paused",
      finalText: result.finalText,
      handoff: result.handoff,
      cursor,
      scheduledNextAt,
      scheduleWorkflow: !done,
      resolvedModel: model.name,
      stopReason: telemetry.stopReason,
      ms,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      costUsd,
      modelCalls: result.usage.modelCalls,
      toolCalls: telemetry.toolCalls,
    });
    await ctx.runMutation(agentStepsRecordRef, {
      jobId, runId, roomId: a.roomId, agentId: actor.id,
      steps: result.trace.map(traceStep),
    });
    return {
      finalText: result.finalText,
      jobId,
      ...telemetry,
      remainingMs: result.budget.remainingMs ?? null,
      handoff: result.handoff ?? null,
      modelCalls: result.usage.modelCalls,
      runId,
    };
  },
});

/** Summarize the room (artifacts + sheet state) as bounded, read-only context for a private consult. */
function summarizeRoomForPrivate(roomState: {
  room: { title: string };
  members: unknown[];
  artifacts: Array<{ kind: string; title: string; version: number; order: string[]; elements: Record<string, { value?: unknown }> }>;
}): string {
  const lines: string[] = [`Room "${roomState.room.title}" · ${roomState.members.length} members`];
  for (const art of roomState.artifacts.slice(0, 4)) {
    lines.push(`Artifact "${art.title}" [${art.kind}] v${art.version}`);
    if (art.kind === "sheet") {
      const rows: string[] = [];
      for (const k of art.order) { const r = String(k).split("__")[0]; if (!rows.includes(r)) rows.push(r); }
      for (const rid of rows.slice(0, 8)) {
        const label = art.elements[`${rid}__label`]?.value ?? rid;
        const q3 = art.elements[`${rid}__q3`]?.value ?? "";
        const variance = art.elements[`${rid}__variance`]?.value ?? "";
        lines.push(`  - ${String(label)}: Q3=${String(q3)} variance=${variance ? String(variance) : "(empty)"}`);
      }
    }
  }
  const text = lines.join("\n");
  return text.length > 1800 ? text.slice(0, 1800) + "…" : text;
}

/**
 * Private NodeAgent — a per-user consult. Reads the room as context, makes ONE model call (no tools, so
 * it never mutates canonical state), and posts a reply to the requester's OWN private channel. Output is
 * private until the user promotes it. Distinct from runRoomAgent (which edits the shared sheet publicly).
 */
export const runPrivateAgent = action({
  args: { roomId: v.id("rooms"), requester: actorProofV, goal: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; answer: string; model: string }> => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    const requester = roomState.members.find((m: { id: unknown }) => String(m.id) === a.requester.actor.id) as { id: unknown; name: string } | undefined;
    if (!requester) throw new Error("member_required");
    const model = agentModel(process.env.AGENT_MODEL ?? "gemini-3.5-flash");
    const system = `You are ${requester.name}'s PRIVATE NodeAgent inside a live collaborative room (a shared spreadsheet, notes, and chat). You may READ the room as context, but your reply is PRIVATE to ${requester.name} until they choose to promote it to the public chat. Be concise (2-4 sentences), concrete, and grounded in the room context. You only advise — never claim to have edited shared data.`;
    const userMsg = `ROOM CONTEXT\n${summarizeRoomForPrivate(roomState)}\n\n${requester.name} asks: ${a.goal}`;
    let answer = "";
    try {
      const step = await model.next({ system, messages: [{ role: "user", content: userMsg }], tools: [] });
      answer = (step.text ?? "").trim();
    } catch (error) {
      answer = `(private agent error: ${error instanceof Error ? error.message : "model call failed"})`;
    }
    if (!answer) answer = "I read the room but have nothing to add yet — ask me something specific about the data.";
    const clientMsgId = `priv-${String(requester.id)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ctx.runMutation(postPrivateReplyRef, { roomId: a.roomId, ownerId: String(requester.id), text: answer, clientMsgId });
    return { ok: true, answer, model: model.name };
  },
});
