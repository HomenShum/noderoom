# `openrouter/free-auto` - L1-L6 ladder test (2026-06-07)

Tested whether the free-first router is safe as the live agent default (`AGENT_MODEL`) by running
the collaboration ladder against it live:

```bash
npx tsx evals/ladder.ts --real openrouter/free-auto --rung-timeout-ms=540000 --reserve-ms=30000
```

Router-aware runs are separate from fixed-route runs:

```bash
npm run ladder:free
npm run benchmark:free
```

`ladder:free` runs the `openrouter/free-auto` alias plus the currently discovered top 5 concrete
free OpenRouter candidates and writes requested-vs-resolved model evidence to
`docs/eval/free-auto-router-ladder.json`. Until that file is populated by a live run, the production
matrix marks the top concrete candidates as `SKIP` rather than implying they were tested.

## Result

| Rung | Verdict | Latency | Note |
|---|---|---:|---|
| L1 read (no mutation) | PASS | 20.4s | correct |
| L2 edit (single CAS) | PASS | 49.3s | correct |
| L3 conflict (no clobber) | PASS | 103.5s | correct, but 1.7 min for one rung |
| L4 blocked (must draft) | TIMEOUT | >368s | did not complete within the run budget |
| L5 large range | SKIP | - | unreached |
| L6 long horizon | SKIP | - | unreached |

Reference: faster paid routes completed the early ladder in seconds, while free-auto showed
escalating latency from per-candidate fallback and rate-limit retries. The no-clobber/draft safety
rung did not finish in a reasonable live collaboration budget.

## Verdict

`openrouter/free-auto` is functionally correct on the rungs it finishes, but operationally unsuitable
as the live collaboration default. Correctness is not enough here: 20-100s+ per operation and a
non-completing L4 make it wrong for the interactive lock/CAS/draft path.

Recommendation:

1. Keep `AGENT_MODEL` default on a recorded L1-L4 collaboration-safe model. The current Convex
   fallback is `gemini-3.5-flash`, matching `docs/qa/production-matrix.json`.
2. Keep `openrouter/free-auto` explicit for `/free` and other long-running, budgeted background jobs.
3. Evaluate the router and its discovered concrete candidates with `ladder:free`, not with a generic
   provider row.
4. Add a paid fallback after the free chain for demos or production jobs that cannot free-tier fail.

## Audit Recording

`model("openrouter/free-auto").name` resolves to the actual free model used per call, not only the
alias. Agent runs therefore capture which model produced the cells. `evals/ladder.ts` also records
`requestedModel`, `resolvedModel`, and `resolvedModels[]` when writing JSON reports, so a free-auto
pass cannot hide the concrete model that did the work.

## Live Discovery Smoke (2026-06-08)

`npm run openrouter:free -- --limit=5` resolved these top agent candidates:

| Rank | Model | Context | Signals |
|---:|---|---:|---|
| 1 | `nvidia/nemotron-3-super-120b-a12b:free` | 1,000,000 | tools, tool_choice, structured outputs, response_format, reasoning |
| 2 | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | tools, tool_choice, reasoning |
| 3 | `qwen/qwen3-coder:free` | 1,048,576 | tools, tool_choice, coding/agent specialist |
| 4 | `openrouter/owl-alpha` | 1,048,756 | tools, structured outputs, response_format |
| 5 | `qwen/qwen3-next-80b-a3b-instruct:free` | 262,144 | tools, tool_choice, structured outputs, response_format |

This proves the discovery/ranking path is live. It does not prove these candidates pass the
collaboration ladder; that requires `npm run ladder:free`.

## Router-Aware Candidate Ladder (2026-06-09)

`npm run ladder:free` completed live and wrote `docs/eval/free-auto-router-ladder.json`.
The run covered `openrouter/free-auto` plus the discovered top 5 concrete free candidates.
It failed overall: no free route cleared L1-L4.

| Route | L1 | L2 | L3 | L4 | Notes |
|---|---:|---:|---:|---:|---|
| `openrouter/free-auto` -> `nvidia/nemotron-3-super-120b-a12b:free` | PASS | PASS | FAIL | TIMEOUT | Alias exhausted the step budget on L3 and time budget on L4. |
| `nvidia/nemotron-3-super-120b-a12b:free` | PASS | PASS | PASS | TIMEOUT | Best concrete candidate, but still fails the blocked/draft rung under the live budget. |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | FAIL | FAIL | FAIL | FAIL | Invalid JSON responses. |
| `qwen/qwen3-coder:free` | FAIL | FAIL | FAIL | FAIL | Provider retry errors. |
| `openrouter/owl-alpha` | FAIL | FAIL | PASS | FAIL | Mutated during read, failed target edit, and missed required draft. |
| `qwen/qwen3-next-80b-a3b-instruct:free` | FAIL | FAIL | FAIL | FAIL | Provider retry errors. |

Operational reading: free-auto discovery is useful, but the current free pool is not
collaboration-safe for the lock/CAS/draft path. Keep free routes opt-in for `/free`
or background jobs, and keep interactive collaboration on a route with recorded L1-L4
passes.
