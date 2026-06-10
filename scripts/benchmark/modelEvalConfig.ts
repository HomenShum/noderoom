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
];

export const SUPPORTED_MODEL_ROUTES: SupportedModelRoute[] = [
  {
    route: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    label: "DeepSeek V4 Flash",
    promotion: "research_champion",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Current v3 research champion; still must clear L1-L4 before interactive collaboration promotion.",
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
    route: "moonshotai/kimi-k2.6",
    provider: "openrouter",
    label: "Kimi K2.6",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "Canonical OpenRouter id for the shorthand kimi-k2.6 route in older docs.",
  },
  {
    route: "minimax/minimax-m2.7",
    provider: "openrouter",
    label: "MiniMax M2.7",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "Canonical OpenRouter id for the shorthand minimax-m2.7 route in older docs.",
  },
  {
    route: "z-ai/glm-4.7-flash",
    provider: "openrouter",
    label: "GLM 4.7 Flash",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "Very low-cost OpenRouter candidate; test for tool adherence before routing user writes.",
  },
  {
    route: "deepseek/deepseek-v3.2-speciale",
    provider: "openrouter",
    label: "DeepSeek V3.2 Speciale",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "OpenRouter candidate from the existing catalog, normalized to provider/model form.",
  },
  {
    route: "google/gemma-4-26b-a4b-it",
    provider: "openrouter",
    label: "Gemma 4 26B",
    promotion: "candidate",
    suites: ["research"],
    notes: "Light-task candidate; research benchmark determines whether it can handle synthesis or should stay summary-only.",
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
    route: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Super free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/free-auto-router-ladder.json",
    notes: "Best prior free concrete route for early ladder rungs; timed out on blocked-range behavior.",
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
  "deepseek/deepseek-v4-flash",
  "openrouter/free-auto",
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
      id: "collaboration_l1_l4",
      suite: "collaboration",
      description: "Run the live L1-L4 lock/CAS/draft collaboration ladder across selected routes.",
      command: "tsx",
      args: [
        "evals/ladder.ts",
        "--real",
        collaborationRoutes.join(","),
        "--levels=1-4",
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
