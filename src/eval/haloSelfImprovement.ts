import { estimateChars } from "../nodeagent/core/contextCompactor";
import type { AgentMessage, AgentResult, AgentTraceEvent } from "../nodeagent/core/types";

export type HaloSelfImprovementRunMetric = {
  caseId: string;
  runIndex: number;
  modelName: string;
  stopReason: AgentResult["stopReason"];
  exhausted: boolean;
  modelCalls: number;
  toolCalls: number;
  readCalls: number;
  writeCalls: number;
  modelVisibleCoordinationCalls: number;
  invalidToolCalls: number;
  compactionEvents: number;
  compactionCharsSaved: number;
  compactionElidedToolResults: number;
  finalMessageChars: number;
  missingToolResults: number;
  fingerprint: string;
  traceTools: string[];
};

export type HaloSelfImprovementCaseSummary = {
  caseId: string;
  runs: number;
  pass: boolean;
  uniqueFingerprintCount: number;
  fingerprints: string[];
  p95ModelCalls: number;
  p95ToolCalls: number;
  maxInvalidToolCalls: number;
  maxMissingToolResults: number;
  totalCompactionEvents: number;
  totalCompactionCharsSaved: number;
  totalCompactionElidedToolResults: number;
  notes: string[];
};

export type HaloHarnessImprovementProposal = {
  id: string;
  title: string;
  trigger: string;
  recommendedChange: string;
  expectedEval: string;
  safetyPolicy: string;
  status: "implemented" | "candidate" | "blocked";
};

export type HaloSelfImprovementReport = {
  schema: 1;
  generatedAt: string;
  sourcePattern: "hyperagents-inspired-meta-loop";
  summary: {
    cases: number;
    runs: number;
    pass: boolean;
    unstableCases: string[];
    contextCasesWithCompaction: string[];
  };
  cases: HaloSelfImprovementCaseSummary[];
  proposals: HaloHarnessImprovementProposal[];
  hyperAgentsDelta: {
    alreadyPresent: string[];
    addedByThisGate: string[];
    stillMissing: string[];
    safetyBoundary: string;
  };
};

export type HaloHarnessVariantCandidate = {
  variantId: string;
  parentId: string;
  description: string;
  policy: string;
  metrics: HaloSelfImprovementRunMetric[];
  safetyBoundary: string;
};

export type HaloHarnessVariantSummary = {
  variantId: string;
  parentId: string;
  description: string;
  policy: string;
  runs: number;
  pass: boolean;
  selected: boolean;
  score: number;
  uniqueFingerprintCount: number;
  p95ModelCalls: number;
  p95ToolCalls: number;
  maxInvalidToolCalls: number;
  maxMissingToolResults: number;
  totalCompactionEvents: number;
  totalCompactionCharsSaved: number;
  rejectionReasons: string[];
  fingerprints: string[];
};

export type HaloVariantSelectionReport = {
  schema: 1;
  generatedAt: string;
  sourcePattern: "hyperagents-inspired-meta-loop";
  pass: boolean;
  selectedParent: string | null;
  selectedVariantId: string | null;
  selectionPolicy: {
    minVariants: number;
    requirePassingVariant: true;
    prefer: string[];
    hardReject: string[];
  };
  variants: HaloHarnessVariantSummary[];
  handoff: {
    implementOnlySelectedVariant: true;
    selectedSafetyBoundary?: string;
    blockedReason?: string;
  };
};

export type HaloLivePathCalibrationThresholds = {
  minRuns: number;
  maxUniqueFingerprints: number;
  maxP95ToolCalls: number;
  maxInvalidToolCalls: number;
  maxMissingToolResults: number;
};

export type HaloLivePathCalibrationReport = {
  schema: 1;
  generatedAt: string;
  sourcePattern: "live-provider-path-calibration";
  providerRoute: string;
  status: "calibrated" | "insufficient_runs" | "path_unstable" | "tool_budget_exceeded" | "tool_errors";
  pass: boolean;
  thresholds: HaloLivePathCalibrationThresholds;
  summary: HaloSelfImprovementCaseSummary;
  metrics: HaloSelfImprovementRunMetric[];
  recommendation: string;
};

export type HaloConvexJobContextInput = {
  jobId: string;
  runtime?: string;
  status?: string;
  attempts: number;
  operations: Array<{ kind?: string; name?: string; status?: string; countDelta?: number }>;
  modelJournalRows: number;
  latestRun?: {
    model?: string;
    steps?: number;
    toolCalls?: number;
    stopReason?: string;
    exhausted?: boolean;
    handoff?: unknown;
  };
  latestSteps: Array<{ tool?: string; status?: string; recordHash?: string; prevStepHash?: string }>;
  cursor?: unknown;
};

export type HaloConvexJobContextReport = {
  schema: 1;
  generatedAt: string;
  sourcePattern: "convex-job-context-telemetry";
  pass: boolean;
  jobs: Array<{
    jobId: string;
    runtime?: string;
    status?: string;
    attempts: number;
    operationKinds: Record<string, number>;
    modelJournalRows: number;
    metricMirror: {
      modelName: string;
      stopReason: string;
      exhausted: boolean;
      toolCalls: number;
      compactionEvents: number;
      compactionElidedToolResults: number;
      fingerprint: string;
      missingToolResults: number;
    };
    checks: {
      attemptsRecorded: boolean;
      operationLedgerPresent: boolean;
      modelJournalPresent: boolean;
      cursorCompactionRecorded: boolean;
      stepHashChainPresent: boolean;
      toolPathPresent: boolean;
    };
  }>;
};

const READ_TOOLS = new Set(["read_range", "search_sheet_context", "list_artifacts"]);
const WRITE_TOOLS = new Set([
  "edit_cell",
  "write_cell_result",
  "write_locked_cell",
  "write_locked_cells",
  "write_locked_cell_result",
  "write_locked_cell_results",
  "update_wiki",
  "create_draft",
  "run_algorithm_artifact",
]);
const MODEL_VISIBLE_COORDINATION_TOOLS = new Set(["propose_lock", "release_lock"]);

export function metricFromAgentResult(args: {
  caseId: string;
  runIndex: number;
  modelName: string;
  result: AgentResult;
}): HaloSelfImprovementRunMetric {
  const traceTools = args.result.trace.map((event) => event.tool);
  const compactions = args.result.trace.filter((event) => event.tool === "compaction");
  const pairing = toolPairing(args.result.messages);
  return {
    caseId: args.caseId,
    runIndex: args.runIndex,
    modelName: args.modelName,
    stopReason: args.result.stopReason,
    exhausted: args.result.exhausted,
    modelCalls: args.result.usage.modelCalls,
    toolCalls: args.result.trace.filter((event) => event.tool !== "compaction").length,
    readCalls: traceTools.filter((tool) => READ_TOOLS.has(tool)).length,
    writeCalls: traceTools.filter((tool) => WRITE_TOOLS.has(tool)).length,
    modelVisibleCoordinationCalls: traceTools.filter((tool) => MODEL_VISIBLE_COORDINATION_TOOLS.has(tool)).length,
    invalidToolCalls: args.result.trace.filter((event) => eventResultHasKey(event, "error")).length,
    compactionEvents: compactions.length,
    compactionCharsSaved: compactions.reduce((sum, event) => sum + compactionSavedChars(event), 0),
    compactionElidedToolResults: compactions.reduce((sum, event) => sum + numberField(event.args, "elided"), 0),
    finalMessageChars: estimateChars(args.result.messages),
    missingToolResults: pairing.missingToolResults,
    fingerprint: pathFingerprint(args.result.trace),
    traceTools,
  };
}

export function summarizeSelfImprovementCase(caseId: string, runs: HaloSelfImprovementRunMetric[]): HaloSelfImprovementCaseSummary {
  const fingerprints = [...new Set(runs.map((run) => run.fingerprint))].sort();
  const unstable = fingerprints.length > 1;
  const maxInvalidToolCalls = Math.max(0, ...runs.map((run) => run.invalidToolCalls));
  const maxMissingToolResults = Math.max(0, ...runs.map((run) => run.missingToolResults));
  const exhaustedRuns = runs.filter((run) => run.exhausted || run.stopReason !== "done").length;
  const totalCompactionEvents = runs.reduce((sum, run) => sum + run.compactionEvents, 0);
  const totalCompactionCharsSaved = runs.reduce((sum, run) => sum + run.compactionCharsSaved, 0);
  const notes: string[] = [];
  if (unstable) notes.push("tool path drifted across repeated runs");
  if (maxInvalidToolCalls > 0) notes.push("one or more runs produced invalid or error tool results");
  if (maxMissingToolResults > 0) notes.push("assistant tool calls were not fully paired with tool results");
  if (exhaustedRuns > 0) notes.push(`${exhaustedRuns} run(s) stopped before done`);
  if (totalCompactionEvents > 0) notes.push("context compaction executed and recorded saved chars");
  return {
    caseId,
    runs: runs.length,
    pass: !unstable && maxInvalidToolCalls === 0 && maxMissingToolResults === 0 && exhaustedRuns === 0,
    uniqueFingerprintCount: fingerprints.length,
    fingerprints,
    p95ModelCalls: percentile(runs.map((run) => run.modelCalls), 0.95),
    p95ToolCalls: percentile(runs.map((run) => run.toolCalls), 0.95),
    maxInvalidToolCalls,
    maxMissingToolResults,
    totalCompactionEvents,
    totalCompactionCharsSaved,
    totalCompactionElidedToolResults: runs.reduce((sum, run) => sum + run.compactionElidedToolResults, 0),
    notes,
  };
}

export function buildHaloSelfImprovementReport(input: {
  generatedAt?: string;
  metrics: HaloSelfImprovementRunMetric[];
}): HaloSelfImprovementReport {
  const byCase = new Map<string, HaloSelfImprovementRunMetric[]>();
  for (const metric of input.metrics) {
    const rows = byCase.get(metric.caseId) ?? [];
    rows.push(metric);
    byCase.set(metric.caseId, rows);
  }
  const cases = [...byCase.entries()].map(([caseId, runs]) => summarizeSelfImprovementCase(caseId, runs));
  const unstableCases = cases.filter((row) => row.uniqueFingerprintCount > 1).map((row) => row.caseId);
  const contextCasesWithCompaction = cases.filter((row) => row.totalCompactionEvents > 0).map((row) => row.caseId);
  return {
    schema: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePattern: "hyperagents-inspired-meta-loop",
    summary: {
      cases: cases.length,
      runs: input.metrics.length,
      pass: cases.every((row) => row.pass) && contextCasesWithCompaction.length > 0,
      unstableCases,
      contextCasesWithCompaction,
    },
    cases,
    proposals: buildHarnessImprovementProposals(cases),
    hyperAgentsDelta: {
      alreadyPresent: [
        "trace/eval store",
        "deterministic HALO gate",
        "root-cause categories",
        "Codex handoff with failing evidence",
        "architecture budget guard",
      ],
      addedByThisGate: [
        "N=5 tool-path fingerprint stability",
        "context compaction savings as a recorded metric",
        "tool-call/result pairing checks",
        "meta-improvement proposals with safety policy",
      ],
      stillMissing: [
        "live-provider parent/variant selection after repeated provider calibration",
        "sandboxed patch application by a meta-agent",
        "deployed Convex job-context quality telemetry export",
      ],
      safetyBoundary: "HALO may propose harness changes, but code edits still go through tests, architecture budget, commit-message path coverage, and human/Codex review; arbitrary model-generated code remains disallowed.",
    },
  };
}

export function buildHaloVariantSelectionReport(input: {
  generatedAt?: string;
  variants: HaloHarnessVariantCandidate[];
}): HaloVariantSelectionReport {
  const summaries = input.variants.map(summarizeVariant);
  const ranked = [...summaries]
    .filter((variant) => variant.pass)
    .sort((a, b) => b.score - a.score || a.p95ToolCalls - b.p95ToolCalls || a.variantId.localeCompare(b.variantId));
  const selected = ranked[0];
  const variants = summaries.map((variant) => ({
    ...variant,
    selected: Boolean(selected && variant.variantId === selected.variantId),
  }));
  const enoughVariants = variants.length >= 2;
  const pass = enoughVariants && Boolean(selected);
  return {
    schema: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePattern: "hyperagents-inspired-meta-loop",
    pass,
    selectedParent: selected?.parentId ?? null,
    selectedVariantId: selected?.variantId ?? null,
    selectionPolicy: {
      minVariants: 2,
      requirePassingVariant: true,
      prefer: [
        "stable tool fingerprint",
        "lower p95 tool calls",
        "lower p95 model calls",
        "zero model-visible coordination calls",
        "zero missing tool results",
      ],
      hardReject: [
        "failing deterministic case",
        "invalid tool result",
        "missing tool result",
        "exhausted or non-done run",
      ],
    },
    variants,
    handoff: {
      implementOnlySelectedVariant: true,
      ...(selected
        ? { selectedSafetyBoundary: input.variants.find((variant) => variant.variantId === selected.variantId)?.safetyBoundary }
        : { blockedReason: enoughVariants ? "no passing variant" : "fewer than two variants" }),
    },
  };
}

export function buildHaloLivePathCalibrationReport(input: {
  generatedAt?: string;
  providerRoute: string;
  caseId: string;
  metrics: HaloSelfImprovementRunMetric[];
  thresholds?: Partial<HaloLivePathCalibrationThresholds>;
}): HaloLivePathCalibrationReport {
  const thresholds: HaloLivePathCalibrationThresholds = {
    minRuns: input.thresholds?.minRuns ?? 5,
    maxUniqueFingerprints: input.thresholds?.maxUniqueFingerprints ?? 3,
    maxP95ToolCalls: input.thresholds?.maxP95ToolCalls ?? 8,
    maxInvalidToolCalls: input.thresholds?.maxInvalidToolCalls ?? 0,
    maxMissingToolResults: input.thresholds?.maxMissingToolResults ?? 0,
  };
  const summary = summarizeSelfImprovementCase(input.caseId, input.metrics);
  const status =
    input.metrics.length < thresholds.minRuns ? "insufficient_runs" :
    summary.uniqueFingerprintCount > thresholds.maxUniqueFingerprints ? "path_unstable" :
    summary.p95ToolCalls > thresholds.maxP95ToolCalls ? "tool_budget_exceeded" :
    summary.maxInvalidToolCalls > thresholds.maxInvalidToolCalls || summary.maxMissingToolResults > thresholds.maxMissingToolResults ? "tool_errors" :
    "calibrated";
  const pass = status === "calibrated";
  return {
    schema: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePattern: "live-provider-path-calibration",
    providerRoute: input.providerRoute,
    status,
    pass,
    thresholds,
    summary: { ...summary, pass },
    metrics: input.metrics,
    recommendation: status === "calibrated"
      ? "This provider/path can be used as a calibrated live path baseline for this case."
      : "Keep this provider/path out of blocking promotion until the recorded threshold failure is addressed.",
  };
}

export function buildHaloConvexJobContextReport(input: {
  generatedAt?: string;
  jobs: HaloConvexJobContextInput[];
}): HaloConvexJobContextReport {
  const jobs = input.jobs.map((job) => {
    const cursor = cursorTelemetry(job.cursor);
    const operationKinds: Record<string, number> = {};
    for (const operation of job.operations) {
      const kind = operation.kind ?? "unknown";
      operationKinds[kind] = (operationKinds[kind] ?? 0) + (operation.countDelta ?? 1);
    }
    const traceTools = job.latestSteps.map((step) => String(step.tool ?? "")).filter(Boolean);
    const checks = {
      attemptsRecorded: job.attempts > 0,
      operationLedgerPresent: job.operations.length > 0,
      modelJournalPresent: job.modelJournalRows > 0,
      cursorCompactionRecorded: cursor.compactionEvents > 0,
      stepHashChainPresent: job.latestSteps.length > 0 && job.latestSteps.every((step) => Boolean(step.recordHash && step.prevStepHash)),
      toolPathPresent: traceTools.length > 0,
    };
    return {
      jobId: job.jobId,
      runtime: job.runtime,
      status: job.status,
      attempts: job.attempts,
      operationKinds,
      modelJournalRows: job.modelJournalRows,
      metricMirror: {
        modelName: job.latestRun?.model ?? "unknown",
        stopReason: job.latestRun?.stopReason ?? "unknown",
        exhausted: Boolean(job.latestRun?.exhausted),
        toolCalls: Number(job.latestRun?.toolCalls ?? traceTools.length),
        compactionEvents: cursor.compactionEvents,
        compactionElidedToolResults: cursor.compactionElidedToolResults,
        fingerprint: traceTools.join(" -> "),
        missingToolResults: cursor.remainingToolCalls,
      },
      checks,
    };
  });
  return {
    schema: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePattern: "convex-job-context-telemetry",
    pass: jobs.length > 0 && jobs.every((job) => Object.values(job.checks).every(Boolean)),
    jobs,
  };
}

export function pathFingerprint(trace: AgentTraceEvent[]): string {
  return trace
    .filter((event) => event.tool !== "compaction")
    .map((event) => event.tool)
    .join(" -> ");
}

function buildHarnessImprovementProposals(cases: HaloSelfImprovementCaseSummary[]): HaloHarnessImprovementProposal[] {
  const proposals: HaloHarnessImprovementProposal[] = [];
  const unstable = cases.filter((row) => row.uniqueFingerprintCount > 1);
  proposals.push({
    id: "halo-path-stability-gate-v1",
    title: "Promote tool-sequence fingerprinting to the HALO gate",
    trigger: unstable.length
      ? `unstable cases detected: ${unstable.map((row) => row.caseId).join(", ")}`
      : "all deterministic N=5 cases have one tool-sequence fingerprint",
    recommendedChange: "Keep path fingerprints, p95 model/tool calls, invalid tool calls, and missing tool-result counts in every HALO run before promoting new harness tools.",
    expectedEval: "npm run halo:self-improve:smoke",
    safetyPolicy: "Advisory metrics may become blocking only for deterministic lanes; live-provider variance remains recorded but non-blocking until thresholds are calibrated.",
    status: "implemented",
  });
  const compaction = cases.filter((row) => row.totalCompactionEvents > 0);
  proposals.push({
    id: "halo-context-quality-gate-v1",
    title: "Track context compaction and stale-read savings",
    trigger: compaction.length
      ? `${compaction.length} case(s) recorded compaction savings`
      : "no context case exercised compaction",
    recommendedChange: "Treat compaction events, saved chars, elided stale reads, and tool-call/result pairing as first-class context-management telemetry.",
    expectedEval: "npm run halo:self-improve:smoke",
    safetyPolicy: "The gate measures context hygiene without changing the model-visible history envelope or deleting audit messages.",
    status: compaction.length ? "implemented" : "candidate",
  });
  proposals.push({
    id: "halo-variant-selection-v1",
    title: "Add explicit harness variant selection before autonomous patching",
    trigger: "HyperAgents-style loops need parent/variant selection; HALO now keeps that selection declarative and eval-gated.",
    recommendedChange: "Compare at least two harness variants over the same case set and write a selectedParent field before asking Codex to implement.",
    expectedEval: "npm run halo:variant:select",
    safetyPolicy: "Variant generation must stay declarative and sandboxed; no model-authored code is executed as product truth.",
    status: "implemented",
  });
  return proposals;
}

function summarizeVariant(candidate: HaloHarnessVariantCandidate): HaloHarnessVariantSummary {
  const summary = summarizeSelfImprovementCase(candidate.variantId, candidate.metrics);
  const totalCoordinationCalls = candidate.metrics.reduce((sum, metric) => sum + metric.modelVisibleCoordinationCalls, 0);
  const rejectionReasons = [
    ...(summary.pass ? [] : summary.notes),
    ...(summary.maxInvalidToolCalls > 0 ? ["invalid tool result"] : []),
    ...(summary.maxMissingToolResults > 0 ? ["missing tool result"] : []),
  ];
  const score = summary.pass
    ? 1_000
      - summary.uniqueFingerprintCount * 25
      - summary.p95ToolCalls * 10
      - summary.p95ModelCalls * 6
      - totalCoordinationCalls * 20
      + Math.min(50, Math.floor(summary.totalCompactionCharsSaved / 1_000))
    : -1_000 - rejectionReasons.length * 100;
  return {
    variantId: candidate.variantId,
    parentId: candidate.parentId,
    description: candidate.description,
    policy: candidate.policy,
    runs: candidate.metrics.length,
    pass: summary.pass,
    selected: false,
    score,
    uniqueFingerprintCount: summary.uniqueFingerprintCount,
    p95ModelCalls: summary.p95ModelCalls,
    p95ToolCalls: summary.p95ToolCalls,
    maxInvalidToolCalls: summary.maxInvalidToolCalls,
    maxMissingToolResults: summary.maxMissingToolResults,
    totalCompactionEvents: summary.totalCompactionEvents,
    totalCompactionCharsSaved: summary.totalCompactionCharsSaved,
    rejectionReasons,
    fingerprints: summary.fingerprints,
  };
}

function cursorTelemetry(cursor: unknown): { compactionEvents: number; compactionElidedToolResults: number; remainingToolCalls: number } {
  if (!cursor || typeof cursor !== "object") return { compactionEvents: 0, compactionElidedToolResults: 0, remainingToolCalls: 0 };
  const value = cursor as Record<string, unknown>;
  const compactionEvents = value.compacted === true ? 1 : 0;
  const compactionElidedToolResults = typeof value.elided === "number" && Number.isFinite(value.elided) ? value.elided : 0;
  const remainingToolCalls = Array.isArray(value.remainingToolCalls) ? value.remainingToolCalls.length : 0;
  return { compactionEvents, compactionElidedToolResults, remainingToolCalls };
}

function toolPairing(messages: AgentMessage[]): { missingToolResults: number } {
  const expected = new Map<string, string>();
  const seen = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) expected.set(call.id, call.tool);
    if (message.role === "tool" && message.toolCallId) seen.add(message.toolCallId);
  }
  let missingToolResults = 0;
  for (const id of expected.keys()) {
    if (!seen.has(id)) missingToolResults++;
  }
  return { missingToolResults };
}

function eventResultHasKey(event: AgentTraceEvent, key: string): boolean {
  return !!event.result && typeof event.result === "object" && key in (event.result as Record<string, unknown>);
}

function compactionSavedChars(event: AgentTraceEvent): number {
  const result = event.result;
  if (!result || typeof result !== "object") return 0;
  const before = numberField(result, "before");
  const after = numberField(result, "after");
  return Math.max(0, before - after);
}

function numberField(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}
