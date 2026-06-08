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
  finalText: string; roomId: Id<"rooms">; agentId: string; model: string; goal: string;
  steps: number; toolCalls: number; conflictsSurvived: number; inputTokens: number; outputTokens: number;
  costUsd: number; ms: number; exhausted: boolean; stopReason: string; remainingMs: number | null; deadlineAt: number;
  modelCalls: number; runId: Id<"agentRuns">; handoff: unknown | null;
};
import { AgentRunError, runAgent } from "../src/agent/runtime";
import { ROOM_TOOLS } from "../src/agent/tools";
import { convexModel as agentModel, convexPriceRun as priceRun } from "../src/agent/convexModel";
import { buildResearchContext } from "../src/agent/context";
import { runIdempotencyKey } from "../src/agent/idempotency";

const CONVEX_ACTION_LIMIT_MS = 10 * 60_000;
const DEFAULT_ACTION_RESERVE_MS = 30_000;
const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
const DEFAULT_CONTEXT_KEEP_RECENT = 10;
const roomsFullRef = makeFunctionReference<"query">("rooms:full");
const agentRunsClaimOrReuseRef = makeFunctionReference<"mutation">("agentRuns:claimOrReuse") as any;
const agentRunsFinishRef = makeFunctionReference<"mutation">("agentRuns:finish") as any;
const agentStepsRecordRef = makeFunctionReference<"mutation">("agentSteps:record") as any;

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
  },
  handler: async (ctx, a): Promise<RunResult> => {
    const t0 = Date.now();
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    const requester = roomState.members.find((m: { id: unknown }) => String(m.id) === a.requester.actor.id);
    if (!requester) throw new Error("member_required");
    if (!roomState.artifacts.some((art: { id: unknown }) => String(art.id) === String(a.artifactId))) throw new Error("artifact_room_mismatch");
    const session = roomState.sessions.find((s: { scope?: string; agentId: string; agentName: string; id: unknown }) => s.scope === "public");
    if (!session) throw new Error("agent_session_mismatch");
    const actor: Actor = { kind: "agent", id: session.agentId, name: session.agentName, scope: "public" };
    const sessionId = String(session.id);
    const rt = new ConvexRoomTools(ctx, a.roomId, a.artifactId, actor, sessionId);
    const model = agentModel(process.env.AGENT_MODEL ?? "gpt-5.4-mini"); // ladder-proven L1-L5 clean (gpt-5.4-nano was flaky on L3/L5/L6)
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
      const r = (e.result ?? {}) as { ok?: boolean; conflict?: boolean; locked?: boolean; error?: unknown };
      if (e.tool === "edit_cell") { if (r.conflict) return "conflict"; if (r.locked) return "locked"; }
      if (r.error || r.ok === false) return "error";
      return "ok";
    };
    const traceStep = (e: { tool: string; args: unknown; result: unknown; ms: number }, i: number) => ({
      idx: i, tool: e.tool, args: cap(JSON.stringify(e.args)), result: cap(JSON.stringify(e.result)), status: stepStatus(e), ms: e.ms,
      elementId: e.tool === "edit_cell" ? (String((e.args as { elementId?: string }).elementId ?? "") || undefined) : undefined,
    });
    // Idempotency (async_reliability layer 1): a double-submit / client retry must not launch a second
    // concurrent run racing the same locks/CAS. ATOMIC claim-or-reuse (one serializable mutation) — no
    // TOCTOU window between the dedup check and the claim. Runtime-proven in tests/idempotencyRuntime.test.ts.
    const idempotencyKey = runIdempotencyKey({ roomId: String(a.roomId), artifactId: String(a.artifactId), actorId: String(a.requester.actor.id), goal: a.goal });
    const claim = await ctx.runMutation(agentRunsClaimOrReuseRef, { roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal, idempotencyKey }) as {
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
        roomId: a.roomId, agentId: actor.id, model: row.model, goal: a.goal,
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
      const priorSteps = partial?.trace.map(traceStep) ?? [];
      await ctx.runMutation(agentStepsRecordRef, {
        runId, roomId: a.roomId, agentId: actor.id,
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
        contextBuilder: a.mode === "research" ? buildResearchContext : undefined,
        compaction,
        deadlineAt,
        reserveMs: actionReserveMs,
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
    await ctx.runMutation(agentStepsRecordRef, {
      runId, roomId: a.roomId, agentId: actor.id,
      steps: result.trace.map(traceStep),
    });
    return {
      finalText: result.finalText,
      ...telemetry,
      remainingMs: result.budget.remainingMs ?? null,
      handoff: result.handoff ?? null,
      modelCalls: result.usage.modelCalls,
      runId,
    };
  },
});

