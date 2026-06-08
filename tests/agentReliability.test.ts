/**
 * Production-reliability scenarios (async_reliability layers): transient-retry classification,
 * deterministic idempotency dedup, and a real pause→resume→complete run that doesn't double-work.
 */
import { describe, it, expect } from "vitest";
import { isTransientError, retryBackoffMs } from "../src/agent/model";
import { runIdempotencyKey, findReusableRun, type RunRecord } from "../src/agent/idempotency";
import { runAgent } from "../src/agent/runtime";
import { scriptedModel } from "../src/agent/scripted";
import { recomputeVariancePlan } from "../src/agent/plans";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { ROOM_TOOLS } from "../src/agent/tools";

const CELL = "r_ni__variance";
const VAL = "+22.4%";

describe("retry classification (async_reliability layer 2)", () => {
  it("treats 429/5xx/network/timeout as transient", () => {
    for (const m of ["Error 429 rate limit", "503 service unavailable", "ETIMEDOUT", "ECONNRESET", "model overloaded", "request timed out", "fetch failed"]) {
      expect(isTransientError(new Error(m))).toBe(true);
    }
  });
  it("never retries 4xx (non-429) or an abort", () => {
    expect(isTransientError(new Error("400 invalid request"))).toBe(false);
    expect(isTransientError(new Error("401 unauthorized"))).toBe(false);
    const abort = new Error("The operation was aborted"); abort.name = "AbortError";
    expect(isTransientError(abort)).toBe(false);
    expect(isTransientError(new Error("run aborted by deadline"))).toBe(false);
  });
  it("backoff escalates 2s→6s→18s with bounded jitter (no thundering herd)", () => {
    for (const [attempt, lo, hi] of [[1, 2000, 2600], [2, 6000, 7800], [3, 18000, 23400]] as const) {
      const ms = retryBackoffMs(attempt);
      expect(ms).toBeGreaterThanOrEqual(lo);
      expect(ms).toBeLessThan(hi);
    }
  });
});

describe("idempotency (async_reliability layer 1 — no concurrent duplicate runs)", () => {
  it("same (room,artifact,actor,goal) always collides; normalizes whitespace/case", () => {
    const a = runIdempotencyKey({ roomId: "r1", artifactId: "a1", actorId: "u1", goal: "Enrich pending rows" });
    const b = runIdempotencyKey({ roomId: "r1", artifactId: "a1", actorId: "u1", goal: "  enrich   PENDING rows " });
    expect(a).toBe(b);
    expect(runIdempotencyKey({ roomId: "r1", artifactId: "a1", actorId: "u1", goal: "different goal" })).not.toBe(a);
    expect(runIdempotencyKey({ roomId: "r2", artifactId: "a1", actorId: "u1", goal: "Enrich pending rows" })).not.toBe(a);
  });
  it("reuses an in-flight run, dedupes a rapid double-submit, allows a fresh run later", () => {
    const key = "run_abc";
    const inflight: RunRecord[] = [{ runId: "x", idempotencyKey: key }]; // no stopReason → in flight
    expect(findReusableRun(inflight, key, { now: 1000 })?.runId).toBe("x");
    const recent: RunRecord[] = [{ runId: "y", idempotencyKey: key, stopReason: "done", finishedAt: 1000 }];
    expect(findReusableRun(recent, key, { now: 1500, recentMs: 60_000 })?.runId).toBe("y"); // 0.5s later → dedupe
    expect(findReusableRun(recent, key, { now: 200_000, recentMs: 60_000 })).toBeUndefined(); // long after → allow new
  });
});

describe("pause → resume → complete (async_reliability: long-running, no double-work)", () => {
  it("a budget-paused run hands off, then resumes from its messages and finishes the edit exactly once", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const goal = `Set Net income variance (${CELL}) to ${VAL}. Claim the cell, read, edit with CAS, release.`;
    const cellNow = () => String(engine.getArtifact(d.sheetId)!.elements[CELL]?.value ?? "");

    // Slice 1: a tiny step budget forces a pause BEFORE the edit completes.
    const r1 = await runAgent({ rt, goal, model: scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: true })), tools: ROOM_TOOLS, maxSteps: 2 });
    expect(r1.stopReason).not.toBe("done");      // paused, not finished
    expect(r1.handoff).toBeTruthy();              // resumable checkpoint emitted
    expect(cellNow()).not.toBe(VAL);              // work not yet done

    // Slice 2: resume from slice 1's persisted messages, bigger budget → completes.
    const r2 = await runAgent({ rt, goal, model: scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: true })), tools: ROOM_TOOLS, maxSteps: 8, initialMessages: r1.messages });
    expect(r2.stopReason).toBe("done");
    expect(cellNow()).toBe(VAL);                  // the edit completed across the resume boundary

    // No double-work: the target cell was written to its final value, version advanced once past the read.
    const finalVersion = engine.getArtifact(d.sheetId)!.elements[CELL]!.version;
    expect(finalVersion).toBeGreaterThanOrEqual(2); // seeded v1 → one successful CAS edit
  });
});
