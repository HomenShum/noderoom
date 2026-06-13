# Agent Improvement Loop

Generated: 2026-06-13T10:17:35.371Z

Source pattern: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop

NodeRoom adapts the cookbook loop as: traces -> human/model feedback -> reusable evals -> gate -> Codex handoff -> next harness change.

Latest run artifact: `docs/eval/agent-improvement-loop/20260613T101659Z.json`

Summary: 16 pass, 0 fail, 8 skip.

## Step Results

| Step | Lane | Status | Duration | Command |
|---|---|---:|---:|---|
| Professional workflow catalog shape | deterministic | PASS | 2.4s | `npm run eval:professional` |
| Professional catalog proof gate | deterministic | PASS | 1.0s | `npm run eval:professional:catalog-proofs` |
| Professional proof ledger | deterministic | PASS | 1.4s | `npm run eval:professional:proofs` |
| GTM/finance workflow evals | deterministic | PASS | 3.8s | `npx vitest run tests/workflowEvals.test.ts` |
| Collaboration ladder L1-L6 | deterministic | PASS | 1.7s | `npm run ladder -- --record` |
| MM-banking credit decision evals | deterministic | PASS | 1.3s | `npm run eval:credit -- --record` |
| Official benchmark readiness | deterministic | PASS | 1.0s | `npm run benchmark:official:readiness` |
| BankerToolBench official ingest fixture | deterministic | PASS | 3.1s | `npx vitest run tests/bankerToolBenchAdapter.test.ts` |
| BankerToolBench sandbox stage fixture | deterministic | PASS | 3.0s | `npx vitest run tests/bankerToolBenchStage.test.ts` |
| SpreadsheetBench official ingest fixture | deterministic | PASS | 3.1s | `npx vitest run tests/spreadsheetBenchAdapter.test.ts` |
| SpreadsheetBench sandbox stage fixture | deterministic | PASS | 3.1s | `npx vitest run tests/spreadsheetBenchStage.test.ts` |
| SpreadsheetBench workbook score fixture | deterministic | PASS | 3.8s | `npx vitest run tests/spreadsheetBenchScorer.test.ts` |
| SpreadsheetBench staged runner fixture | deterministic | PASS | 3.6s | `npx vitest run tests/spreadsheetBenchRunner.test.ts` |
| Eval regression diff | deterministic | PASS | 1.1s | `npm run eval:diff` |
| Convex query/action/mutation boundaries | deterministic | PASS | 1.7s | `npm run convex:boundaries` |
| Architecture budget review | deterministic | PASS | 1.0s | `npm run architecture:budget` |
| OpenRouter free-auto discovery | live | SKIP | 0.0s | `npm run openrouter:free -- --limit=5` |
| Professional live-provider catalog champion | live | SKIP | 0.0s | `npm run eval:professional:live-catalog -- --real deepseek/deepseek-v4-flash --require-full --retry-failed 2 --json-out docs/eval/professional-live-catalog.json` |
| Chat-first GTM live runtime | live | SKIP | 0.0s | `npm run eval:chat-intake:live -- --json-out docs/eval/chat-intake-live.json --timeout-ms 240000` |
| Provider parser live smoke | live | SKIP | 0.0s | `npm run provider-parser:smoke` |
| Convex /free job smoke | full-live | SKIP | 0.0s | `npm run free-job:smoke` |
| V2 multi-model benchmark | full-live | SKIP | 0.0s | `npm run benchmark -- --model-timeout-ms=180000 --model-reserve-ms=15000 --row-hard-timeout-ms=210000` |
| Free-auto router ladder | full-live | SKIP | 0.0s | `npm run ladder:free` |
| Gemini UI media review | ui | SKIP | 0.0s | `npx tsx scripts/gemini-ui-review.ts` |

## Workflow Coverage

Reviewed file profile: 70 files (23 CSV, 47 XLSX).

| Category | Cases |
|---|---:|
| gtm_company_research | 11 |
| finance_ops | 5 |
| eval_harness | 2 |
| analytics_optimization | 2 |
| legacy_agent_outputs | 1 |

## Architecture Before Eval

Research must describe the workflow, architecture gap, and existing capability fit before it proposes evals or code.

| Eval trust level | Meaning |
|---|---|
| candidate | Generated from traces or research; useful for discussion and advisory runs, not a merge gate. |
| research_validated | Backed by captured sources or online consensus; can create scoped handoffs, still not blocking by default. |
| contested | Credible sources disagree; advisory only, and the eval should check that disagreement is surfaced. |
| human_verified | Reviewed or accepted for critical use; may become blocking when deterministic and safety-safe. |

Gate modes: none, advisory, blocking.

Architecture fit checks before adding code:

- Can existing tools, prompts, context builders, and Convex mutations already handle the case?
- If not, is the missing piece a query, action, mutation, tool schema, validator, or UI review affordance?
- What is the smallest implementation that proves the workflow without a new subsystem?
- What old or proposed layer can be avoided because the existing artifact/job/lock path is enough?

Root-cause labels used for HALO diagnosis:

- `stale_context`: The agent acted on old state or missing refreshed context.
- `wrong_tool`: The model chose a tool that could not satisfy the workflow contract.
- `missing_read_before_write`: A write occurred without a current source read and version.
- `bad_mutation_contract`: The server mutation allowed an unsafe or under-specified state change.
- `weak_source_evidence`: The output lacked source-backed evidence or cited the wrong evidence.
- `bad_prompt_or_context`: Instructions or context did not define the workflow sharply enough.
- `permission_or_visibility`: Scope, privacy, or role gating was wrong or underspecified.
- `model_routing_or_budget`: The chosen model, budget, or slice policy was unfit for the task.
- `ui_review_friction`: The human review or approval surface obscured the right decision.
- `eval_measures_wrong_behavior`: The eval target itself is suspect and needs research/calibration.

## Generated Eval Ideas

| Eval candidate | Trust | Gate | Architecture fit | Handoff decision |
|---|---|---|---|---|
| candidate-gtm-pitchbook-match | candidate | advisory | existing_capability | more_research: missing research packet evidence; candidate evals are advisory only |
| research-validated-finance-reconcile | research_validated | advisory | small_gap | implementation: demoted: architecture budget is red (forbidden surfaces dirty / review required) — human approval before any implementation handoff |
| contested-eval-harness-expansion | contested | advisory | existing_capability | eval_fixture: contested claims must stay advisory until resolved or explicitly modeled |

## Codex Handoff

### Architecture Budget

Allowed scope: Only files or modules named by the failing trace, failing eval, or handoff evidence.

Default allowed areas:
- src/agent runtime, tools, context, and compaction
- Convex job/tool adapters that already participate in the failing flow
- eval fixtures and deterministic assertions for the affected workflow

Forbidden without human approval:
- new database tables
- new services or framework layers
- new UI surfaces
- graph/wiki/embedding expansion without a failing workflow eval
- weakened CAS, lock, draft, auth, privacy, or eval gates

### Recommendations

- Resolve architecture budget review items or rerun with explicit handoff evidence before implementation.
- Run skipped free-route-discovery once prerequisites are present: pass --live and set OPENROUTER_API_KEY to discover current free-auto candidates.
- Run skipped professional-live-catalog once prerequisites are present: pass --live and set OPENROUTER_API_KEY to prove the professional catalog with the cheap champion route.
- Run skipped chat-intake-live-runtime once prerequisites are present: pass --live and set OPENROUTER_API_KEY to run the chat-intake room runtime against a real route.
- Run skipped provider-parser-smoke once prerequisites are present: pass --live; script will skip providers without keys.
- Persist each new live trace into a durable eval fixture before promoting README charts.
- Keep provider benchmarks behind row-level hard timeouts so one stuck free model cannot block the loop.
- Add browser-visible multi-user checks for public/private chat, artifact references, proposals, and trace accept-all.
- No implementation handoff candidates passed trust and architecture-fit policy in this run.

## Next Live Runs

- `npm run agent:improve -- --live`
- `npm run agent:improve -- --full-live`
- `npm run agent:improve -- --ui-media=docs/eval/ui-recordings/<recording-or-screenshot>`
- `npm run benchmark:charts`
