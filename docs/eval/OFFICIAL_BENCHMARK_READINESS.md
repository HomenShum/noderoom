# Official Benchmark Readiness

Generated: 2026-06-13T11:51:17.500Z

This is the benchmark-faithful gate for the public targets we care about most: BankerToolBench and SpreadsheetBench. It is deliberately stricter than NodeRoom's internal professional evals. Internal green runs do not imply an official benchmark claim.

## Sources

- BankerToolBench paper: https://arxiv.org/abs/2604.11304
- BankerToolBench repo: https://github.com/Handshake-AI-Research/bankertoolbench
- SpreadsheetBench repo: https://github.com/RUCKBReasoning/SpreadsheetBench
- SpreadsheetBench site: https://spreadsheetbench.github.io/

## Summary

- Ready official benchmarks: 0/3
- Blocked official benchmarks: 3/3
- Missing/partial capabilities: `chart_visual_grade`, `docker_sandbox`, `format_diff`, `formula_recompute`, `mcp_financial_tools`, `official_gold_isolation`, `official_runner_adapter`, `pptx_docx_pdf_outputs`, `rubric_weighted_scoring`, `xlsx_import_export`

## Benchmark Contracts

### BankerToolBench

Status: blocked

Task shape: 100 end-to-end junior investment-banking tasks that require data-room navigation, market/SEC/logo tools, and multi-file Excel, PowerPoint, Word, PDF deliverables.

Scoring shape: Agentic verifier opens deliverables and scores weighted binary rubric criteria; reporting must include model, harness, tool policy, budget, verifier, trajectory, retries, and failures.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | implemented | `src/eval/bankerToolBenchAdapter.ts` |
| `official_gold_isolation` | partial | `src/eval/bankerToolBenchStage.ts` |
| `official_runner_adapter` | missing | No Harbor-compatible NodeRoom runner adapter exists yet; the current BTB support stops at official bundle ingest and staged manifests. |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | partial | `src/app/spreadsheetParser.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `pptx_docx_pdf_outputs` | missing | No official pitch-deck/report deliverable generation and verifier handoff is wired. |
| `mcp_financial_tools` | missing | BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry. |
| `docker_sandbox` | external | BTB requires Docker/Harbor execution outside the Vite/Convex app runtime. |
| `rubric_weighted_scoring` | partial | `src/eval/bankerToolBenchAdapter.ts` |

Blockers:
- official_gold_isolation: BankerToolBench staging separates final prompts/input files from evaluator-only prompt context, formatting context, canary, weighted rubric, and golden outputs; a contamination checker covers staged agent manifests, but Harbor/Docker process isolation and verifier handoff are still missing.
- official_runner_adapter: No Harbor-compatible NodeRoom runner adapter exists yet; the current BTB support stops at official bundle ingest and staged manifests.
- xlsx_import_export: Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- pptx_docx_pdf_outputs: No official pitch-deck/report deliverable generation and verifier handoff is wired.
- mcp_financial_tools: BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry.
- docker_sandbox: BTB requires Docker/Harbor execution outside the Vite/Convex app runtime.
- rubric_weighted_scoring: Weighted rubric metadata is parsed and isolated for the evaluator, but Gandalf/Harbor verifier execution and score import are not wired.

### SpreadsheetBench

Status: blocked

Task shape: 912 real-world spreadsheet manipulation instructions with 2,729 test cases, varied workbook structures, and Excel-forum style user intent.

Scoring shape: Online-judge style multi-test-case evaluation; the agent must produce robust spreadsheet transformations without seeing hidden test values.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | implemented | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_gold_isolation` | partial | `src/eval/spreadsheetBenchStage.ts` |
| `official_runner_adapter` | partial | `src/eval/spreadsheetBenchRunner.ts` |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | implemented | `src/eval/spreadsheetBenchRunner.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `format_diff` | partial | `src/eval/spreadsheetBenchScorer.ts` |

Blockers:
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, contamination checks cover staged and candidate metadata including those workspace manifests, and official V1 N=5/retry failed model smokes exist, but official full-bundle OS/Docker process isolation and output policy proof are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; official V1 N=5 and retry-policy smokes now record fair larger workbook snapshots, raw model output, simple SUM result caching, pass rate, p95 latency, model usage/cost, workspace manifests, scored partial candidates, retry exhaustion, and failure taxonomy, but larger full-bundle runs, OS/Docker sandbox proof, and route selection remain incomplete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- format_diff: The scorer can diff a stable ExcelJS style fingerprint when enabled; official format-grading policy and full style coverage are not complete.

### SpreadsheetBench 2

Status: blocked

Task shape: 321 end-to-end business spreadsheet workflows covering financial modeling, formula debugging, data analysis, formatting, and chart visualization.

Scoring shape: Workflow-level grading across exact cell values/formulas/formats plus visual chart quality; benchmark-faithful mode must preserve unchanged ground-truth cells and avoid answer lookup.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | implemented | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_gold_isolation` | partial | `src/eval/spreadsheetBenchStage.ts` |
| `official_runner_adapter` | partial | `src/eval/spreadsheetBenchRunner.ts` |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | implemented | `src/eval/spreadsheetBenchRunner.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `format_diff` | partial | `src/eval/spreadsheetBenchScorer.ts` |
| `chart_visual_grade` | missing | No VLM/chart-visual evaluator is wired into benchmark-faithful mode. |

Blockers:
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation and V1 contamination/N=5/retry evidence exists, but V2 chart/visual grading, V2 official model runs, and OS/Docker process isolation are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; V1 N=5 and retry-policy model smoke evidence exists with fair larger snapshots, raw model output, simple SUM result caching, and workspace manifests, but V2 official runs, OS/Docker sandbox proof, route selection, and chart lane remain incomplete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- format_diff: The scorer can diff a stable ExcelJS style fingerprint when enabled; official format-grading policy, chart rendering, and visual grading are not complete.
- chart_visual_grade: No VLM/chart-visual evaluator is wired into benchmark-faithful mode.

## Promotion Rule

A README or interview claim may say NodeRoom is *benchmark-ready* only after `npm run benchmark:official:readiness -- --strict` passes and at least one benchmark-specific official adapter has produced a recorded run artifact with model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables.

Until then, use the current wording: NodeRoom has internal professional-workflow evals and a benchmark-faithful readiness gate, but official BankerToolBench/SpreadsheetBench runs are blocked by the missing adapters listed above.

