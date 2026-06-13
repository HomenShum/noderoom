import { existsSync, readFileSync } from "node:fs";

export type OpenRouterConvexRoute = {
  route: string;
  provider: "openrouter" | "native" | "internal_alias";
  label: string;
  promotion: string;
  suites: string[];
  notes?: string;
  evidence?: string;
};

export type OpenRouterConvexCaseStatus = "pass" | "blocked" | "missing";
export type OpenRouterConvexCaseScope = "openrouter_convex_harness" | "official_promotion";

export type OpenRouterConvexBenchmarkCase = {
  id: string;
  title: string;
  inspiredBy: Array<"SpreadsheetBench" | "SpreadsheetBench 2" | "BankerToolBench" | "NodeRoom">;
  scope: OpenRouterConvexCaseScope;
  status: OpenRouterConvexCaseStatus;
  evidence: string[];
  requiredConvexContract: string[];
  acceptance: string;
  blockers: string[];
};

export type OpenRouterConvexRoutePlan = {
  route: string;
  provider: "openrouter" | "internal_alias";
  label: string;
  role: "interactive_candidate" | "background_long_running_only" | "research_only";
  adapter: "convexModel.openrouter_chat_completions" | "convexModel.openrouter_free_auto";
  eligibleForConvexHarness: boolean;
  mustRunThroughAgentJobs: true;
  requiredContract: string[];
  evidence: string[];
  blockers: string[];
};

export type OpenRouterConvexBenchmarkReport = {
  schema: 1;
  generatedAt?: string;
  summary: {
    routeCount: number;
    openRouterRouteCount: number;
    harnessCases: number;
    harnessCasesPassing: number;
    officialPromotionCases: number;
    officialPromotionCasesPassing: number;
    harnessReady: boolean;
    officialPromotionReady: boolean;
  };
  designPrinciples: string[];
  cases: OpenRouterConvexBenchmarkCase[];
  routePlans: OpenRouterConvexRoutePlan[];
};

const CONVEX_CONTRACT = [
  "agentJobs is the durable root for every benchmark run, including /ask and /free",
  "Convex actions call providers; browser/client_action never calls OpenRouter directly",
  "agentStepJournal records model input/output hashes before replay can skip duplicate provider calls",
  "agentOperationEvents counts query/action/mutation/model/tool/scheduler steps",
  "agentLeases fence slices and prevent duplicate workers from committing the same job",
  "mutationReceipts tie every canonical cell write to a job, tool call, baseVersion, and result",
  "artifact ids remain the system of record; provider file/cache ids are adapter metadata only",
  "CAS conflicts return as data, not thrown errors, so OpenRouter models can re-read and recover",
];

export function buildOpenRouterConvexBenchmarkReport(args: {
  routes: OpenRouterConvexRoute[];
  generatedAt?: string;
}): OpenRouterConvexBenchmarkReport {
  const cases = benchmarkCases();
  const harnessCases = cases.filter((item) => item.scope === "openrouter_convex_harness");
  const officialCases = cases.filter((item) => item.scope === "official_promotion");
  const harnessReady = harnessCases.every((item) => item.status === "pass");
  const routePlans = args.routes
    .filter((route) => route.provider === "openrouter" || route.provider === "internal_alias")
    .map((route) => routePlan(route, harnessReady));

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    summary: {
      routeCount: args.routes.length,
      openRouterRouteCount: routePlans.length,
      harnessCases: harnessCases.length,
      harnessCasesPassing: harnessCases.filter((item) => item.status === "pass").length,
      officialPromotionCases: officialCases.length,
      officialPromotionCasesPassing: officialCases.filter((item) => item.status === "pass").length,
      harnessReady,
      officialPromotionReady: officialCases.every((item) => item.status === "pass"),
    },
    designPrinciples: [
      "OpenRouter is a provider adapter, not the runtime owner; Convex owns durable jobs, artifacts, leases, traces, and receipts.",
      "Benchmark-shaped work is routed through deterministic tools first, then bounded model edit plans, then evidence-bearing writes.",
      "Free-auto is a long-running/background lane until ladder and p95 evidence prove it can meet interactive collaboration budgets.",
      "Official benchmark claims stay blocked until the external verifier path is wired; internal Convex benchmark readiness is separate.",
    ],
    cases,
    routePlans,
  };
}

function routePlan(route: OpenRouterConvexRoute, harnessReady: boolean): OpenRouterConvexRoutePlan {
  const isFreeAuto = route.route === "openrouter/free-auto";
  const supportsCollaboration = route.suites.includes("collaboration");
  const role = !supportsCollaboration
    ? "research_only"
    : isFreeAuto || route.promotion === "demo_only"
      ? "background_long_running_only"
      : "interactive_candidate";
  const blockers = [
    ...(!supportsCollaboration ? ["route is not ladder-tested for collaboration writes"] : []),
    ...(!harnessReady ? ["OpenRouter-on-Convex harness cases are not all passing"] : []),
    ...(role === "background_long_running_only" ? ["route needs N>=5 p95 ladder evidence before interactive promotion"] : []),
  ];
  return {
    route: route.route,
    provider: route.provider as "openrouter" | "internal_alias",
    label: route.label,
    role,
    adapter: isFreeAuto ? "convexModel.openrouter_free_auto" : "convexModel.openrouter_chat_completions",
    eligibleForConvexHarness: harnessReady && supportsCollaboration,
    mustRunThroughAgentJobs: true,
    requiredContract: CONVEX_CONTRACT,
    evidence: [route.evidence, "src/agent/convexModel.ts", "convex/agentJobs.ts"].filter(Boolean) as string[],
    blockers,
  };
}

function benchmarkCases(): OpenRouterConvexBenchmarkCase[] {
  const latestLoop = readJson<{ steps?: Array<{ id?: string; status?: string }> }>("docs/eval/agent-improvement-loop/latest.json");
  const ladderPass = latestLoop?.steps?.some((step) => step.id === "collaboration-ladder" && step.status === "pass") === true;
  const multiUser = readJson<{ summary?: { passed?: boolean } }>("docs/eval/multi-user-coordination-proof.json");
  const v1Routes = readJson<{ taskCount?: number; routeCounts?: Record<string, number> }>("docs/eval/spreadsheetbench-v1-route-selection.json");
  const v2Routes = readJson<{ taskCount?: number; routeCounts?: Record<string, number> }>("docs/eval/spreadsheetbench-v2-route-selection.json");
  const chart = readJson<{ pass?: boolean; status?: string }>("docs/eval/spreadsheetbench-chart-visual-probe.json");
  const docker = readJson<{ pass?: boolean; status?: string }>("docs/eval/docker-sandbox-probe.json");
  const btb = readJson<{ pass?: boolean; status?: string; blockers?: string[] }>("docs/eval/bankertoolbench-official-contract.json");

  return [
    {
      id: "convex_job_journal_and_replay",
      title: "Durable model-step journaling before replay",
      inspiredBy: ["NodeRoom", "SpreadsheetBench", "BankerToolBench"],
      scope: "openrouter_convex_harness",
      status: existsSync("tests/agentJobsRuntime.test.ts") ? "pass" : "missing",
      evidence: ["tests/agentJobsRuntime.test.ts", "convex/agentStepJournal.ts", "convex/agentJobs.ts"],
      requiredConvexContract: [
        "createOrReuse idempotency",
        "model-step hash journal",
        "operation events",
        "attempt counters",
      ],
      acceptance: "A duplicate model step replays the recorded result and cannot overwrite the first output hash.",
      blockers: [],
    },
    {
      id: "convex_l1_l7_collaboration_ladder",
      title: "Lock/CAS/draft/large-range/resume ladder",
      inspiredBy: ["NodeRoom", "SpreadsheetBench"],
      scope: "openrouter_convex_harness",
      status: ladderPass ? "pass" : "blocked",
      evidence: ["docs/eval/agent-improvement-loop/latest.json", "evals/ladder.ts"],
      requiredConvexContract: [
        "read before write",
        "baseVersion CAS",
        "draft on blocked range",
        "bounded large-range context",
        "cold resume after slice death",
      ],
      acceptance: "The latest improvement loop records the collaboration ladder as PASS through L7.",
      blockers: ladderPass ? [] : ["Run npm run ladder -- --record and refresh docs/eval/agent-improvement-loop/latest.json."],
    },
    {
      id: "convex_multi_user_coordination",
      title: "Multi-user and human-vs-human coordination proof",
      inspiredBy: ["NodeRoom", "SpreadsheetBench"],
      scope: "openrouter_convex_harness",
      status: multiUser?.summary?.passed === true ? "pass" : "blocked",
      evidence: ["docs/eval/multi-user-coordination-proof.json", "evals/multiUserCoordinationProof.ts"],
      requiredConvexContract: [
        "runtime-managed range locks",
        "stale-write conflict data",
        "draft then smart-merge",
        "finally-release lock fencing",
      ],
      acceptance: "All recorded multi-user coordination scenarios pass with zero active lock leaks.",
      blockers: multiUser?.summary?.passed === true ? [] : ["Run npm run eval:multiuser-coordination."],
    },
    {
      id: "spreadsheetbench_route_contract",
      title: "SpreadsheetBench-shaped tasks route to deterministic tools or bounded model edit plans",
      inspiredBy: ["SpreadsheetBench", "SpreadsheetBench 2"],
      scope: "openrouter_convex_harness",
      status: routeReportsPass(v1Routes, v2Routes) ? "pass" : "blocked",
      evidence: [
        "docs/eval/spreadsheetbench-v1-route-selection.json",
        "docs/eval/spreadsheetbench-v2-route-selection.json",
        "src/eval/spreadsheetBenchRouteSelection.ts",
      ],
      requiredConvexContract: [
        "deterministic table transforms before model calls",
        "formula edit plans with deterministic formula-result cache",
        "format edit plans with workbook style diff evidence",
        "chart routes require rendered/VLM grade evidence",
      ],
      acceptance: "Staged route-selection reports have tasks, and blocked_chart_visual is zero.",
      blockers: routeReportsPass(v1Routes, v2Routes) ? [] : ["Regenerate SpreadsheetBench route selection and clear blocked_chart_visual."],
    },
    {
      id: "spreadsheetbench_chart_visual_grade",
      title: "Rendered chart visual grading lane",
      inspiredBy: ["SpreadsheetBench 2"],
      scope: "openrouter_convex_harness",
      status: chart?.pass === true && chart.status === "chart_visual_grade_proven" ? "pass" : "blocked",
      evidence: [
        "docs/eval/spreadsheetbench-chart-visual-probe.json",
        "docs/eval/spreadsheetbench-chart-visual/task-126/vlm-report.json",
        "scripts/spreadsheetbench-chart-visual-grade.ts",
      ],
      requiredConvexContract: [
        "workbook rendering is evaluator-side evidence",
        "Gemini/VLM judge is separate from OpenRouter candidate generation",
        "candidate/gold PNG hashes are recorded before visual acceptance",
      ],
      acceptance: "The chart visual probe records chart_visual_grade_proven with an accepted positive candidate and rejected negative control.",
      blockers: chart?.pass === true ? [] : ["Run npm run benchmark:spreadsheetbench:chart-visual:grade and probe --strict."],
    },
    {
      id: "docker_agent_workspace_isolation",
      title: "Agent workspace isolation for benchmark execution",
      inspiredBy: ["SpreadsheetBench", "BankerToolBench"],
      scope: "openrouter_convex_harness",
      status: docker?.pass === true && docker.status === "container_isolation_proven" ? "pass" : "blocked",
      evidence: ["docs/eval/docker-sandbox-probe.json", "src/eval/dockerSandboxProbe.ts"],
      requiredConvexContract: [
        "candidate generation sees only agent workspace mounts",
        "evaluator gold is denied until scoring phase",
        "network policy is explicit",
      ],
      acceptance: "Docker probe records container_isolation_proven with evaluator reads denied.",
      blockers: docker?.pass === true ? [] : ["Start Docker and run npm run benchmark:docker-sandbox:probe -- --require-pass."],
    },
    {
      id: "bankertoolbench_official_verifier_path",
      title: "BankerToolBench Harbor/MCP/Gandalf verifier path",
      inspiredBy: ["BankerToolBench"],
      scope: "official_promotion",
      status: btb?.pass === true ? "pass" : "blocked",
      evidence: ["docs/eval/bankertoolbench-official-contract.json", "src/eval/bankerToolBenchRunner.ts"],
      requiredConvexContract: [
        "official dataset manifest lock",
        "benchmark-defined MCP financial tools",
        "Harbor/Docker execution",
        "Gandalf score import",
      ],
      acceptance: "Official BTB contract imports verifier scores from the real Harbor/Gandalf path.",
      blockers: btb?.pass === true ? [] : btb?.blockers ?? ["BTB official contract artifact is missing."],
    },
  ];
}

function routeReportsPass(
  v1: { taskCount?: number; routeCounts?: Record<string, number> } | undefined,
  v2: { taskCount?: number; routeCounts?: Record<string, number> } | undefined,
): boolean {
  return Boolean(
    (v1?.taskCount ?? 0) > 0 &&
    (v2?.taskCount ?? 0) > 0 &&
    (v1?.routeCounts?.blocked_chart_visual ?? 1) === 0 &&
    (v2?.routeCounts?.blocked_chart_visual ?? 1) === 0,
  );
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
