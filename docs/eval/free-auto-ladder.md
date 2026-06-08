# `openrouter/free-auto` — L1–L6 ladder test (2026-06-07)

Tested whether the free-first router is safe as the **live agent default** (`AGENT_MODEL`) by running
the collaboration ladder against it live: `npx tsx evals/ladder.ts --real openrouter/free-auto`.
The ladder runner also supports a hard per-rung budget for future live tests:
`npx tsx evals/ladder.ts --real openrouter/free-auto --rung-timeout-ms=540000 --reserve-ms=30000`.

## Result (real run, free models doing the lock → CAS → draft protocol)

| Rung | Verdict | Latency | Note |
|---|---|---|---|
| L1 read (no mutation) | ✅ PASS | 20.4s | correct |
| L2 edit (single CAS) | ✅ PASS | 49.3s | correct |
| L3 conflict (no clobber) | ✅ PASS | 103.5s | correct, but 1.7 min for one rung |
| L4 blocked (must draft) | ❌ **TIMEOUT** | >368s | did not complete within the run budget |
| L5 large range | — | — | unreached |
| L6 long horizon | — | — | unreached |

Reference (paid, same ladder, earlier this session): `gpt-5.4-nano` cleared **L1–L4** in seconds;
`gemini-3.1-flash-lite` did L1–L3 in seconds and *failed* L4. free-auto is **~5–15× slower with
escalating latency** (the per-candidate fallback retrying rate-limited/flaky free models), and the
**no-clobber/draft safety rung (L4) does not finish** in a reasonable budget.

## Verdict
**free-auto is functionally correct on the rungs it finishes, but operationally unsuitable as the live
collaboration default.** Correctness ≠ usability here: 20–100s+ per operation and a non-completing L4
make it wrong for the lock/CAS/draft path that is NodeRoom's core value, and for batch enrichment
(100s of rows × dozens of tool calls) free-tier limits compound the problem.

**Recommendation:**
1. Keep `AGENT_MODEL` default on a **ladder-proven fast model** (e.g. `gpt-5.4-nano` ~$0.0053/run,
   which passed L1–L4 in seconds) for the collaboration path.
2. Keep `openrouter/free-auto` as **opt-in / low-stakes single-shot enrichment** (the discovery,
   ranking, cache, static fallback, and per-candidate retry chain are well-built and verified).
3. Add a **paid fallback at the end of the free chain** so a free-tier-wide outage never breaks the
   live agent / demo ("free-first with a paid safety net," not "free-or-fail").

## Audit recording (the "record it" fix — `src/agent/model.ts`)
`model("openrouter/free-auto").name` now resolves to the **actual free model used per call** (a `name`
getter updated from the fallback loop), not the `openrouter/free-auto` alias — so `agentRuns.model`
captures which model produced the cells (closes the provenance gap for the hash-chained audit).
Verified: app-tsc 0, convex-tsc 0, 73 tests.
