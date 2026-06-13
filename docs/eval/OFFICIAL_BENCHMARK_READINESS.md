# Official Benchmark Readiness

Generated: 2026-06-13T15:01:48.689Z

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
| `xlsx_import_export` | partial | `src/eval/bankerToolBenchRunner.ts` |
| `formula_recompute` | partial | `evals/financeModelLive.ts` |
| `pptx_docx_pdf_outputs` | partial | `src/eval/bankerToolBenchRunner.ts` |
| `mcp_financial_tools` | external | `docs/eval/bankertoolbench-official-contract.json` |
| `docker_sandbox` | external | `docs/eval/docker-sandbox-probe.json` |
| `rubric_weighted_scoring` | partial | `docs/eval/bankertoolbench-official-contract.json` |

Blockers:
- official_gold_isolation: BankerToolBench staging separates final prompts/input files from evaluator-only prompt context, formatting context, canary, weighted rubric, golden outputs, and expected deliverable package metadata; contamination checks cover staged agent manifests and a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, but Harbor/Docker process isolation and verifier handoff are still missing.
- official_runner_adapter: A local BankerToolBench runner now emits candidate deliverables from per-attempt agent workspaces before opening evaluator-only rubric/golden metadata, validates exact expected package shape for supported Excel/PowerPoint/Word/PDF-style deliverables, reopens Excel deliverables for semantic workbook scoring when hashes drift, and records local exact/semantic-golden smoke scores; npm run benchmark:bankertoolbench:proof enforces staged isolation, candidate-before-evaluator trajectory, a negative copy-input baseline with 0/6 weighted points, a positive apply-agent-output smoke with 6/6 weighted points and 1/1 pass, supported deliverable policy, and 0-leak artifact bounds in HALO. Harbor/Docker execution, MCP financial tools, and Gandalf verifier replay are still missing.
- xlsx_import_export: The local BTB runner can emit workbook deliverables, reopen candidate/golden .xlsx/.xlsm files, and accept semantically matching workbooks even when package hashes differ; official workbook-level answer packaging, Harbor execution, and Gandalf verifier handoff are still missing.
- formula_recompute: Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.
- pptx_docx_pdf_outputs: The local BTB runner validates multi-file candidate packages and supported .pptx/.docx/.pdf deliverable extensions after candidate emission; actual pitch-deck/report generation and official verifier handoff are not wired.
- mcp_financial_tools: The BTB official execution contract names the required SEC filings, market data, company logo, document search, and web research MCP tools, but those benchmark tool servers are not adapted into NodeRoom's tool registry yet.
- docker_sandbox: BTB/official process isolation requires Docker/Harbor execution outside the Vite/Convex app runtime; npm run benchmark:docker-sandbox:probe records whether the local daemon can prove a container with --network=none, an agent workspace mount, and no evaluator mount. If the artifact status is not container_isolation_proven, official readiness remains red.
- rubric_weighted_scoring: Weighted rubric metadata is parsed, isolated for the evaluator, consumed by a local exact-package/exact-or-workbook-semantic-golden smoke scorer, and guarded by npm run benchmark:bankertoolbench:proof across both a failing copy-input baseline and a passing apply-agent-output smoke. The BTB official execution contract now defines the Gandalf score-import schema, but Gandalf/Harbor verifier execution and score import are not wired.

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
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, result rows carry sidecar hashes for candidate manifests, agent-workspace manifests, generated edit plans, and raw model output, contamination checks cover staged and candidate metadata including those workspace manifests plus agent-facing text/csv/md/xml sidecars, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, an official V1 N=5 live model smoke passes 5/5 with 0 candidate-output leaks, and a broader locally staged official V1 three-task N=5 live smoke passes 15/15 with 0 candidate-output leaks across 75 checked files, but official full-bundle Docker/Harbor process isolation and output policy proof are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; official V1 N=5 records 5/5 pass, average overall 1.0, p95 4.593s, $0.01059125 spend, zero failure counts, retry-policy accounting, workspace manifests, raw model output, sidecar hashes, visible aggregate_section table operations, deterministic SUM total result packaging, unsupported-op repair, expected-formula-only scoring, candidate-output contamination proof, and local Node permission sandbox proof. The broader locally staged official V1 three-task N=5 live smoke now records 15/15 pass across 3 cases and 5 repeats, average overall 1.0, p95 5.080s, $0.0462905 spend, zero failure counts, zero retry attempts, 0 candidate-output leaks across 75 checked files, result-level sidecar hashes for candidate manifests/workspace manifests/edit plans/raw model outputs, and structural filter_rows/sort_unique_rows repair for visible date filters and duplicate-removal/sort tables; npm run benchmark:spreadsheetbench:proof enforces those checked-in artifact thresholds and trajectory order in HALO. Larger full-bundle runs, Docker/Harbor sandbox proof, and route selection remain incomplete.
- formula_recompute: The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring, and the scorer no longer penalizes value-equivalent candidate formulas when gold stores only scalar results. A full Excel-compatible recompute engine is not complete.
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
| `chart_visual_grade` | partial | `docs/eval/spreadsheetbench-chart-visual-probe.json` |

Blockers:
- official_gold_isolation: SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, and V1/V2 contamination evidence exists, but rendered V2 chart/visual grading, V2 official model runs, and Docker/Harbor process isolation are still missing.
- official_runner_adapter: A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; V1 N=5 live model evidence passes 5/5 and the broader locally staged V1 three-task N=5 smoke passes 15/15 with retry-policy accounting, raw model output, sidecar hashes, deterministic SUM total result packaging, visible aggregate_section/filter_rows/sort_unique_rows table operations, expected-formula-only scoring, workspace manifests, local Node permission sandbox proof, and static V2 chart-package scoring, but V2 official model runs, Docker/Harbor sandbox proof, route selection, and rendered/VLM chart grading remain incomplete.
- formula_recompute: The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring, and scalar-gold/formula-candidate equivalence is handled when values match; full Excel-compatible recompute, chart formulas, external refs, and volatile functions are not complete.
- format_diff: The scorer can diff stable ExcelJS cell style fingerprints plus answer-range column widths/hidden state, row heights/hidden state, and intersecting merge ranges when enabled; official format-grading policy, chart rendering, and visual grading are not complete.
- chart_visual_grade: SpreadsheetBench score/run reports can include a static XLSX chart-package comparison over chart and drawing XML parts, and npm run benchmark:spreadsheetbench:chart-visual:probe now records whether a LibreOffice/soffice renderer, candidate/gold chart screenshot pair, Gemini/VLM key, and accepted visual-grade report are present. The current probe is not passing, so rendered chart screenshots and VLM visual quality grading remain incomplete.

## Promotion Rule

A README or interview claim may say NodeRoom is *benchmark-ready* only after `npm run benchmark:official:readiness -- --strict` passes and at least one benchmark-specific official adapter has produced a recorded run artifact with model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables.

Until then, use the current wording: NodeRoom has internal professional-workflow evals and a benchmark-faithful readiness gate, but official BankerToolBench/SpreadsheetBench runs are blocked by the missing adapters listed above.

