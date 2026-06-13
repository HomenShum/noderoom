export type OfficialBenchmarkId = "bankertoolbench" | "spreadsheetbench-v1" | "spreadsheetbench-v2";

export type BenchmarkCapability =
  | "official_task_ingest"
  | "official_gold_isolation"
  | "official_runner_adapter"
  | "trajectory_capture"
  | "cost_latency_retries"
  | "xlsx_import_export"
  | "formula_recompute"
  | "format_diff"
  | "chart_visual_grade"
  | "pptx_docx_pdf_outputs"
  | "mcp_financial_tools"
  | "docker_sandbox"
  | "rubric_weighted_scoring";

export type CapabilityState = "implemented" | "partial" | "missing" | "external";

export type CapabilityReadiness = {
  capability: BenchmarkCapability;
  state: CapabilityState;
  evidence?: string;
  blocker?: string;
};

export type OfficialBenchmarkContract = {
  id: OfficialBenchmarkId;
  name: string;
  sourceUrls: string[];
  taskShape: string;
  scoringShape: string;
  requiredCapabilities: BenchmarkCapability[];
};

export type OfficialBenchmarkReadiness = OfficialBenchmarkContract & {
  capabilities: CapabilityReadiness[];
  ready: boolean;
  blockers: string[];
};

export const OFFICIAL_BENCHMARK_CONTRACTS: OfficialBenchmarkContract[] = [
  {
    id: "bankertoolbench",
    name: "BankerToolBench",
    sourceUrls: [
      "https://arxiv.org/abs/2604.11304",
      "https://github.com/Handshake-AI-Research/bankertoolbench",
      "https://huggingface.co/datasets/handshake-ai-research/bankertoolbench",
    ],
    taskShape:
      "100 end-to-end junior investment-banking tasks that require data-room navigation, market/SEC/logo tools, and multi-file Excel, PowerPoint, Word, PDF deliverables.",
    scoringShape:
      "Agentic verifier opens deliverables and scores weighted binary rubric criteria; reporting must include model, harness, tool policy, budget, verifier, trajectory, retries, and failures.",
    requiredCapabilities: [
      "official_task_ingest",
      "official_gold_isolation",
      "official_runner_adapter",
      "trajectory_capture",
      "cost_latency_retries",
      "xlsx_import_export",
      "formula_recompute",
      "pptx_docx_pdf_outputs",
      "mcp_financial_tools",
      "docker_sandbox",
      "rubric_weighted_scoring",
    ],
  },
  {
    id: "spreadsheetbench-v1",
    name: "SpreadsheetBench",
    sourceUrls: [
      "https://arxiv.org/abs/2406.14991",
      "https://github.com/RUCKBReasoning/SpreadsheetBench",
      "https://huggingface.co/datasets/KAKA22/SpreadsheetBench",
    ],
    taskShape:
      "912 real-world spreadsheet manipulation instructions with 2,729 test cases, varied workbook structures, and Excel-forum style user intent.",
    scoringShape:
      "Online-judge style multi-test-case evaluation; the agent must produce robust spreadsheet transformations without seeing hidden test values.",
    requiredCapabilities: [
      "official_task_ingest",
      "official_gold_isolation",
      "official_runner_adapter",
      "trajectory_capture",
      "cost_latency_retries",
      "xlsx_import_export",
      "formula_recompute",
      "format_diff",
    ],
  },
  {
    id: "spreadsheetbench-v2",
    name: "SpreadsheetBench 2",
    sourceUrls: [
      "https://spreadsheetbench.github.io/",
      "https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2",
    ],
    taskShape:
      "321 end-to-end business spreadsheet workflows covering financial modeling, formula debugging, data analysis, formatting, and chart visualization.",
    scoringShape:
      "Workflow-level grading across exact cell values/formulas/formats plus visual chart quality; benchmark-faithful mode must preserve unchanged ground-truth cells and avoid answer lookup.",
    requiredCapabilities: [
      "official_task_ingest",
      "official_gold_isolation",
      "official_runner_adapter",
      "trajectory_capture",
      "cost_latency_retries",
      "xlsx_import_export",
      "formula_recompute",
      "format_diff",
      "chart_visual_grade",
    ],
  },
];

const CAPABILITY_STATUS: Record<BenchmarkCapability, CapabilityReadiness> = {
  official_task_ingest: {
    capability: "official_task_ingest",
    state: "missing",
    blocker: "No official benchmark task downloader/cache/manifest runner is wired yet.",
  },
  official_gold_isolation: {
    capability: "official_gold_isolation",
    state: "partial",
    evidence: "docs/TARGET_2026_06.md",
    blocker: "Internal eval policy forbids hidden gold leaks, but official benchmark adapters do not yet enforce this boundary.",
  },
  official_runner_adapter: {
    capability: "official_runner_adapter",
    state: "missing",
    blocker: "No Harbor/BankerToolBench or SpreadsheetBench runner adapter exists in this repo.",
  },
  trajectory_capture: {
    capability: "trajectory_capture",
    state: "implemented",
    evidence: "evals/evalStore.ts",
  },
  cost_latency_retries: {
    capability: "cost_latency_retries",
    state: "implemented",
    evidence: "evals/financeModelLive.ts",
  },
  xlsx_import_export: {
    capability: "xlsx_import_export",
    state: "partial",
    evidence: "src/app/spreadsheetParser.ts",
    blocker: "Import exists; official export/reopen diffing and workbook-level answer packaging are not complete.",
  },
  formula_recompute: {
    capability: "formula_recompute",
    state: "partial",
    evidence: "evals/financeModelLive.ts",
    blocker: "Finance eval recomputes supported formulas; full Excel-compatible official recompute is not complete.",
  },
  format_diff: {
    capability: "format_diff",
    state: "missing",
    blocker: "No official cell-format/style diff grader is wired.",
  },
  chart_visual_grade: {
    capability: "chart_visual_grade",
    state: "missing",
    blocker: "No VLM/chart-visual evaluator is wired into benchmark-faithful mode.",
  },
  pptx_docx_pdf_outputs: {
    capability: "pptx_docx_pdf_outputs",
    state: "missing",
    blocker: "No official pitch-deck/report deliverable generation and verifier handoff is wired.",
  },
  mcp_financial_tools: {
    capability: "mcp_financial_tools",
    state: "missing",
    blocker: "BTB SEC/market-data/logo MCP tool servers are not adapted into NodeRoom's tool registry.",
  },
  docker_sandbox: {
    capability: "docker_sandbox",
    state: "external",
    evidence: "docs/eval/docker-sandbox-probe.json",
    blocker:
      "BTB/official process isolation requires Docker/Harbor execution outside the Vite/Convex app runtime; npm run benchmark:docker-sandbox:probe records whether the local daemon can prove a container with --network=none, an agent workspace mount, and no evaluator mount. If the artifact status is not container_isolation_proven, official readiness remains red.",
  },
  rubric_weighted_scoring: {
    capability: "rubric_weighted_scoring",
    state: "missing",
    blocker: "No official weighted rubric scorer adapter exists.",
  },
};

const BENCHMARK_CAPABILITY_STATUS: Partial<Record<OfficialBenchmarkId, Partial<Record<BenchmarkCapability, CapabilityReadiness>>>> = {
  bankertoolbench: {
    official_task_ingest: {
      capability: "official_task_ingest",
      state: "implemented",
      evidence: "src/eval/bankerToolBenchAdapter.ts",
    },
    official_gold_isolation: {
      capability: "official_gold_isolation",
      state: "partial",
      evidence: "src/eval/bankerToolBenchStage.ts",
      blocker:
        "BankerToolBench staging separates final prompts/input files from evaluator-only prompt context, formatting context, canary, weighted rubric, golden outputs, and expected deliverable package metadata; contamination checks cover staged agent manifests and a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, but Harbor/Docker process isolation and verifier handoff are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
      blocker:
        "A local BankerToolBench runner now emits candidate deliverables from per-attempt agent workspaces before opening evaluator-only rubric/golden metadata, validates exact expected package shape for supported Excel/PowerPoint/Word/PDF-style deliverables, reopens Excel deliverables for semantic workbook scoring when hashes drift, and records local exact/semantic-golden smoke scores; npm run benchmark:bankertoolbench:proof enforces the staged isolation, candidate-before-evaluator trajectory, weighted-rubric/package accounting, supported deliverable policy, and 0-leak artifact bounds in HALO. Harbor/Docker execution, MCP financial tools, and Gandalf verifier replay are still missing.",
    },
    xlsx_import_export: {
      capability: "xlsx_import_export",
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
      blocker:
        "The local BTB runner can emit workbook deliverables, reopen candidate/golden .xlsx/.xlsm files, and accept semantically matching workbooks even when package hashes differ; official workbook-level answer packaging, Harbor execution, and Gandalf verifier handoff are still missing.",
    },
    pptx_docx_pdf_outputs: {
      capability: "pptx_docx_pdf_outputs",
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
      blocker:
        "The local BTB runner validates multi-file candidate packages and supported .pptx/.docx/.pdf deliverable extensions after candidate emission; actual pitch-deck/report generation and official verifier handoff are not wired.",
    },
    rubric_weighted_scoring: {
      capability: "rubric_weighted_scoring",
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
      blocker:
        "Weighted rubric metadata is parsed, isolated for the evaluator, consumed by a local exact-package/exact-or-workbook-semantic-golden smoke scorer, and guarded by npm run benchmark:bankertoolbench:proof; Gandalf/Harbor verifier execution and score import are not wired.",
    },
  },
  "spreadsheetbench-v1": {
    official_task_ingest: {
      capability: "official_task_ingest",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchAdapter.ts",
    },
    official_gold_isolation: {
      capability: "official_gold_isolation",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchStage.ts",
      blocker:
        "SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, result rows carry sidecar hashes for candidate manifests, agent-workspace manifests, generated edit plans, and raw model output, contamination checks cover staged and candidate metadata including those workspace manifests, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, an official V1 N=5 live model smoke passes 5/5 with 0 candidate-output leaks, and a broader locally staged official V1 three-task N=5 live smoke passes 15/15 with 0 candidate-output leaks across 60 checked files, but official full-bundle Docker/Harbor process isolation and output policy proof are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; official V1 N=5 records 5/5 pass, average overall 1.0, p95 4.593s, $0.01059125 spend, zero failure counts, retry-policy accounting, workspace manifests, raw model output, sidecar hashes, visible aggregate_section table operations, deterministic SUM total result packaging, unsupported-op repair, expected-formula-only scoring, candidate-output contamination proof, and local Node permission sandbox proof. The broader locally staged official V1 three-task N=5 live smoke now records 15/15 pass across 3 cases and 5 repeats, average overall 1.0, p95 5.080s, $0.0462905 spend, zero failure counts, zero retry attempts, 0 candidate-output leaks across 60 checked files, result-level sidecar hashes for candidate manifests/workspace manifests/edit plans/raw model outputs, and structural filter_rows/sort_unique_rows repair for visible date filters and duplicate-removal/sort tables; npm run benchmark:spreadsheetbench:proof enforces those checked-in artifact thresholds and trajectory order in HALO. Larger full-bundle runs, Docker/Harbor sandbox proof, and route selection remain incomplete.",
    },
    xlsx_import_export: {
      capability: "xlsx_import_export",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
    },
    formula_recompute: {
      capability: "formula_recompute",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring, and the scorer no longer penalizes value-equivalent candidate formulas when gold stores only scalar results. A full Excel-compatible recompute engine is not complete.",
    },
    format_diff: {
      capability: "format_diff",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchScorer.ts",
      blocker:
        "The scorer can diff stable ExcelJS cell style fingerprints plus answer-range column widths/hidden state, row heights/hidden state, and intersecting merge ranges when enabled; official format-grading policy and full workbook/layout coverage are not complete.",
    },
  },
  "spreadsheetbench-v2": {
    official_task_ingest: {
      capability: "official_task_ingest",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchAdapter.ts",
    },
    official_gold_isolation: {
      capability: "official_gold_isolation",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchStage.ts",
      blocker:
        "SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, a Node permission subprocess smoke proves evaluator-only reads are denied outside the agent workspace, and V1/V2 contamination evidence exists, but rendered V2 chart/visual grading, V2 official model runs, and Docker/Harbor process isolation are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; V1 N=5 live model evidence passes 5/5 and the broader locally staged V1 three-task N=5 smoke passes 15/15 with retry-policy accounting, raw model output, sidecar hashes, deterministic SUM total result packaging, visible aggregate_section/filter_rows/sort_unique_rows table operations, expected-formula-only scoring, workspace manifests, local Node permission sandbox proof, and static V2 chart-package scoring, but V2 official model runs, Docker/Harbor sandbox proof, route selection, and rendered/VLM chart grading remain incomplete.",
    },
    xlsx_import_export: {
      capability: "xlsx_import_export",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
    },
    formula_recompute: {
      capability: "formula_recompute",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "The SpreadsheetBench runner caches deterministic results for a local formula subset covering arithmetic, same-sheet cell refs/ranges, SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ABS, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR, and SUMIF/COUNTIF before export/reopen scoring, and scalar-gold/formula-candidate equivalence is handled when values match; full Excel-compatible recompute, chart formulas, external refs, and volatile functions are not complete.",
    },
    format_diff: {
      capability: "format_diff",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchScorer.ts",
      blocker:
        "The scorer can diff stable ExcelJS cell style fingerprints plus answer-range column widths/hidden state, row heights/hidden state, and intersecting merge ranges when enabled; official format-grading policy, chart rendering, and visual grading are not complete.",
    },
    chart_visual_grade: {
      capability: "chart_visual_grade",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchChartScorer.ts",
      blocker:
        "SpreadsheetBench score/run reports can include a static XLSX chart-package comparison over chart and drawing XML parts; rendered chart screenshots and VLM visual quality grading are not wired.",
    },
  },
};

export function officialBenchmarkReadiness(): OfficialBenchmarkReadiness[] {
  return OFFICIAL_BENCHMARK_CONTRACTS.map((contract) => {
    const capabilities = contract.requiredCapabilities.map((capability) => capabilityStatusFor(contract.id, capability));
    const blockers = capabilities
      .filter((item) => item.state !== "implemented")
      .map((item) => `${item.capability}: ${item.blocker ?? "not implemented"}`);
    return {
      ...contract,
      capabilities,
      ready: blockers.length === 0,
      blockers,
    };
  });
}

export function officialBenchmarkSummary(readiness = officialBenchmarkReadiness()) {
  return {
    total: readiness.length,
    ready: readiness.filter((item) => item.ready).length,
    blocked: readiness.filter((item) => !item.ready).length,
    missingCapabilities: [...new Set(readiness.flatMap((item) => item.blockers.map((blocker) => blocker.split(":")[0])))].sort(),
  };
}

function capabilityStatusFor(benchmarkId: OfficialBenchmarkId, capability: BenchmarkCapability): CapabilityReadiness {
  return BENCHMARK_CAPABILITY_STATUS[benchmarkId]?.[capability] ?? CAPABILITY_STATUS[capability];
}
