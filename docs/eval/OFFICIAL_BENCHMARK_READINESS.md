# Official Benchmark Readiness

Generated: 2026-06-13T09:19:04.248Z

This is the benchmark-faithful gate for the public targets we care about most: BankerToolBench and SpreadsheetBench. It is deliberately stricter than NodeRoom's internal professional evals. Internal green runs do not imply an official benchmark claim.

## Sources

- BankerToolBench paper: https://arxiv.org/abs/2604.11304
- BankerToolBench repo: https://github.com/Handshake-AI-Research/bankertoolbench
- SpreadsheetBench repo: https://github.com/RUCKBReasoning/SpreadsheetBench
- SpreadsheetBench site: https://spreadsheetbench.github.io/

## Summary

- Ready official benchmarks: 0/3
- Blocked official benchmarks: 3/3
- Missing/partial capabilities: `chart_visual_grade`, `docker_sandbox`, `format_diff`, `formula_recompute`, `mcp_financial_tools`, `official_gold_isolation`, `official_runner_adapter`, `official_task_ingest`, `pptx_docx_pdf_outputs`, `rubric_weighted_scoring`, `xlsx_import_export`

## Benchmark Contracts

### BankerToolBench

Status: blocked

Task shape: 100 end-to-end junior investment-banking tasks that require data-room navigation, market/SEC/logo tools, and multi-file Excel, PowerPoint, Word, PDF deliverables.

Scoring shape: Agentic verifier opens deliverables and scores weighted binary rubric criteria; reporting must include model, harness, tool policy, budget, verifier, trajectory, retries, and failures.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | missing | No official benchmark task downloader/cache/manifest runner is wired yet. |
| `official_gold_isolation` | partial | `docs/TARGET_2026_06.md` |
| `official_runner_adapter` | missing | No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo. |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | partial | `src/app/spreadsheetParser.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `pptx_docx_pdf_outputs` | missing | No official pitch-deck/report deliverable generation and verifier handoff is wired. |
| `mcp_financial_tools` | missing | BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry. |
| `docker_sandbox` | external | BTB requires Docker/Harbor execution outside the Vite/Convex app runtime. |
| `rubric_weighted_scoring` | missing | No official weighted rubric scorer adapter exists. |

Blockers:
- official_task_ingest: No official benchmark task downloader/cache/manifest runner is wired yet.
- official_gold_isolation: Internal eval policy forbids hidden gold leaks, but official benchmark adapters do not yet enforce this boundary.
- official_runner_adapter: No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo.
- xlsx_import_export: Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- pptx_docx_pdf_outputs: No official pitch-deck/report deliverable generation and verifier handoff is wired.
- mcp_financial_tools: BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry.
- docker_sandbox: BTB requires Docker/Harbor execution outside the Vite/Convex app runtime.
- rubric_weighted_scoring: No official weighted rubric scorer adapter exists.

### SpreadsheetBench

Status: blocked

Task shape: 912 real-world spreadsheet manipulation instructions with 2,729 test cases, varied workbook structures, and Excel-forum style user intent.

Scoring shape: Online-judge style multi-test-case evaluation; the agent must produce robust spreadsheet transformations without seeing hidden test values.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | implemented | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_gold_isolation` | partial | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_runner_adapter` | missing | No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo. |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | partial | `src/app/spreadsheetParser.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `format_diff` | missing | No official cell-format/style diff grader is wired. |

Blockers:
- official_gold_isolation: Agent-facing SpreadsheetBench tasks redact golden workbook paths and scorer metadata; runner-level sandboxing and output diff enforcement are still missing.
- official_runner_adapter: No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo.
- xlsx_import_export: Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- format_diff: No official cell-format/style diff grader is wired.

### SpreadsheetBench 2

Status: blocked

Task shape: 321 end-to-end business spreadsheet workflows covering financial modeling, formula debugging, data analysis, formatting, and chart visualization.

Scoring shape: Workflow-level grading across exact cell values/formulas/formats plus visual chart quality; benchmark-faithful mode must preserve unchanged ground-truth cells and avoid answer lookup.

| Capability | State | Evidence / blocker |
|---|---|---|
| `official_task_ingest` | implemented | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_gold_isolation` | partial | `src/eval/spreadsheetBenchAdapter.ts` |
| `official_runner_adapter` | missing | No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo. |
| `trajectory_capture` | implemented | `evals/evalStore.ts` |
| `cost_latency_retries` | implemented | `evals/financeModelLive.ts` |
| `xlsx_import_export` | partial | `src/app/spreadsheetParser.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `format_diff` | missing | No official cell-format/style diff grader is wired. |
| `chart_visual_grade` | missing | No VLM/chart-visual evaluator is wired into benchmark-faithful mode. |

Blockers:
- official_gold_isolation: Agent-facing SpreadsheetBench tasks redact golden workbook paths and scorer metadata; chart/visual grading and runner-level sandboxing are still missing.
- official_runner_adapter: No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo.
- xlsx_import_export: Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- format_diff: No official cell-format/style diff grader is wired.
- chart_visual_grade: No VLM/chart-visual evaluator is wired into benchmark-faithful mode.

## Promotion Rule

A README or interview claim may say NodeRoom is *benchmark-ready* only after `npm run benchmark:official:readiness -- --strict` passes and at least one benchmark-specific official adapter has produced a recorded run artifact with model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables.

Until then, use the current wording: NodeRoom has internal professional-workflow evals and a benchmark-faithful readiness gate, but official BankerToolBench/SpreadsheetBench runs are blocked by the missing adapters listed above.

