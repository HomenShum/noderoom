export type ModelEvalSuite = "research" | "collaboration";
export type ModelPromotion =
  | "research_champion"
  | "candidate"
  | "demo_only"
  | "compatibility";

export type SupportedModelRoute = {
  route: string;
  provider: "openrouter" | "native" | "internal_alias";
  label: string;
  promotion: ModelPromotion;
  suites: ModelEvalSuite[];
  notes: string;
  evidence?: string;
};

export type ModelEvalScenario = {
  id: string;
  suite: ModelEvalSuite;
  label: string;
  gate: string;
  source: string;
};

export type ModelEvalCommand = {
  id: string;
  suite: ModelEvalSuite;
  description: string;
  command: string;
  args: string[];
  writes: string[];
  routes: string[];
};

export type ModelEvalPlanOptions = {
  suite?: ModelEvalSuite | "all";
  routeSet?: string;
  companies?: number;
  modelTimeoutMs?: number;
  modelReserveMs?: number;
  rowHardTimeoutMs?: number;
  rungTimeoutMs?: number;
  rungReserveMs?: number;
};

export const MODEL_EVAL_SCENARIOS: ModelEvalScenario[] = [
  {
    id: "company_research_v3",
    suite: "research",
    label: "Company research v3 composite synthesis",
    gate: "fetch_row_sources -> model-authored synthesis -> write_row; 9 deterministic/judge checks",
    source: "scripts/benchmark/run.ts",
  },
  {
    id: "collaboration_l1_read",
    suite: "collaboration",
    label: "L1 read-only no mutation",
    gate: "read exact target and produce no writes",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l2_cas_edit",
    suite: "collaboration",
    label: "L2 single-cell CAS edit",
    gate: "claim exact cell, read current version, write with CAS, release",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l3_conflict",
    suite: "collaboration",
    label: "L3 conflict recovery",
    gate: "observe conflict, re-read, retry without clobbering a human edit",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l4_blocked_draft",
    suite: "collaboration",
    label: "L4 blocked range drafts instead of forcing",
    gate: "denied lock becomes a draft with the target operation; no direct write while locked",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l5_large_range",
    suite: "collaboration",
    label: "L5 large range without full snapshot",
    gate: "600-row sheet: load only the narrow window (no full-sheet read, bounded context), touch only the target cell",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l6_long_horizon",
    suite: "collaboration",
    label: "L6 long horizon under compaction + conflicts",
    gate: "5 targets with 3 injected human conflicts and compacted context; fresh read provenance for every edit, no lock shortcut",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l7_resume",
    suite: "collaboration",
    label: "L7 resume after slice death",
    gate: "slice 1 dies mid-task (real exhaustion + handoff); a COLD slice 2 finishes only the remaining targets — completed work untouched, a human's between-slice revision left standing",
    source: "evals/ladder.ts",
  },
];

export const SUPPORTED_MODEL_ROUTES: SupportedModelRoute[] = [
  {
    route: "nex-agi/nex-n2-pro:free",
    provider: "openrouter",
    label: "Nex AGI Nex-N2-Pro free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Fastest $0 route in the 2026-06-11 cheap/free research smoke; needs collaboration ladder evidence before shared-room promotion.",
  },
  {
    route: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    label: "DeepSeek V4 Flash",
    promotion: "research_champion",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Prior 3-company v3 research champion and still a cheap paid fallback; must clear the live collaboration ladder before interactive promotion.",
  },
  {
    route: "ibm-granite/granite-4.1-8b",
    provider: "openrouter",
    label: "IBM Granite 4.1 8B",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Cheapest paid route clearing the 2026-06-11 cheap/free smoke; test collaboration before write routing.",
  },
  {
    route: "z-ai/glm-4.7-flash",
    provider: "openrouter",
    label: "GLM 4.7 Flash",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Very low-cost OpenRouter candidate; cleared research smoke, still needs collaboration ladder evidence.",
  },
  {
    route: "inclusionai/ring-2.6-1t",
    provider: "openrouter",
    label: "inclusionAI Ring 2.6 1T",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Low-cost OpenRouter candidate that cleared the 2026-06-11 research smoke.",
  },
  {
    route: "xiaomi/mimo-v2.5",
    provider: "openrouter",
    label: "Xiaomi MiMo V2.5",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "OpenRouter live route candidate for low-cost research and agentic editing.",
  },
  {
    route: "stepfun/step-3.7-flash",
    provider: "openrouter",
    label: "StepFun Step 3.7 Flash",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Recent low-cost OpenRouter route that cleared the cheap/free research smoke.",
  },
  {
    route: "minimax/minimax-m3",
    provider: "openrouter",
    label: "MiniMax M3",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Current MiniMax low-cost route replacing the older M2.7 candidate.",
  },
  {
    route: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    label: "DeepSeek V4 Pro",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Cheap higher-capability DeepSeek route; cleared research smoke but costs more than V4 Flash.",
  },
  {
    route: "google/gemini-3.1-flash-lite",
    provider: "openrouter",
    label: "Gemini 3.1 Flash Lite via OpenRouter",
    promotion: "candidate",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Low-cost OpenRouter route; research-only until collaboration tool behavior is proven.",
  },
  {
    route: "qwen/qwen3.7-plus",
    provider: "openrouter",
    label: "Qwen 3.7 Plus",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "OpenRouter live route candidate; evaluate synthesis quality and blocked-range behavior before use.",
  },
  {
    route: "nvidia/nemotron-3-ultra-550b-a55b",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Ultra",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "High-capability OpenRouter route; include to test whether higher capability justifies latency/cost.",
  },
  {
    route: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Ultra free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Free concrete route that cleared research smoke; live collaboration ladder still blocks interactive promotion.",
  },
  {
    route: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Super free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/free-auto-router-ladder.json",
    notes: "Free concrete route that clears research smoke but times out on blocked-range collaboration behavior.",
  },
  {
    route: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    label: "Gemma 4 31B free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared the 2026-06-11 research smoke; research-only until collaboration is tested.",
  },
  {
    route: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    label: "GPT OSS 120B free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared research smoke; keep out of interactive writes until ladder-tested.",
  },
  {
    route: "poolside/laguna-xs.2:free",
    provider: "openrouter",
    label: "Poolside Laguna XS.2 free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared the cheap/free research smoke; research-only until ladder-tested.",
  },
  {
    route: "poolside/laguna-m.1:free",
    provider: "openrouter",
    label: "Poolside Laguna M.1 free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared research smoke but was slower than the XS route.",
  },
  {
    route: "openrouter/free-auto",
    provider: "internal_alias",
    label: "OpenRouter free-auto alias",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/free-auto-router-ladder.json",
    notes: "Internal NodeRoom alias that expands to current free routes; opt-in demo/background lane until it clears both gates.",
  },
  {
    route: "gemini-3.5-flash",
    provider: "native",
    label: "Gemini 3.5 Flash",
    promotion: "compatibility",
    suites: ["collaboration"],
    evidence: "docs/qa/production-matrix.json",
    notes: "Current Convex fallback route with recorded L1-L4 safety; keep as compatibility coverage.",
  },
];

export const DEFAULT_RESEARCH_MODEL_ROUTES = [
  "nex-agi/nex-n2-pro:free",
  "ibm-granite/granite-4.1-8b",
  "deepseek/deepseek-v4-flash",
  "z-ai/glm-4.7-flash",
];

export function routesForSuite(suite: ModelEvalSuite): string[] {
  return SUPPORTED_MODEL_ROUTES
    .filter((route) => route.suites.includes(suite))
    .map((route) => route.route);
}

export function resolveRouteSet(routeSet = "supported", suite: ModelEvalSuite | "all" = "all"): string[] {
  const selected = routeSet.trim();
  const eligible = (route: SupportedModelRoute) => suite === "all" || route.suites.includes(suite);
  if (selected === "supported" || selected === "all") {
    const suites = suite === "all" ? ["research", "collaboration"] as const : [suite];
    return unique(suites.flatMap((s) => routesForSuite(s)));
  }
  if (selected === "research") return routesForSuite("research");
  if (selected === "collaboration") return routesForSuite("collaboration");
  if (selected === "champions") {
    return SUPPORTED_MODEL_ROUTES
      .filter((route) => eligible(route) && (route.promotion === "research_champion" || route.promotion === "compatibility"))
      .map((route) => route.route);
  }
  if (selected === "free") {
    return SUPPORTED_MODEL_ROUTES
      .filter((route) => eligible(route) && route.promotion === "demo_only")
      .map((route) => route.route);
  }
  return unique(selected.split(",").map((route) => route.trim()).filter(Boolean));
}

export function scenariosForSuite(suite: ModelEvalSuite | "all" = "all"): ModelEvalScenario[] {
  return suite === "all" ? MODEL_EVAL_SCENARIOS : MODEL_EVAL_SCENARIOS.filter((scenario) => scenario.suite === suite);
}

export function buildModelEvalCommands(options: ModelEvalPlanOptions = {}): ModelEvalCommand[] {
  const suite = options.suite ?? "all";
  const commands: ModelEvalCommand[] = [];
  const researchRoutes = suite === "collaboration" ? [] : resolveRouteSet(options.routeSet ?? "supported", "research");
  const collaborationRoutes = suite === "research" ? [] : resolveRouteSet(options.routeSet ?? "supported", "collaboration");
  if (researchRoutes.length > 0) {
    commands.push({
      id: "research_v3",
      suite: "research",
      description: "Run the v3 company-research synthesis benchmark across selected routes.",
      command: "tsx",
      args: [
        "scripts/benchmark/run.ts",
        researchRoutes.join(","),
        "--no-merge",
        `--companies=${options.companies ?? 3}`,
        `--model-timeout-ms=${options.modelTimeoutMs ?? 240_000}`,
        `--model-reserve-ms=${options.modelReserveMs ?? 10_000}`,
        `--row-hard-timeout-ms=${options.rowHardTimeoutMs ?? 270_000}`,
      ],
      writes: ["docs/eval/results.json", "docs/eval/traces/benchmark/"],
      routes: researchRoutes,
    });
  }
  if (collaborationRoutes.length > 0) {
    commands.push({
      id: "collaboration_l1_l7",
      suite: "collaboration",
      description: "Run the live L1-L7 collaboration ladder (lock/CAS/draft + scale, long-horizon, and resume-after-slice-death) across selected routes.",
      command: "tsx",
      args: [
        "evals/ladder.ts",
        "--real",
        collaborationRoutes.join(","),
        "--levels=1-7",
        `--rung-timeout-ms=${options.rungTimeoutMs ?? 540_000}`,
        `--reserve-ms=${options.rungReserveMs ?? 30_000}`,
        "--json-out",
        "docs/eval/model-ladder-supported.json",
      ],
      writes: ["docs/eval/model-ladder-supported.json"],
      routes: collaborationRoutes,
    });
  }
  return commands;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
