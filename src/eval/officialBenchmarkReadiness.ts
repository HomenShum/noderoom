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
    blocker: "BTB requires Docker/Harbor execution outside the Vite/Convex app runtime.",
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
        "BankerToolBench staging separates final prompts/input files from evaluator-only prompt context, formatting context, canary, weighted rubric, and golden outputs; a contamination checker covers staged agent manifests, but Harbor/Docker process isolation and verifier handoff are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "missing",
      blocker:
        "No Harbor-compatible NodeRoom runner adapter exists yet; the current BTB support stops at official bundle ingest and staged manifests.",
    },
    rubric_weighted_scoring: {
      capability: "rubric_weighted_scoring",
      state: "partial",
      evidence: "src/eval/bankerToolBenchAdapter.ts",
      blocker:
        "Weighted rubric metadata is parsed and isolated for the evaluator, but Gandalf/Harbor verifier execution and score import are not wired.",
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
        "SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation, contamination checks cover staged and candidate metadata including those workspace manifests, and official V1 N=5/retry failed model smokes exist, but official full-bundle OS/Docker process isolation and output policy proof are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; official V1 N=5 and retry-policy smokes now record fair larger workbook snapshots, raw model output, simple SUM result caching, pass rate, p95 latency, model usage/cost, workspace manifests, scored partial candidates, retry exhaustion, and failure taxonomy, but larger full-bundle runs, OS/Docker sandbox proof, and route selection remain incomplete.",
    },
    xlsx_import_export: {
      capability: "xlsx_import_export",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
    },
    format_diff: {
      capability: "format_diff",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchScorer.ts",
      blocker:
        "The scorer can diff a stable ExcelJS style fingerprint when enabled; official format-grading policy and full style coverage are not complete.",
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
        "SpreadsheetBench staging separates agent-visible files from evaluator-only gold/scorer metadata; runner attempts now copy agent-visible files into an agent-workspace manifest before candidate generation and V1 contamination/N=5/retry evidence exists, but V2 chart/visual grading, V2 official model runs, and OS/Docker process isolation are still missing.",
    },
    official_runner_adapter: {
      capability: "official_runner_adapter",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
      blocker:
        "A copy-input baseline, deterministic edit-plan worker, and model-edit-plan worker emit candidate workbooks from per-attempt agent workspaces and score them afterward; V1 N=5 and retry-policy model smoke evidence exists with fair larger snapshots, raw model output, simple SUM result caching, and workspace manifests, but V2 official runs, OS/Docker sandbox proof, route selection, and chart lane remain incomplete.",
    },
    xlsx_import_export: {
      capability: "xlsx_import_export",
      state: "implemented",
      evidence: "src/eval/spreadsheetBenchRunner.ts",
    },
    format_diff: {
      capability: "format_diff",
      state: "partial",
      evidence: "src/eval/spreadsheetBenchScorer.ts",
      blocker:
        "The scorer can diff a stable ExcelJS style fingerprint when enabled; official format-grading policy, chart rendering, and visual grading are not complete.",
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
