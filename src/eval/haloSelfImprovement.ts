import { estimateChars } from "../agent/compaction";
import type { AgentMessage, AgentResult, AgentTraceEvent } from "../agent/types";

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
        "automatic competing harness variant generation",
        "parent/variant selection across live provider runs",
        "sandboxed patch application by a meta-agent",
        "direct Convex job-context quality telemetry",
      ],
      safetyBoundary: "HALO may propose harness changes, but code edits still go through tests, architecture budget, commit-message path coverage, and human/Codex review; arbitrary model-generated code remains disallowed.",
    },
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
    trigger: "HyperAgents-style loops need parent/variant selection; HALO currently gates known lanes rather than generating alternatives.",
    recommendedChange: "Next update should compare at least two harness variants over the same case set and write a selectedParent field before asking Codex to implement.",
    expectedEval: "future: npm run halo:variant:select",
    safetyPolicy: "Variant generation must stay declarative and sandboxed; no model-authored code is executed as product truth.",
    status: "candidate",
  });
  return proposals;
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
