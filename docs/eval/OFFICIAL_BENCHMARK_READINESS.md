# Official Benchmark Readiness

Generated: 2026-06-13T12:59:09.127Z

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
| `official_runner_adapter` | partial | `src/eval/bankerToolBenchRunner.ts` |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | partial | `src/app/spreadsheetParser.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `pptx_docx_pdf_outputs` | partial | `src/eval/bankerToolBenchRunner.ts` |
| `mcp_financial_tools` | missing | BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry. |
| `docker_sandbox` | external | BTB requires Docker/Harbor execution outside the Vite/Convex app runtime. |
| `rubric_weighted_scoring` | partial | `src/eval/bankerToolBenchRunner.ts` |

Blockers:
- official_gold_isolation: BankerToolBench staging separates final prompts/input files from evaluator-only prompt context, formatting context, canary, weighted rubric, golden outputs, and expected deliverable package metadata; contamination checks cover staged agent manifests and a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, but Harbor/Docker process isolation and verifier handoff are still missing.
- official_runner_adapter: A local BankerToolBench runner now emits candidate deliverables from per-attempt agent workspaces before opening evaluator-only rubric/golden metadata, validates exact expected package shape for supported Excel/PowerPoint/Word/PDF-style deliverables, and records local exact-golden smoke scores, but Harbor/Docker execution, MCP financial tools, and Gandalf verifier replay are still missing.
- xlsx_import_export: Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- pptx_docx_pdf_outputs: The local BTB runner validates multi-file candidate packages and supported .pptx/.docx/.pdf deliverable extensions after candidate emission; actual pitch-deck/report generation and official verifier handoff are not wired.
- mcp_financial_tools: BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry.
- docker_sandbox: BTB requires Docker/Harbor execution outside the Vite/Convex app runtime.
- rubric_weighted_scoring: Weighted rubric metadata is parsed, isolated for the evaluator, and consumed by a local exact-package/exact-golden smoke scorer, but Gandalf/Harbor verifier execution and score import are not wired.

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
| `formula_recompute` | partial | `src/eval/spreadsheetBenchRunner.ts` |
| `format_diff` | partial | `src/eval/spreadsheetBenchScorer.ts` |

Blockers:
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, contamination checks cover staged and candidate metadata including those workspace manifests, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, and official V1 N=5/retry failed model smokes exist, but official full-bundle Docker/Harbor process isolation and output policy proof are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; official V1 N=5 and retry-policy smokes now record fair larger workbook snapshots, raw model output, broader deterministic formula result caching (including SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, IF/IFERROR, ROUND variants, and SUMIF/COUNTIF), pass rate, p95 latency, model usage/cost, workspace manifests, scored partial candidates, retry exhaustion, failure taxonomy, and local Node permission sandbox proof, but larger full-bundle runs, Docker/Harbor sandbox proof, and route selection remain incomplete.
- formula_recompute: The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring; a full Excel-compatible recompute engine is not complete.
- format_diff: The scorer can diff stable ExcelJS cell style fingerprints plus answer-range column widths/hidden state, row heights/hidden state, and intersecting merge ranges when enabled; official format-grading policy and full workbook/layout coverage are not complete.

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
| `formula_recompute` | partial | `src/eval/spreadsheetBenchRunner.ts` |
| `format_diff` | partial | `src/eval/spreadsheetBenchScorer.ts` |
| `chart_visual_grade` | partial | `src/eval/spreadsheetBenchChartScorer.ts` |

Blockers:
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, and V1/V2 contamination evidence exists, but rendered V2 chart/visual grading, V2 official model runs, and Docker/Harbor process isolation are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; V1 N=5 and retry-policy model smoke evidence exists with fair larger snapshots, raw model output, broader deterministic formula result caching (including SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, IF/IFERROR, ROUND variants, and SUMIF/COUNTIF), workspace manifests, local Node permission sandbox proof, and static V2 chart-package scoring, but V2 official model runs, Docker/Harbor sandbox proof, route selection, and rendered/VLM chart grading remain incomplete.
- formula_recompute: The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring; full Excel-compatible recompute, chart formulas, external refs, and volatile functions are not complete.
- format_diff: The scorer can diff stable ExcelJS cell style fingerprints plus answer-range column widths/hidden state, row heights/hidden state, and intersecting merge ranges when enabled; official format-grading policy, chart rendering, and visual grading are not complete.
- chart_visual_grade: SpreadsheetBench score/run reports can include a static XLSX chart-package comparison over chart and drawing XML parts; rendered chart screenshots and VLM visual quality grading are not wired.

## Promotion Rule

A README or interview claim may say NodeRoom is *benchmark-ready* only after `npm run benchmark:official:readiness -- --strict` passes and at least one benchmark-specific official adapter has produced a recorded run artifact with model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables.

Until then, use the current wording: NodeRoom has internal professional-workflow evals and a benchmark-faithful readiness gate, but official BankerToolBench/SpreadsheetBench runs are blocked by the missing adapters listed above.

