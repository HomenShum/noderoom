/**
 * Run idempotency (async_reliability layer 1 + invariant 6: "idempotency is deterministic").
 *
 * A double-clicked "/ask" / "Enrich" — or a client retry of the awaited Convex action —
 * must NOT launch a second concurrent agent run against the same artifact (which would race
 * its own CAS edits + locks and double-bill tokens). The Convex action computes a key from
 * (room, artifact, goal, actor); if an in-flight or very-recent run with that key exists, it
 * returns that runId instead of starting a new loop.
 *
 * Wiring (convex/agent.ts): add `idempotencyKey: v.optional(v.string())` + a `by_idempotency`
 * index on agentRuns; at action entry, `findReusableRun(byKey, key)` → return its runId.
 */

export type RunRecord = {
  runId: string;
  idempotencyKey?: string;
  /** Terminal stop reason once the run finished ("done" | "step_budget" | "time_budget" | "error"). Undefined while in flight. */
  stopReason?: string;
  /** Wall-clock end (ms) — used to dedupe rapid double-submits even after a run completes. */
  finishedAt?: number;
};

/** Deterministic dedup key — the SAME (room, artifact, actor, goal) always collides. Sorted/normalized
 *  inputs + FNV-1a 32-bit (no crypto dependency; works in both the Vite client and the Convex node action). */
export function runIdempotencyKey(args: { roomId: string; artifactId: string; actorId: string; goal: string }): string {
  const norm = `${args.roomId}|${args.artifactId}|${args.actorId}|${args.goal.trim().replace(/\s+/g, " ").toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "run_" + (h >>> 0).toString(16).padStart(8, "0");
}

/** Return an existing run to attach to instead of starting a duplicate: an in-flight run with the
 *  same key, OR one that finished within `recentMs` (default 60s) — collapsing rapid double-submits. */
export function findReusableRun(runs: RunRecord[], key: string, opts?: { recentMs?: number; now: number }): RunRecord | undefined {
  const recentMs = opts?.recentMs ?? 60_000;
  const now = opts?.now ?? 0;
  return runs.find((r) =>
    r.idempotencyKey === key &&
    (r.stopReason === undefined || (r.finishedAt !== undefined && now - r.finishedAt < recentMs)),
  );
}
