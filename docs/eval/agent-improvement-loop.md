# Agent Improvement Loop

Generated: 2026-06-13T15:17:46.432Z

Source pattern: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop

NodeRoom adapts the cookbook loop as: traces -> human/model feedback -> reusable evals -> gate -> Codex handoff -> next harness change.

Latest run artifact: `docs/eval/agent-improvement-loop/20260613T151705Z.json`

Summary: 31 pass, 4 blocked, 0 fail, 8 skip.

## Step Results

| Step | Lane | Status | Duration | Command |
|---|---|---:|---:|---|
| Professional workflow catalog shape | deterministic | PASS | 1.4s | `npm run eval:professional` |
| Professional catalog proof gate | deterministic | PASS | 0.6s | `npm run eval:professional:catalog-proofs` |
| Professional proof ledger | deterministic | PASS | 0.8s | `npm run eval:professional:proofs` |
| GTM/finance workflow evals | deterministic | PASS | 2.0s | `npx vitest run tests/workflowEvals.test.ts` |
| Collaboration ladder L1-L6 | deterministic | PASS | 1.0s | `npm run ladder -- --record` |
| MM-banking credit decision evals | deterministic | PASS | 0.8s | `npm run eval:credit -- --record` |
| Official benchmark readiness report | deterministic | PASS | 0.6s | `npm run benchmark:official:readiness` |
| Official benchmark promotion gate | deterministic | BLOCKED | 0.6s | `npm run benchmark:official:readiness -- --strict` |
| Official benchmark contamination fixture | deterministic | PASS | 1.7s | `npx vitest run tests/benchmarkContamination.test.ts` |
| BankerToolBench official ingest fixture | deterministic | PASS | 1.6s | `npx vitest run tests/bankerToolBenchAdapter.test.ts` |
| BankerToolBench sandbox stage fixture | deterministic | PASS | 1.7s | `npx vitest run tests/bankerToolBenchStage.test.ts` |
| BankerToolBench manifest lock fixture | deterministic | PASS | 0.6s | `npm run benchmark:bankertoolbench:manifest-lock -- --root .tmp/official-benchmarks/btb-fixture --json-out docs/eval/bankertoolbench-manifest-lock-smoke.json` |
| BankerToolBench staged runner fixture | deterministic | PASS | 2.4s | `npx vitest run tests/bankerToolBenchRunner.test.ts` |
| BankerToolBench local harness proof gate | deterministic | PASS | 0.6s | `npm run benchmark:bankertoolbench:proof` |
| BankerToolBench official execution contract | deterministic | BLOCKED | 0.6s | `npm run benchmark:bankertoolbench:official-contract -- --strict` |
| SpreadsheetBench official ingest fixture | deterministic | PASS | 2.0s | `npx vitest run tests/spreadsheetBenchAdapter.test.ts` |
| SpreadsheetBench sandbox stage fixture | deterministic | PASS | 2.1s | `npx vitest run tests/spreadsheetBenchStage.test.ts` |
| SpreadsheetBench workbook score fixture | deterministic | PASS | 2.5s | `npx vitest run tests/spreadsheetBenchScorer.test.ts` |
| SpreadsheetBench chart package score fixture | deterministic | PASS | 2.0s | `npx vitest run tests/spreadsheetBenchChartScorer.test.ts` |
| SpreadsheetBench rendered/VLM chart visual probe | deterministic | BLOCKED | 0.7s | `npm run benchmark:spreadsheetbench:chart-visual:probe -- --strict` |
| SpreadsheetBench staged runner fixture | deterministic | PASS | 4.3s | `npx vitest run tests/spreadsheetBenchRunner.test.ts` |
| Agent workspace process sandbox | deterministic | PASS | 0.8s | `npm run benchmark:agent-sandbox -- --json-out docs/eval/agent-workspace-sandbox-smoke.json` |
| Docker/Harbor availability probe | deterministic | BLOCKED | 1.1s | `npm run benchmark:docker-sandbox:probe -- --require-pass` |
| SpreadsheetBench staged artifact contamination | deterministic | PASS | 0.7s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/staged-v1 --strict` |
| SpreadsheetBench N5 run artifact contamination | deterministic | PASS | 0.7s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/run-v1-model-edit-n5 --strict` |
| SpreadsheetBench 3-task N5 run artifact contamination | deterministic | PASS | 0.7s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/run-v1-model-edit-3task-n5 --strict` |
| SpreadsheetBench 3-task N5 proof gate | deterministic | PASS | 0.7s | `npm run benchmark:spreadsheetbench:proof -- --require-sidecar-files` |
| SpreadsheetBench retry run artifact contamination | deterministic | PASS | 0.8s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/run-v1-model-edit-retry --strict` |
| SpreadsheetBench V2 staged artifact contamination | deterministic | PASS | 0.6s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/staged-v2 --strict` |
| SpreadsheetBench V2 run artifact contamination | deterministic | PASS | 0.7s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/run-v2 --strict` |
| BankerToolBench staged artifact contamination | deterministic | PASS | 0.6s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/staged-btb --strict` |
| BankerToolBench run artifact contamination | deterministic | PASS | 0.7s | `npm run benchmark:contamination -- --root .tmp/official-benchmarks/run-btb --strict` |
| Eval regression diff | deterministic | PASS | 0.7s | `npm run eval:diff` |
| Convex query/action/mutation boundaries | deterministic | PASS | 1.3s | `npm run convex:boundaries` |
| Architecture budget review | deterministic | PASS | 0.8s | `npm run architecture:budget` |
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
| research-validated-finance-reconcile | research_validated | advisory | small_gap | implementation |
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

- Unblock benchmark promotion step official-benchmark-promotion-gate: official BankerToolBench/SpreadsheetBench readiness remains blocked by external benchmark prerequisites.
- Unblock benchmark promotion step bankertoolbench-official-contract: BTB official contract is missing external Docker/MCP/Gandalf/provenance evidence.
- Unblock benchmark promotion step spreadsheetbench-chart-visual-probe: SpreadsheetBench V2 rendered/VLM chart grading prerequisites are not proven.
- Unblock benchmark promotion step docker-sandbox-probe: Docker/Harbor process isolation is not proven in this environment.
- Implement scoped handoff for eval candidate research-validated-finance-reconcile.
- Run skipped free-route-discovery once prerequisites are present: pass --live and set OPENROUTER_API_KEY to discover current free-auto candidates.
- Run skipped professional-live-catalog once prerequisites are present: pass --live and set OPENROUTER_API_KEY to prove the professional catalog with the cheap champion route.
- Run skipped chat-intake-live-runtime once prerequisites are present: pass --live and set OPENROUTER_API_KEY to run the chat-intake room runtime against a real route.

## Next Live Runs

- `npm run agent:improve -- --live`
- `npm run agent:improve -- --full-live`
- `npm run agent:improve -- --ui-media=docs/eval/ui-recordings/<recording-or-screenshot>`
- `npm run benchmark:charts`
