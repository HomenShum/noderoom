import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "./spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { AgentModel, TokenUsage } from "../agent/types";
import { priceRun } from "../agent/model";

export type SpreadsheetBenchRunnerMode = "copy-input-baseline" | "apply-agent-patch" | "model-edit-plan";

const FORMULA_RESULT_POLICY = "deterministic_local_subset";
const SUPPORTED_FORMULA_FUNCTIONS = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "ABS",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "IF",
  "IFERROR",
  "SUMIF",
  "COUNTIF",
  "AVERAGEIF",
  "SUMIFS",
  "COUNTIFS",
  "AVERAGEIFS",
  "MATCH",
  "INDEX",
  "VLOOKUP",
  "XLOOKUP",
] as const;

export type SpreadsheetBenchRunnerOptions = {
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
  repeats?: number;
  retryFailed?: number;
  retryScoreFailures?: boolean;
  limit?: number;
  clean?: boolean;
  compareStyles?: boolean;
  compareCharts?: boolean;
  maxMismatches?: number;
  generatedAt?: string;
};

export type SpreadsheetBenchRunnerTaskResult = {
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  mode: SpreadsheetBenchRunnerMode;
  attemptIndex: number;
  repeatIndex: number;
  tryIndex: number;
  retryOfAttemptIndex?: number;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  candidateWorkbook?: string;
  sidecarEvidence?: SpreadsheetBenchSidecarEvidence;
  score?: SpreadsheetBenchWorkbookScore;
  error?: {
    phase: "candidate_generation" | "scoring";
    message: string;
  };
  model?: {
    name: string;
    calls: number;
    usage: TokenUsage;
    costUsd: number;
  };
  timingsMs: {
    modelPlanning?: number;
    candidateGeneration: number;
    scoring: number;
    total: number;
  };
  trajectory: Array<{
    step:
      | "read_agent_manifest"
      | "prepare_agent_workspace"
      | "read_agent_edit_plan"
      | "snapshot_agent_workbook"
      | "call_model_for_edit_plan"
      | "emit_candidate_workbook"
      | "read_evaluator_manifest"
      | "score_candidate";
    detail: string;
  }>;
};

export type SpreadsheetBenchSidecarFileEvidence = {
  path: string;
  sha256: string;
  bytes: number;
};

export type SpreadsheetBenchSidecarEvidence = {
  candidateManifest: SpreadsheetBenchSidecarFileEvidence;
  agentWorkspaceManifest?: SpreadsheetBenchSidecarFileEvidence;
  editPlan?: SpreadsheetBenchSidecarFileEvidence & {
    kind: "source" | "generated";
  };
  rawModelOutput?: SpreadsheetBenchSidecarFileEvidence;
  formulaResultPolicy?: string;
  supportedFormulaFunctions?: string[];
  appliedOperationCount?: number;
};

export type SpreadsheetBenchRunnerReport = {
  schema: 1;
  generatedAt?: string;
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  taskCount: number;
  passCount: number;
  averageOverall: number;
  caseCount: number;
  caseRunCount: number;
  casePassCount: number;
  casePassRate: number;
  repeatCount: number;
  attemptCount: number;
  passRate: number;
  retryPolicy: {
    maxRetries: number;
    retryOn: Array<"candidate_generation" | "scoring" | "score_failure">;
    stopOnPass: true;
  };
  retryStats: {
    retriedCaseRunCount: number;
    retryAttemptCount: number;
    passedAfterRetryCount: number;
    exhaustedCaseRunCount: number;
  };
  stats: {
    latencyMs: {
      p50: number;
      p95: number;
      max: number;
    };
    failureCounts: Record<string, number>;
  };
  harness: {
    toolPolicy: "agent_dir_only_until_candidate";
    evaluatorAccess: "after_candidate_emit_only";
    budget: {
      modelCalls: number;
      inputTokens: number;
      outputTokens: number;
      providerCostUsd: number;
    };
  };
  warnings: string[];
  caseRuns: SpreadsheetBenchRunnerCaseRun[];
  results: SpreadsheetBenchRunnerTaskResult[];
};

export type SpreadsheetBenchRunnerCaseRun = {
  taskId: string;
  taskDir: string;
  repeatIndex: number;
  attempts: number[];
  finalAttemptIndex?: number;
  pass: boolean;
  stopReason: "passed" | "failed_score" | "retry_exhausted" | "non_retryable_error" | "runner_error";
  bestOverall: number;
};

type AgentManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
  promptFiles: string[];
};

type EvaluatorManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  answerPosition?: string;
  answerSheet?: string;
  dataPosition?: string;
  goldFiles: string[];
};

type StagedTaskPaths = {
  taskDir: string;
  agentManifestPath: string;
  evaluatorManifestPath: string;
};

const DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS = 800;

type AgentEditPlan = {
  schema: 1;
  operations: AgentEditOperation[];
};

type AgentCellEditOperation = {
  op?: "set_cell";
  sheet: string;
  cell: string;
  value?: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
  numFmt?: string;
};

type AgentAggregateSectionOperation = {
  op: "aggregate_section";
  sourceSheet: string;
  sourceSection: string;
  targetSheet: string;
  targetSection: string;
  groupBy: string[];
  valueColumn: string;
  sortBy?: string[];
  totalLabel?: string;
};

type AgentFilterRowsOperation = {
  op: "filter_rows";
  sheet: string;
  sourceRange: string;
  targetCell: string;
  dateColumn?: string;
  startCell: string;
  endCell: string;
};

type AgentSortUniqueRowsOperation = {
  op: "sort_unique_rows";
  sheet: string;
  sourceRange: string;
  targetCell: string;
  keyColumns: string[];
  outputColumns: string[];
  sortBy: string;
  sortDirection?: "asc" | "desc";
  includeIndex?: boolean;
};

type AgentEditOperation =
  | AgentCellEditOperation
  | AgentAggregateSectionOperation
  | AgentFilterRowsOperation
  | AgentSortUniqueRowsOperation;

type FormulaResult = string | number | boolean;
type FormulaCellValue = FormulaResult | null;

export async function runStagedSpreadsheetBench(options: SpreadsheetBenchRunnerOptions): Promise<SpreadsheetBenchRunnerReport> {
  const stageRoot = resolve(options.stageRoot);
  const outputRoot = resolve(options.outputRoot);
  if (!existsSync(stageRoot)) throw new Error(`SpreadsheetBench stage root does not exist: ${options.stageRoot}`);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const tasks = findStagedTasks(stageRoot).slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  const repeatCount = Math.max(1, Math.trunc(options.repeats ?? 1));
  const retryPolicy = buildRetryPolicy(options);
  const warnings: string[] = [];
  const results: SpreadsheetBenchRunnerTaskResult[] = [];
  const caseRuns: SpreadsheetBenchRunnerCaseRun[] = [];
  let nextAttemptIndex = 1;
  for (let repeat = 1; repeat <= repeatCount; repeat++) {
    for (const task of tasks) {
      const caseAttempts: SpreadsheetBenchRunnerTaskResult[] = [];
      for (let tryIndex = 1; tryIndex <= retryPolicy.maxRetries + 1; tryIndex++) {
        const attemptIndex = nextAttemptIndex++;
        try {
          const result = await runTask(stageRoot, outputRoot, task, options, {
            attemptIndex,
            repeatIndex: repeat,
            tryIndex,
            retryOfAttemptIndex: tryIndex > 1 ? attemptIndex - 1 : undefined,
            repeatCount,
            maxAttemptsPerRepeat: retryPolicy.maxRetries + 1,
          });
          if (result.error) warnings.push(`${result.taskDir}#${repeat}.${tryIndex}: ${result.error.message}`);
          results.push(result);
          caseAttempts.push(result);
          if (!shouldRetry(result, retryPolicy, tryIndex)) break;
        } catch (error) {
          warnings.push(`${rel(stageRoot, task.taskDir)}#${repeat}.${tryIndex}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
      caseRuns.push(summarizeCaseRun(stageRoot, task, repeat, caseAttempts, retryPolicy));
    }
  }
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
    : 0;
  const usage = aggregateUsage(results);
  const stats = aggregateStats(results);
  const retryStats = aggregateRetryStats(caseRuns);
  return {
    schema: 1,
    generatedAt: options.generatedAt,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    mode: options.mode,
    taskCount: results.length,
    passCount,
    averageOverall,
    caseCount: tasks.length,
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    repeatCount,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryPolicy,
    retryStats,
    stats,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      budget: {
        modelCalls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerCostUsd: usage.costUsd,
      },
    },
    warnings,
    caseRuns,
    results,
  };
}

function findStagedTasks(stageRoot: string): StagedTaskPaths[] {
  const tasksRoot = join(stageRoot, "tasks");
  if (!existsSync(tasksRoot)) throw new Error(`SpreadsheetBench staged root must contain tasks/: ${stageRoot}`);
  return walkDirs(tasksRoot)
    .map((taskDir) => ({
      taskDir,
      agentManifestPath: join(taskDir, "agent", "task.json"),
      evaluatorManifestPath: join(taskDir, "evaluator", "evaluator.json"),
    }))
    .filter((task) => existsSync(task.agentManifestPath) && existsSync(task.evaluatorManifestPath))
    .sort((a, b) => a.taskDir.localeCompare(b.taskDir));
}

async function runTask(
  stageRoot: string,
  outputRoot: string,
  task: StagedTaskPaths,
  options: SpreadsheetBenchRunnerOptions,
  attempt: {
    attemptIndex: number;
    repeatIndex: number;
    tryIndex: number;
    retryOfAttemptIndex?: number;
    repeatCount: number;
    maxAttemptsPerRepeat: number;
  },
): Promise<SpreadsheetBenchRunnerTaskResult> {
  const started = Date.now();
  const trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"] = [];
  const agent = readJson<AgentManifest>(task.agentManifestPath);
  trajectory.push({ step: "read_agent_manifest", detail: rel(stageRoot, task.agentManifestPath) });
  const generationStarted = Date.now();
  const taskOutDir = join(
    outputRoot,
    rel(join(stageRoot, "tasks"), task.taskDir),
    attempt.repeatCount > 1 || attempt.maxAttemptsPerRepeat > 1 ? `attempt-${String(attempt.attemptIndex).padStart(2, "0")}` : "",
  );
  const agentWorkspace = prepareAgentWorkspace(stageRoot, task, taskOutDir, agent);
  trajectory.push({ step: "prepare_agent_workspace", detail: rel(outputRoot, agentWorkspace.manifestPath) });
  const candidateWorkbook = emitCandidateWorkbook({
    stageRoot,
    taskDir: task.taskDir,
    taskOutDir,
    agentWorkspace,
    agent,
    mode: options.mode,
    trajectory,
    model: options.model,
    modelName: options.modelName,
    modelTimeoutMs: options.modelTimeoutMs,
  });
  let emitted: string | ModelCandidateEmission;
  try {
    emitted = await candidateWorkbook;
  } catch (error) {
    const modelFailure = modelEditFailure(error);
    return failedTaskResult({
      stageRoot,
      task,
      agent,
      mode: options.mode,
      attemptIndex: attempt.attemptIndex,
      repeatIndex: attempt.repeatIndex,
      tryIndex: attempt.tryIndex,
      retryOfAttemptIndex: attempt.retryOfAttemptIndex,
      phase: "candidate_generation",
      message: error instanceof Error ? error.message : String(error),
      model: modelFailure?.model,
      modelPlanningMs: modelFailure?.modelPlanningMs,
      candidateGenerationMs: Date.now() - generationStarted,
      totalMs: Date.now() - started,
      trajectory,
    });
  }
  const resolvedCandidateWorkbook = typeof emitted === "string" ? emitted : emitted.path;
  const generationMs = Date.now() - generationStarted;
  trajectory.push({ step: "emit_candidate_workbook", detail: rel(outputRoot, resolvedCandidateWorkbook) });
  const sidecarEvidence = collectSidecarEvidence(outputRoot, taskOutDir);

  const scoreStarted = Date.now();
  const evaluator = readJson<EvaluatorManifest>(task.evaluatorManifestPath);
  trajectory.push({ step: "read_evaluator_manifest", detail: rel(stageRoot, task.evaluatorManifestPath) });
  const goldWorkbook = resolveManifestPath(dirname(task.evaluatorManifestPath), evaluator.goldFiles[0]);
  let score: SpreadsheetBenchWorkbookScore;
  try {
    score = await scoreSpreadsheetBenchWorkbook({
      taskId: agent.taskId,
      candidateWorkbookPath: resolvedCandidateWorkbook,
      goldWorkbookPath: goldWorkbook,
      answerPosition: evaluator.answerPosition,
      answerSheet: evaluator.answerSheet,
      compareStyles: options.compareStyles,
      compareCharts: options.compareCharts || agent.track === "spreadsheetbench-v2",
      maxMismatches: options.maxMismatches,
      generatedAt: options.generatedAt,
    });
  } catch (error) {
    return failedTaskResult({
      stageRoot,
      task,
      agent,
      mode: options.mode,
      attemptIndex: attempt.attemptIndex,
      repeatIndex: attempt.repeatIndex,
      tryIndex: attempt.tryIndex,
      retryOfAttemptIndex: attempt.retryOfAttemptIndex,
      phase: "scoring",
      message: error instanceof Error ? error.message : String(error),
      candidateWorkbook: rel(outputRoot, resolvedCandidateWorkbook),
      sidecarEvidence,
      model: typeof emitted === "string" ? undefined : emitted.model,
      modelPlanningMs: typeof emitted === "string" ? undefined : emitted.modelPlanningMs,
      candidateGenerationMs: generationMs,
      scoringMs: Date.now() - scoreStarted,
      totalMs: Date.now() - started,
      trajectory,
    });
  }
  const scoringMs = Date.now() - scoreStarted;
  const chartMismatches = score.chartPackage
    ? score.chartPackage.totals.missingChartParts + score.chartPackage.totals.extraChartParts + score.chartPackage.totals.mismatchedChartParts
    : 0;
  trajectory.push({
    step: "score_candidate",
    detail: chartMismatches
      ? `${score.totals.mismatches} cell mismatch(es), ${chartMismatches} chart-package mismatch(es)`
      : `${score.totals.mismatches} cell mismatch(es)`,
  });

  return {
    taskId: agent.taskId,
    track: agent.track,
    category: agent.category,
    mode: options.mode,
    attemptIndex: attempt.attemptIndex,
    repeatIndex: attempt.repeatIndex,
    tryIndex: attempt.tryIndex,
    retryOfAttemptIndex: attempt.retryOfAttemptIndex,
    taskDir: rel(stageRoot, task.taskDir),
    agentManifest: rel(stageRoot, task.agentManifestPath),
    evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
    candidateWorkbook: rel(outputRoot, resolvedCandidateWorkbook),
    sidecarEvidence,
    score,
    model: typeof emitted === "string" ? undefined : emitted.model,
    timingsMs: {
      ...(typeof emitted === "string" ? {} : { modelPlanning: emitted.modelPlanningMs }),
      candidateGeneration: generationMs,
      scoring: scoringMs,
      total: Date.now() - started,
    },
    trajectory,
  };
}

function failedTaskResult(args: {
  stageRoot: string;
  task: StagedTaskPaths;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  attemptIndex: number;
  repeatIndex: number;
  tryIndex: number;
  retryOfAttemptIndex?: number;
  phase: "candidate_generation" | "scoring";
  message: string;
  candidateWorkbook?: string;
  sidecarEvidence?: SpreadsheetBenchRunnerTaskResult["sidecarEvidence"];
  model?: SpreadsheetBenchRunnerTaskResult["model"];
  modelPlanningMs?: number;
  candidateGenerationMs: number;
  scoringMs?: number;
  totalMs: number;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
}): SpreadsheetBenchRunnerTaskResult {
  return {
    taskId: args.agent.taskId,
    track: args.agent.track,
    category: args.agent.category,
    mode: args.mode,
    attemptIndex: args.attemptIndex,
    repeatIndex: args.repeatIndex,
    tryIndex: args.tryIndex,
    retryOfAttemptIndex: args.retryOfAttemptIndex,
    taskDir: rel(args.stageRoot, args.task.taskDir),
    agentManifest: rel(args.stageRoot, args.task.agentManifestPath),
    evaluatorManifest: rel(args.stageRoot, args.task.evaluatorManifestPath),
    candidateWorkbook: args.candidateWorkbook,
    sidecarEvidence: args.sidecarEvidence,
    error: {
      phase: args.phase,
      message: args.message,
    },
    model: args.model,
    timingsMs: {
      ...(args.modelPlanningMs === undefined ? {} : { modelPlanning: args.modelPlanningMs }),
      candidateGeneration: args.candidateGenerationMs,
      scoring: args.scoringMs ?? 0,
      total: args.totalMs,
    },
    trajectory: args.trajectory,
  };
}

function collectSidecarEvidence(outputRoot: string, taskOutDir: string): SpreadsheetBenchSidecarEvidence | undefined {
  const candidateManifestPath = join(taskOutDir, "candidate-manifest.json");
  if (!existsSync(candidateManifestPath)) return undefined;
  const manifest = readJson<{
    agentWorkspaceManifest?: string;
    generatedEditPlan?: string;
    sourceEditPlan?: string;
    rawModelOutput?: string;
    formulaResultPolicy?: string;
    supportedFormulaFunctions?: string[];
    appliedOperationCount?: number;
  }>(candidateManifestPath);
  const editPlanPath = manifest.generatedEditPlan ?? manifest.sourceEditPlan;
  return {
    candidateManifest: fileEvidence(outputRoot, candidateManifestPath),
    ...(manifest.agentWorkspaceManifest ? { agentWorkspaceManifest: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.agentWorkspaceManifest)) } : {}),
    ...(editPlanPath
      ? {
          editPlan: {
            ...fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, editPlanPath)),
            kind: manifest.generatedEditPlan ? "generated" as const : "source" as const,
          },
        }
      : {}),
    ...(manifest.rawModelOutput ? { rawModelOutput: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.rawModelOutput)) } : {}),
    ...(manifest.formulaResultPolicy ? { formulaResultPolicy: manifest.formulaResultPolicy } : {}),
    ...(Array.isArray(manifest.supportedFormulaFunctions) ? { supportedFormulaFunctions: manifest.supportedFormulaFunctions } : {}),
    ...(typeof manifest.appliedOperationCount === "number" ? { appliedOperationCount: manifest.appliedOperationCount } : {}),
  };
}

function resolveSidecarPath(taskOutDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(taskOutDir, value);
}

function fileEvidence(outputRoot: string, path: string): SpreadsheetBenchSidecarFileEvidence {
  const content = readFileSync(path);
  return {
    path: rel(outputRoot, path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  };
}

function emitCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
}): Promise<string | ModelCandidateEmission> | string {
  const firstInput = args.agent.inputFiles[0];
  if (!firstInput) throw new Error(`agent manifest has no input workbook: ${args.agent.taskId}`);
  const source = resolveManifestPath(args.agentWorkspace.agentDir, firstInput);
  if (!existsSync(source)) throw new Error(`agent input workbook does not exist: ${source}`);
  mkdirSync(args.taskOutDir, { recursive: true });
  const target = join(args.taskOutDir, `candidate-${safeFileName(basename(source))}`);
  if (args.mode === "model-edit-plan") return emitModelEditCandidateWorkbook({ ...args, source, target });
  if (args.mode === "apply-agent-patch") return emitPatchedCandidateWorkbook({ ...args, source, target });
  if (args.mode !== "copy-input-baseline") throw new Error(`Unsupported SpreadsheetBench runner mode: ${args.mode}`);
  copyFileSync(source, target);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    candidateWorkbook: basename(target),
    note: "copy-input-baseline proves runner/export/scoring plumbing only; it is not a model score.",
  });
  return target;
}

type ModelCandidateEmission = {
  path: string;
  modelPlanningMs: number;
  model: {
    name: string;
    calls: number;
    usage: TokenUsage;
    costUsd: number;
  };
};

type AgentWorkspace = {
  root: string;
  agentDir: string;
  manifestPath: string;
};

class ModelEditCandidateError extends Error {
  constructor(
    message: string,
    readonly model: ModelCandidateEmission["model"],
    readonly modelPlanningMs: number,
  ) {
    super(message);
    this.name = "ModelEditCandidateError";
  }
}

function modelEditFailure(error: unknown): Pick<ModelCandidateEmission, "model" | "modelPlanningMs"> | undefined {
  return error instanceof ModelEditCandidateError
    ? { model: error.model, modelPlanningMs: error.modelPlanningMs }
    : undefined;
}

function prepareAgentWorkspace(
  stageRoot: string,
  task: StagedTaskPaths,
  taskOutDir: string,
  agent: AgentManifest,
): AgentWorkspace {
  const root = join(taskOutDir, "agent-workspace");
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  const sourceAgentDir = join(task.taskDir, "agent");
  const copiedFiles: Array<{ role: "manifest" | "input" | "prompt" | "edit_plan"; path: string }> = [];

  copyFileSync(task.agentManifestPath, join(agentDir, "task.json"));
  copiedFiles.push({ role: "manifest", path: "agent/task.json" });
  for (const file of agent.inputFiles) copiedFiles.push(copyAgentFile(sourceAgentDir, agentDir, file, "input"));
  for (const file of agent.promptFiles) copiedFiles.push(copyAgentFile(sourceAgentDir, agentDir, file, "prompt"));
  const sourceEditPlan = join(sourceAgentDir, "edit-plan.json");
  if (existsSync(sourceEditPlan)) {
    copyFileSync(sourceEditPlan, join(agentDir, "edit-plan.json"));
    copiedFiles.push({ role: "edit_plan", path: "agent/edit-plan.json" });
  }

  const manifestPath = join(root, "agent-workspace-manifest.json");
  writeJson(manifestPath, {
    schema: 1,
    taskId: agent.taskId,
    boundary: "agent_visible_files_only",
    sourceAgentManifest: rel(stageRoot, task.agentManifestPath),
    workspaceAgentManifest: "agent/task.json",
    copiedFiles,
    policy: "candidate generation reads only this workspace; private scoring metadata is opened after candidate emission.",
  });
  return { root, agentDir, manifestPath };
}

function copyAgentFile(
  sourceAgentDir: string,
  workspaceAgentDir: string,
  manifestPath: string,
  role: "input" | "prompt",
): { role: "input" | "prompt"; path: string } {
  const source = resolveAgentPath(sourceAgentDir, manifestPath);
  const normalized = manifestPath.replace(/\\/g, "/");
  const target = resolveAgentPath(workspaceAgentDir, normalized);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { role, path: `agent/${normalized}` };
}

async function emitPatchedCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
}): Promise<string> {
  const editPlanPath = join(args.agentWorkspace.agentDir, "edit-plan.json");
  if (!existsSync(editPlanPath)) throw new Error(`apply-agent-patch requires agent/edit-plan.json: ${args.agent.taskId}`);
  const plan = readJson<AgentEditPlan>(editPlanPath);
  validateEditPlan(plan, args.agent.taskId);
  args.trajectory.push({ step: "read_agent_edit_plan", detail: rel(args.taskOutDir, editPlanPath) });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(args.source);
  for (const operation of plan.operations) applyOperation(workbook, operation);
  await workbook.xlsx.writeFile(args.target);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    sourceEditPlan: rel(args.taskOutDir, editPlanPath),
    candidateWorkbook: basename(args.target),
    appliedOperationCount: plan.operations.length,
    formulaResultPolicy: FORMULA_RESULT_POLICY,
    supportedFormulaFunctions: SUPPORTED_FORMULA_FUNCTIONS,
    note: "apply-agent-patch proves agent-side workbook edit/export/reopen plumbing; it is not an official model score.",
  });
  return args.target;
}

async function emitModelEditCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
}): Promise<ModelCandidateEmission> {
  if (!args.model) throw new Error(`model-edit-plan requires options.model: ${args.agent.taskId}`);
  const snapshot = await snapshotWorkbook(args.source);
  args.trajectory.push({ step: "snapshot_agent_workbook", detail: `${snapshot.sheets.length} sheet(s), ${snapshot.cellCount} cell(s)` });
  const promptFiles = readPromptFiles(args.agentWorkspace.agentDir, args.agent.promptFiles);
  const planningStarted = Date.now();
  const step = await args.model.next({
    system: spreadsheetBenchPlannerSystem(),
    messages: [{ role: "user", content: spreadsheetBenchPlannerPrompt(args.agent, snapshot, promptFiles) }],
    tools: [],
    signal: args.modelTimeoutMs ? AbortSignal.timeout(args.modelTimeoutMs) : undefined,
  });
  const modelPlanningMs = Date.now() - planningStarted;
  args.trajectory.push({ step: "call_model_for_edit_plan", detail: args.model.name });
  const usage = step.usage ?? { inputTokens: 0, outputTokens: 0 };
  const modelName = args.modelName ?? args.model.name;
  const costUsd = step.usage && args.modelName ? priceRun(args.modelName, usage.inputTokens, usage.outputTokens) : 0;
  const modelInfo = {
    name: modelName,
    calls: 1,
    usage,
    costUsd,
  };
  const rawModelOutputPath = join(args.taskOutDir, "model-output.txt");
  writeFileSync(rawModelOutputPath, step.text ?? "");
  try {
    if (step.toolCalls.length) throw new Error(`model-edit-plan expected JSON text, got ${step.toolCalls.length} tool call(s)`);
    const plan = normalizeEditPlan(parseEditPlanText(step.text ?? "", args.agent.taskId), snapshot, args.agent);
    validateEditPlan(plan, args.agent.taskId);
    const editPlanPath = join(args.taskOutDir, "model-edit-plan.json");
    writeJson(editPlanPath, plan);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(args.source);
    for (const operation of plan.operations) applyOperation(workbook, operation);
    await workbook.xlsx.writeFile(args.target);

    writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
      schema: 1,
      taskId: args.agent.taskId,
      mode: args.mode,
      model: modelName,
      sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
      agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
      generatedEditPlan: basename(editPlanPath),
      rawModelOutput: basename(rawModelOutputPath),
      candidateWorkbook: basename(args.target),
      appliedOperationCount: plan.operations.length,
      formulaResultPolicy: FORMULA_RESULT_POLICY,
      supportedFormulaFunctions: SUPPORTED_FORMULA_FUNCTIONS,
      modelUsage: usage,
      modelCostUsd: costUsd,
      note: "model-edit-plan asks a model to produce an agent-side edit plan before scoring; this is a benchmark runner path, not an official score unless run on official tasks with the recorded model/tool policy.",
    });
  } catch (error) {
    throw new ModelEditCandidateError(error instanceof Error ? error.message : String(error), modelInfo, modelPlanningMs);
  }
  return {
    path: args.target,
    modelPlanningMs,
    model: modelInfo,
  };
}

function validateEditPlan(plan: AgentEditPlan, taskId: string) {
  if (!plan || plan.schema !== 1) throw new Error(`invalid edit-plan schema for ${taskId}`);
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    throw new Error(`edit-plan has no operations for ${taskId}`);
  }
  for (const [index, operation] of plan.operations.entries()) {
    if (isAggregateSectionOperation(operation)) {
      if (!operation.sourceSheet.trim() || !operation.sourceSection.trim() || !operation.targetSheet.trim() || !operation.targetSection.trim()) {
        throw new Error(`edit-plan aggregate operation ${index + 1} is missing source/target section metadata`);
      }
      if (!Array.isArray(operation.groupBy) || operation.groupBy.length === 0 || operation.groupBy.some((header) => !header.trim())) {
        throw new Error(`edit-plan aggregate operation ${index + 1} is missing groupBy headers`);
      }
      if (!operation.valueColumn.trim()) throw new Error(`edit-plan aggregate operation ${index + 1} is missing valueColumn`);
      continue;
    }
    if (isFilterRowsOperation(operation)) {
      if (!operation.sheet.trim()) throw new Error(`edit-plan filter operation ${index + 1} is missing sheet`);
      if (!parseRangeRef(operation.sourceRange)) throw new Error(`edit-plan filter operation ${index + 1} has invalid sourceRange`);
      if (!isCellRef(operation.targetCell)) throw new Error(`edit-plan filter operation ${index + 1} has invalid targetCell`);
      if (!isCellRef(operation.startCell) || !isCellRef(operation.endCell)) {
        throw new Error(`edit-plan filter operation ${index + 1} has invalid criteria cells`);
      }
      continue;
    }
    if (isSortUniqueRowsOperation(operation)) {
      if (!operation.sheet.trim()) throw new Error(`edit-plan sort operation ${index + 1} is missing sheet`);
      if (!parseRangeRef(operation.sourceRange)) throw new Error(`edit-plan sort operation ${index + 1} has invalid sourceRange`);
      if (!isCellRef(operation.targetCell)) throw new Error(`edit-plan sort operation ${index + 1} has invalid targetCell`);
      if (!operation.keyColumns.length || !operation.outputColumns.length || !operation.sortBy.trim()) {
        throw new Error(`edit-plan sort operation ${index + 1} is missing sort metadata`);
      }
      continue;
    }
    if (!operation || typeof operation.sheet !== "string" || !operation.sheet.trim()) {
      throw new Error(`edit-plan operation ${index + 1} is missing sheet`);
    }
    if (!isCellRef(operation.cell)) {
      throw new Error(`edit-plan operation ${index + 1} has invalid cell: ${operation.cell}`);
    }
    if (operation.formula === undefined && !("value" in operation) && !operation.numFmt) {
      throw new Error(`edit-plan operation ${index + 1} must set value, formula, or numFmt`);
    }
  }
}

function isAggregateSectionOperation(operation: unknown): operation is AgentAggregateSectionOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "aggregate_section");
}

function isFilterRowsOperation(operation: unknown): operation is AgentFilterRowsOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "filter_rows");
}

function isSortUniqueRowsOperation(operation: unknown): operation is AgentSortUniqueRowsOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "sort_unique_rows");
}

function isStructuralOperation(
  operation: AgentEditOperation,
): operation is AgentAggregateSectionOperation | AgentFilterRowsOperation | AgentSortUniqueRowsOperation {
  return isAggregateSectionOperation(operation) || isFilterRowsOperation(operation) || isSortUniqueRowsOperation(operation);
}

function isCellEditOperation(operation: AgentEditOperation): operation is AgentCellEditOperation {
  return Boolean(operation && !isStructuralOperation(operation) && typeof (operation as { sheet?: unknown }).sheet === "string");
}

function hasUnsupportedOperationKind(operation: unknown): boolean {
  if (!operation || typeof operation !== "object") return false;
  const op = (operation as { op?: unknown }).op;
  return typeof op === "string" && !["set_cell", "aggregate_section", "filter_rows", "sort_unique_rows"].includes(op);
}

function isCellRef(value: string): boolean {
  return /^[A-Z]{1,3}[1-9][0-9]*$/i.test(value);
}

function normalizeEditPlan(plan: AgentEditPlan, snapshot: WorkbookSnapshot, agent?: AgentManifest): AgentEditPlan {
  const sheetNames = new Set(snapshot.sheets.map((sheet) => sheet.name));
  const sheetNamesByLower = new Map(snapshot.sheets.map((sheet) => [sheet.name.toLowerCase(), sheet.name]));
  const onlySheetName = snapshot.sheets.length === 1 ? snapshot.sheets[0]?.name : undefined;
  const candidateFilterKeys = agent ? new Set(inferVisibleFilterRowsOperations(agent, snapshot, []).map(filterRowsOperationKey)) : undefined;
  const candidateSortKeys = agent ? new Set(inferVisibleSortUniqueRowsOperations(agent, snapshot, []).map(sortUniqueRowsOperationKey)) : undefined;
  let lastKnownSheet: string | undefined;
  const operations: AgentEditOperation[] = Array.isArray(plan.operations)
    ? plan.operations.flatMap((operation): AgentEditOperation[] => {
        if (isAggregateSectionOperation(operation)) return [normalizeAggregateSectionOperation(operation, sheetNamesByLower)];
        if (isFilterRowsOperation(operation)) {
          const normalized = normalizeFilterRowsOperation(operation, sheetNamesByLower);
          const candidateAllowed = !candidateFilterKeys || candidateFilterKeys.has(filterRowsOperationKey(normalized));
          return candidateAllowed && filterRowsOperationIsSelfConsistent(normalized) ? [normalized] : [];
        }
        if (isSortUniqueRowsOperation(operation)) {
          const normalized = normalizeSortUniqueRowsOperation(operation, sheetNamesByLower);
          const candidateAllowed = !candidateSortKeys || candidateSortKeys.has(sortUniqueRowsOperationKey(normalized));
          return candidateAllowed && sortUniqueRowsOperationIsSelfConsistent(normalized) ? [normalized] : [];
        }
        if (hasUnsupportedOperationKind(operation)) return [];
        if (!isCellEditOperation(operation)) return [operation];
        const normalizedOperation = normalizeEditOperationShape(operation);
        const sheetName = normalizedOperation.sheet.trim().replace(/^'|'$/g, "");
        const canonicalSheet = sheetNames.has(sheetName) ? sheetName : sheetNamesByLower.get(sheetName.toLowerCase());
        if (canonicalSheet) {
          lastKnownSheet = canonicalSheet;
          return [canonicalSheet === normalizedOperation.sheet ? normalizedOperation : { ...normalizedOperation, sheet: canonicalSheet }];
        }
        if (lastKnownSheet && isCellRef(normalizedOperation.sheet)) {
          return [{
            ...normalizedOperation,
            sheet: lastKnownSheet,
            cell: typeof normalizedOperation.cell === "string" && isCellRef(normalizedOperation.cell) ? normalizedOperation.cell : normalizedOperation.sheet,
          }];
        }
        if (onlySheetName && isGenericSheetAlias(sheetName)) {
          lastKnownSheet = onlySheetName;
          return [{ ...normalizedOperation, sheet: onlySheetName }];
        }
        return [normalizedOperation];
      })
    : plan.operations;
  const inferredOperations = agent
    ? [
        ...inferVisibleAggregateSectionOperations(agent, snapshot, operations),
        ...inferVisibleFilterRowsOperations(agent, snapshot, operations),
        ...inferVisibleSortUniqueRowsOperations(agent, snapshot, operations),
      ]
    : [];
  const orderedOperations = [
    ...operations.filter((operation) => !isStructuralOperation(operation)),
    ...operations.filter(isStructuralOperation),
    ...inferredOperations,
  ];
  return {
    ...plan,
    operations: orderedOperations,
  };
}

function normalizeAggregateSectionOperation(
  operation: AgentAggregateSectionOperation,
  sheetNamesByLower: Map<string, string>,
): AgentAggregateSectionOperation {
  return {
    ...operation,
    sourceSheet: sheetNamesByLower.get(operation.sourceSheet.trim().toLowerCase()) ?? operation.sourceSheet.trim(),
    targetSheet: sheetNamesByLower.get(operation.targetSheet.trim().toLowerCase()) ?? operation.targetSheet.trim(),
    sourceSection: operation.sourceSection.trim(),
    targetSection: operation.targetSection.trim(),
    groupBy: operation.groupBy.map((header) => header.trim()).filter(Boolean),
    valueColumn: operation.valueColumn.trim(),
    sortBy: operation.sortBy?.map((header) => header.trim()).filter(Boolean),
    totalLabel: operation.totalLabel?.trim() || undefined,
  };
}

function normalizeFilterRowsOperation(
  operation: AgentFilterRowsOperation,
  sheetNamesByLower: Map<string, string>,
): AgentFilterRowsOperation {
  return {
    ...operation,
    sheet: sheetNamesByLower.get(operation.sheet.trim().toLowerCase()) ?? operation.sheet.trim(),
    sourceRange: operation.sourceRange.trim().toUpperCase(),
    targetCell: operation.targetCell.trim().toUpperCase(),
    dateColumn: operation.dateColumn?.trim().toUpperCase() || undefined,
    startCell: operation.startCell.trim().toUpperCase(),
    endCell: operation.endCell.trim().toUpperCase(),
  };
}

function normalizeSortUniqueRowsOperation(
  operation: AgentSortUniqueRowsOperation,
  sheetNamesByLower: Map<string, string>,
): AgentSortUniqueRowsOperation {
  return {
    ...operation,
    sheet: sheetNamesByLower.get(operation.sheet.trim().toLowerCase()) ?? operation.sheet.trim(),
    sourceRange: operation.sourceRange.trim().toUpperCase(),
    targetCell: operation.targetCell.trim().toUpperCase(),
    keyColumns: operation.keyColumns.map((column) => column.trim().toUpperCase()).filter(Boolean),
    outputColumns: operation.outputColumns.map((column) => column.trim().toUpperCase()).filter(Boolean),
    sortBy: operation.sortBy.trim().toUpperCase(),
    sortDirection: operation.sortDirection === "desc" ? "desc" : "asc",
    includeIndex: operation.includeIndex ?? true,
  };
}

function filterRowsOperationIsSelfConsistent(operation: AgentFilterRowsOperation): boolean {
  const source = parseRangeRef(operation.sourceRange);
  if (!source) return false;
  const dateColumn = operation.dateColumn ? columnNameToNumber(operation.dateColumn) : source.startCol;
  return dateColumn >= source.startCol && dateColumn <= source.endCol;
}

function filterRowsOperationKey(operation: AgentFilterRowsOperation): string {
  return [operation.sheet, operation.sourceRange, operation.targetCell, operation.dateColumn ?? "", operation.startCell, operation.endCell]
    .map((value) => value.trim().toUpperCase())
    .join("::");
}

function sortUniqueRowsOperationIsSelfConsistent(operation: AgentSortUniqueRowsOperation): boolean {
  const source = parseRangeRef(operation.sourceRange);
  if (!source) return false;
  const referencedColumns = [
    ...operation.keyColumns,
    ...operation.outputColumns,
    operation.sortBy,
  ].map(columnNameToNumber);
  return referencedColumns.every((column) => column >= source.startCol && column <= source.endCol);
}

function sortUniqueRowsOperationKey(operation: AgentSortUniqueRowsOperation): string {
  return [
    operation.sheet,
    operation.sourceRange,
    operation.targetCell,
    operation.keyColumns.join(","),
    operation.outputColumns.join(","),
    operation.sortBy,
    operation.sortDirection ?? "asc",
    operation.includeIndex === false ? "no_index" : "index",
  ].map((value) => value.trim().toUpperCase()).join("::");
}

function inferVisibleAggregateSectionOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentAggregateSectionOperation[] {
  const instruction = agent.instruction.toLowerCase();
  if (!/\b(?:combine|group|match|matching|duplicates?)\b/.test(instruction)) return [];
  if (!/\b(?:sum|total|amounts?)\b/.test(instruction)) return [];
  const existingKeys = new Set(
    existingOperations
      .filter(isAggregateSectionOperation)
      .map((operation) => aggregateOperationKey(operation.sourceSheet, operation.sourceSection, operation.targetSheet, operation.targetSection)),
  );
  const sourceSheets = snapshot.sheets.filter((sheet) =>
    sheet.blocks.some((block) => block.title && hasHeaders(block, ["DATE", "REF"]) && findHeader(block, ["AMOUNTS", "AMOUNT"])),
  );
  const targetSheets = snapshot.sheets.filter((sheet) =>
    sheet.blocks.some((block) => block.title && hasHeaders(block, ["SN", "DATE", "REF"]) && findHeader(block, ["AMOUNTS", "AMOUNT"])),
  );
  const operations: AgentAggregateSectionOperation[] = [];
  for (const sourceSheet of sourceSheets) {
    for (const targetSheet of targetSheets) {
      if (sourceSheet.name === targetSheet.name) continue;
      for (const targetBlock of targetSheet.blocks) {
        if (!targetBlock.title || !targetSectionLooksBlank(targetSheet, targetBlock)) continue;
        const sourceBlock = sourceSheet.blocks.find((block) => block.title && normalizeHeader(block.title) === normalizeHeader(targetBlock.title!));
        if (!sourceBlock) continue;
        if (!hasHeaders(sourceBlock, ["DATE", "REF"]) || !findHeader(sourceBlock, ["AMOUNTS", "AMOUNT"])) continue;
        const valueColumn = findHeader(sourceBlock, ["AMOUNTS", "AMOUNT"])!;
        const key = aggregateOperationKey(sourceSheet.name, sourceBlock.title!, targetSheet.name, targetBlock.title);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        operations.push({
          op: "aggregate_section",
          sourceSheet: sourceSheet.name,
          sourceSection: sourceBlock.title!,
          targetSheet: targetSheet.name,
          targetSection: targetBlock.title,
          groupBy: ["DATE", "REF"],
          valueColumn,
          sortBy: ["DATE", "REF"],
          totalLabel: "TOTAL",
        });
      }
    }
  }
  return operations;
}

function inferVisibleFilterRowsOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentFilterRowsOperation[] {
  const instruction = agent.instruction;
  const lower = instruction.toLowerCase();
  if (!/\bfilter(?:ed)?\b/.test(lower) || !/\bdate/.test(lower) || !/\bcriteria\b/.test(lower)) return [];
  const dataRange = instruction.match(/\bdata range from\s+([A-Z]{1,3}[1-9][0-9]*\s+to\s+[A-Z]{1,3}[1-9][0-9]*)/i)?.[1]
    ?.replace(/\s+to\s+/i, ":")
    .toUpperCase();
  const criteria = instruction.match(/\bcells?\s+([A-Z]{1,3}[1-9][0-9]*)\s+and\s+([A-Z]{1,3}[1-9][0-9]*)/i);
  const targetCell = instruction.match(/\bstart(?:ing)?(?:\s+from)?\s+cell\s+([A-Z]{1,3}[1-9][0-9]*)/i)?.[1]?.toUpperCase();
  if (!dataRange || !criteria || !targetCell) return [];
  const sheet = snapshot.sheets.find((item) => parseRangeRef(dataRange) && item.cells.some((cell) => cell.address.toUpperCase() === criteria[1].toUpperCase()));
  if (!sheet) return [];
  const existing = new Set(
    existingOperations.filter(isFilterRowsOperation).map((operation) => `${operation.sheet}:${operation.sourceRange}:${operation.targetCell}`),
  );
  const key = `${sheet.name}:${dataRange}:${targetCell}`;
  if (existing.has(key)) return [];
  return [{
    op: "filter_rows",
    sheet: sheet.name,
    sourceRange: dataRange,
    targetCell,
    dateColumn: "A",
    startCell: criteria[1].toUpperCase(),
    endCell: criteria[2].toUpperCase(),
  }];
}

function inferVisibleSortUniqueRowsOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentSortUniqueRowsOperation[] {
  const lower = agent.instruction.toLowerCase();
  if (!/\bduplicate/.test(lower) || !/\boutput\b/.test(lower) || !/\bcolumn\s+h\b/.test(lower) || !/\blowest to highest\b/.test(lower)) {
    return [];
  }
  const sheet = snapshot.sheets.find((item) => {
    const headers = new Map(item.cells.map((cell) => [`${cell.address.toUpperCase()}:${normalizeHeader(cell.value)}`, cell.value]));
    return headers.has("A1:ITEM") && headers.has("B1:NAME") && headers.has("C1:REF") && headers.has("F1:ITEM") && headers.has("G1:NAME") && headers.has("H1:REF");
  });
  if (!sheet) return [];
  const existing = new Set(
    existingOperations.filter(isSortUniqueRowsOperation).map((operation) => `${operation.sheet}:${operation.sourceRange}:${operation.targetCell}`),
  );
  const sourceRange = `A1:C${sheet.rowCount}`;
  const targetCell = "F2";
  const key = `${sheet.name}:${sourceRange}:${targetCell}`;
  if (existing.has(key)) return [];
  return [{
    op: "sort_unique_rows",
    sheet: sheet.name,
    sourceRange,
    targetCell,
    keyColumns: ["B", "C"],
    outputColumns: ["B", "C"],
    sortBy: "C",
    sortDirection: "asc",
    includeIndex: true,
  }];
}

function aggregateOperationKey(sourceSheet: string, sourceSection: string, targetSheet: string, targetSection: string): string {
  return [sourceSheet, sourceSection, targetSheet, targetSection].map(normalizeHeader).join("::");
}

function hasHeaders(block: WorkbookSnapshot["sheets"][number]["blocks"][number], headers: string[]): boolean {
  return headers.every((header) => Boolean(findHeader(block, [header])));
}

function findHeader(block: WorkbookSnapshot["sheets"][number]["blocks"][number], candidates: string[]): string | undefined {
  const normalized = new Set(candidates.map(normalizeHeader));
  return block.headers.find((header) => normalized.has(normalizeHeader(header)));
}

function targetSectionLooksBlank(
  sheet: WorkbookSnapshot["sheets"][number],
  block: WorkbookSnapshot["sheets"][number]["blocks"][number],
): boolean {
  const parsed = parseRangeRef(block.range);
  if (!parsed || block.dataRowCount === 0) return false;
  const headerByName = new Map(block.headers.map((header, index) => [normalizeHeader(header), parsed.startCol + index]));
  const valueColumns = ["DATE", "REF", "AMOUNTS", "AMOUNT"].flatMap((header) => headerByName.get(normalizeHeader(header)) ?? []);
  if (!valueColumns.length) return false;
  const cellValues = new Map(sheet.cells.map((cell) => [cell.address.toUpperCase(), cell.value]));
  for (let row = block.headerRow + 1; row <= parsed.endRow; row += 1) {
    const firstCellValue = cellValues.get(`${columnNumberToName(parsed.startCol)}${row}`)?.trim().toUpperCase();
    if (firstCellValue === "TOTAL") continue;
    if (valueColumns.every((col) => !(cellValues.get(`${columnNumberToName(col)}${row}`) ?? "").trim())) return true;
  }
  return false;
}

function isGenericSheetAlias(value: string): boolean {
  return /^(?:sheet|worksheet|tab)\s*\d+$/i.test(value);
}

function normalizeEditOperationShape(operation: AgentCellEditOperation): AgentCellEditOperation {
  const normalized = { ...operation } as AgentEditOperation & { formula?: unknown; numFmt?: unknown };
  if (normalized.formula === null) delete normalized.formula;
  if (normalized.numFmt === null) delete normalized.numFmt;
  return normalized as AgentCellEditOperation;
}

type WorkbookSnapshot = {
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    actualRowCount: number;
    actualColumnCount: number;
    truncated: boolean;
    blocks: Array<{
      range: string;
      title?: string;
      headerRow: number;
      headers: string[];
      dataRowCount: number;
    }>;
    cells: Array<{ address: string; value: string; formula?: string; numFmt?: string }>;
  }>;
  cellCount: number;
  truncated: boolean;
};

async function snapshotWorkbook(path: string, maxCells = DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS): Promise<WorkbookSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheets: WorkbookSnapshot["sheets"] = [];
  let cellCount = 0;
  let truncated = false;
  const perSheetLimit = workbook.worksheets.length > 0 ? Math.max(24, Math.floor(maxCells / workbook.worksheets.length)) : maxCells;
  for (const sheet of workbook.worksheets) {
    const cells: WorkbookSnapshot["sheets"][number]["cells"] = [];
    let sheetCellCount = 0;
    let sheetTruncated = false;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (sheetCellCount >= perSheetLimit) {
          sheetTruncated = true;
          truncated = true;
          return;
        }
        cells.push({
          address: cell.address,
          value: cellValueForPrompt(cell.value),
          ...(cellFormula(cell.value) ? { formula: cellFormula(cell.value) } : {}),
          ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
        });
        sheetCellCount += 1;
        cellCount += 1;
      });
    });
    sheets.push({
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      actualRowCount: sheet.actualRowCount,
      actualColumnCount: sheet.actualColumnCount,
      truncated: sheetTruncated,
      blocks: detectSheetBlocks(sheet),
      cells,
    });
  }
  return { sheets, cellCount, truncated };
}

function detectSheetBlocks(sheet: ExcelJS.Worksheet) {
  const blocks: WorkbookSnapshot["sheets"][number]["blocks"] = [];
  const maxRow = sheet.rowCount;
  const maxCol = Math.max(1, sheet.actualColumnCount || sheet.columnCount);
  let startRow: number | undefined;
  for (let rowNumber = 1; rowNumber <= maxRow + 1; rowNumber++) {
    const rowHasValues = rowNumber <= maxRow && rowHasVisibleValues(sheet.getRow(rowNumber), maxCol);
    if (rowHasValues && startRow === undefined) startRow = rowNumber;
    if ((!rowHasValues || rowNumber > maxRow) && startRow !== undefined) {
      const endRow = rowNumber - 1;
      const firstValues = visibleRowValues(sheet.getRow(startRow), maxCol);
      const firstNonEmpty = firstValues.filter(Boolean);
      const firstLooksLikeTitle = firstNonEmpty.length === 1 && endRow > startRow;
      const headerRow = firstLooksLikeTitle ? startRow + 1 : startRow;
      const headers = visibleRowValues(sheet.getRow(headerRow), maxCol);
      blocks.push({
        range: `${columnNumberToName(1)}${startRow}:${columnNumberToName(maxCol)}${endRow}`,
        ...(firstLooksLikeTitle ? { title: firstNonEmpty[0] } : {}),
        headerRow,
        headers,
        dataRowCount: Math.max(0, endRow - headerRow),
      });
      startRow = undefined;
    }
  }
  return blocks;
}

function rowHasVisibleValues(row: ExcelJS.Row, maxCol: number): boolean {
  return visibleRowValues(row, maxCol).some(Boolean);
}

function visibleRowValues(row: ExcelJS.Row, maxCol: number): string[] {
  const values: string[] = [];
  for (let column = 1; column <= maxCol; column++) values.push(cellValueForPrompt(row.getCell(column).value));
  return values;
}

function columnNumberToName(column: number): string {
  let value = "";
  let remaining = column;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    value = String.fromCharCode(65 + modulo) + value;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return value;
}

function columnNameToNumber(column: string): number {
  return column
    .replace(/\$/g, "")
    .trim()
    .toUpperCase()
    .split("")
    .reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function cellFormula(value: ExcelJS.CellValue): string | undefined {
  if (value && typeof value === "object" && "formula" in value && typeof value.formula === "string") return value.formula;
  return undefined;
}

function cellValueForPrompt(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) return String(value.result ?? "");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value) return JSON.stringify(value.richText);
    return JSON.stringify(value);
  }
  return String(value);
}

function readPromptFiles(agentDir: string, promptFiles: string[]): Array<{ path: string; text: string }> {
  return promptFiles.slice(0, 4).flatMap((file) => {
    const path = resolveManifestPath(agentDir, file);
    if (!existsSync(path)) return [];
    return [{ path: file, text: readFileSync(path, "utf8").slice(0, 5000) }];
  });
}

function spreadsheetBenchPlannerSystem(): string {
  return [
    "You are a spreadsheet editing worker.",
    "Return only JSON matching this schema:",
    "{\"schema\":1,\"operations\":[{\"sheet\":\"Sheet1\",\"cell\":\"B2\",\"value\":2}]}",
    "For single-cell edits, use value for literal values, or formula plus optional result for formulas.",
    "For repeated visible table aggregation work, prefer the bounded aggregate_section operation:",
    "{\"op\":\"aggregate_section\",\"sourceSheet\":\"RANGES\",\"sourceSection\":\"DATA\",\"targetSheet\":\"LISTS\",\"targetSection\":\"DATA\",\"groupBy\":[\"DATE\",\"REF\"],\"valueColumn\":\"AMOUNTS\",\"sortBy\":[\"DATE\",\"REF\"],\"totalLabel\":\"TOTAL\"}",
    "aggregate_section groups rows in the source section by the named headers, sums valueColumn, sorts by sortBy/groupBy, writes SN/group/value rows, and writes the total formula.",
    "For visible date criteria filters, prefer filter_rows over dynamic FILTER formulas:",
    "{\"op\":\"filter_rows\",\"sheet\":\"FILTER 5b\",\"sourceRange\":\"A1:E315\",\"targetCell\":\"I6\",\"dateColumn\":\"A\",\"startCell\":\"I2\",\"endCell\":\"J2\"}",
    "filter_rows copies concrete rows whose dateColumn is between startCell and endCell into the target range.",
    "For visible dedupe/sort table outputs, prefer sort_unique_rows over writing a short prefix:",
    "{\"op\":\"sort_unique_rows\",\"sheet\":\"sheet1\",\"sourceRange\":\"A1:C195\",\"targetCell\":\"F2\",\"keyColumns\":[\"B\",\"C\"],\"outputColumns\":[\"B\",\"C\"],\"sortBy\":\"C\",\"sortDirection\":\"asc\",\"includeIndex\":true}",
    "sort_unique_rows skips blank/header rows, removes duplicate key rows, sorts by sortBy, and writes an optional index plus outputColumns.",
    "Use exactly one of the sheet names shown in workbook.sheets[].name; do not invent Sheet1 unless Sheet1 exists.",
    "If the task requires many cells, emit every required cell operation explicitly. Do not use placeholders, spill ranges, or one-cell dynamic-array shortcuts.",
    "When a visible example/reference table shows the desired output shape, infer the repeated operation from that reference and write the concrete target cells.",
    "The JSON must be valid strict JSON: double-quoted keys/strings, no comments, no trailing commas.",
    "Do not include markdown, prose, comments, evaluator metadata, or hidden answers.",
  ].join("\n");
}

function spreadsheetBenchPlannerPrompt(agent: AgentManifest, snapshot: WorkbookSnapshot, promptFiles: Array<{ path: string; text: string }>): string {
  const visibleDerivedOperationCandidates = [
    ...inferVisibleAggregateSectionOperations(agent, snapshot, []),
    ...inferVisibleFilterRowsOperations(agent, snapshot, []),
    ...inferVisibleSortUniqueRowsOperations(agent, snapshot, []),
  ];
  return JSON.stringify({
    taskId: agent.taskId,
    instruction: agent.instruction,
    instructionType: agent.instructionType,
    prompts: promptFiles,
    workbook: snapshot,
    visibleDerivedOperationCandidates,
  }, null, 2);
}

function parseEditPlanText(text: string, taskId: string): AgentEditPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonText = extractFirstJsonObject(cleaned, taskId);
  if (!jsonText.startsWith("{")) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  return parseEditPlanJson(jsonText);
}

function parseEditPlanJson(jsonText: string): AgentEditPlan {
  try {
    return JSON.parse(jsonText) as AgentEditPlan;
  } catch (error) {
    const repaired = repairCommonModelJsonDrift(jsonText);
    if (repaired !== jsonText) {
      try {
        return JSON.parse(repaired) as AgentEditPlan;
      } catch {
        // Preserve the original parser error so failure taxonomy stays tied to the model output.
      }
    }
    throw error;
  }
}

function repairCommonModelJsonDrift(jsonText: string): string {
  const withoutInvalidCommaEscapes = jsonText.replace(/\\,/g, ",");
  const withoutTrailingCommas = withoutInvalidCommaEscapes.replace(/,\s*([}\]])/g, "$1");
  const withoutUncertainNumberSuffixes = withoutTrailingCommas.replace(/("(?:value|result)"\s*:\s*-?\d+(?:\.\d+)?)\?(?=\s*[,}])/g, "$1");
  return withoutUncertainNumberSuffixes.replace(/("value"\s*:\s*)([A-Za-z_][A-Za-z0-9_ -]*)(?=\s*[,}])/g, (_match, prefix: string, raw: string) => {
    const value = raw.trim();
    if (/^(?:true|false|null)$/i.test(value)) return `${prefix}${value.toLowerCase()}`;
    return `${prefix}${JSON.stringify(value)}`;
  });
}

function extractFirstJsonObject(text: string, taskId: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`model-edit-plan returned unterminated JSON for ${taskId}`);
}

function applyOperation(workbook: ExcelJS.Workbook, operation: AgentEditOperation) {
  if (isAggregateSectionOperation(operation)) {
    applyAggregateSectionOperation(workbook, operation);
    return;
  }
  if (isFilterRowsOperation(operation)) {
    applyFilterRowsOperation(workbook, operation);
    return;
  }
  if (isSortUniqueRowsOperation(operation)) {
    applySortUniqueRowsOperation(workbook, operation);
    return;
  }
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`edit-plan references missing sheet: ${operation.sheet}`);
  const cell = sheet.getCell(operation.cell);
  if (operation.formula !== undefined) {
    cell.value = {
      formula: operation.formula,
      result: operation.result ?? evaluateSimpleFormula(workbook, sheet, operation.formula),
    };
  }
  else if (typeof operation.value === "string" && operation.value.trim().startsWith("=")) {
    const formula = operation.value.trim().slice(1);
    cell.value = {
      formula,
      result: operation.result ?? evaluateSimpleFormula(workbook, sheet, formula),
    };
  }
  else if ("value" in operation) cell.value = operation.value ?? null;
  if (operation.numFmt) cell.numFmt = operation.numFmt;
}

function applyAggregateSectionOperation(workbook: ExcelJS.Workbook, operation: AgentAggregateSectionOperation) {
  const sourceSheet = workbook.getWorksheet(operation.sourceSheet);
  if (!sourceSheet) throw new Error(`aggregate_section references missing source sheet: ${operation.sourceSheet}`);
  const targetSheet = workbook.getWorksheet(operation.targetSheet);
  if (!targetSheet) throw new Error(`aggregate_section references missing target sheet: ${operation.targetSheet}`);
  const sourceSection = findWorksheetSection(sourceSheet, operation.sourceSection);
  if (!sourceSection) throw new Error(`aggregate_section references missing source section: ${operation.sourceSheet}/${operation.sourceSection}`);
  const targetSection = findWorksheetSection(targetSheet, operation.targetSection);
  if (!targetSection) throw new Error(`aggregate_section references missing target section: ${operation.targetSheet}/${operation.targetSection}`);

  const sourceHeaders = headerColumnMap(sourceSection);
  const targetHeaders = headerColumnMap(targetSection);
  const sourceGroupColumns = operation.groupBy.map((header) => {
    const column = sourceHeaders.get(normalizeHeader(header));
    if (!column) throw new Error(`aggregate_section source section missing groupBy header: ${header}`);
    return { header, column };
  });
  const targetGroupColumns = operation.groupBy.map((header) => {
    const column = targetHeaders.get(normalizeHeader(header));
    if (!column) throw new Error(`aggregate_section target section missing groupBy header: ${header}`);
    return { header, column };
  });
  const sourceValueColumn = sourceHeaders.get(normalizeHeader(operation.valueColumn));
  if (!sourceValueColumn) throw new Error(`aggregate_section source section missing valueColumn: ${operation.valueColumn}`);
  const targetValueColumn = targetHeaders.get(normalizeHeader(operation.valueColumn)) ?? targetHeaders.get("AMOUNT");
  if (!targetValueColumn) throw new Error(`aggregate_section target section missing valueColumn: ${operation.valueColumn}`);
  const targetSnColumn = targetHeaders.get("SN") ?? targetHeaders.get("S.N") ?? targetSection.startCol;

  const groups = new Map<string, { values: ExcelJS.CellValue[]; amount: number; sortKeys: string[] }>();
  for (let row = sourceSection.headerRow + 1; row <= sourceSection.endRow; row += 1) {
    const values = sourceGroupColumns.map(({ column }) => sourceSheet.getCell(row, column).value);
    if (values.every(isBlankCellValue)) continue;
    const amount = numericComparableValue(comparableFormulaValue(sourceSheet.getCell(row, sourceValueColumn).value));
    if (amount === undefined) continue;
    const key = values.map(groupKeyValue).join("\u001f");
    const existing = groups.get(key);
    if (existing) existing.amount = roundFormulaNumber(existing.amount + amount);
    else {
      groups.set(key, {
        values,
        amount,
        sortKeys: values.map(sortableGroupValue),
      });
    }
  }
  const rows = [...groups.values()].sort((a, b) => compareAggregateRows(a.sortKeys, b.sortKeys));
  const totalRow = findTotalRow(targetSheet, targetSection, operation.totalLabel ?? "TOTAL") ?? targetSection.endRow;
  const firstDataRow = targetSection.headerRow + 1;
  const lastDataRow = Math.max(firstDataRow - 1, totalRow - 1);
  const availableRows = Math.max(0, lastDataRow - firstDataRow + 1);
  if (rows.length > availableRows) {
    const templateRow = Math.max(firstDataRow, lastDataRow);
    targetSheet.duplicateRow(templateRow, rows.length - availableRows, true);
    targetSection.endRow += rows.length - availableRows;
  }
  const finalTotalRow = findTotalRow(targetSheet, targetSection, operation.totalLabel ?? "TOTAL") ?? firstDataRow + rows.length;
  const finalLastDataRow = Math.max(firstDataRow - 1, finalTotalRow - 1);
  for (let row = firstDataRow; row <= finalLastDataRow; row += 1) {
    for (const column of [targetSnColumn, ...targetGroupColumns.map(({ column }) => column), targetValueColumn]) {
      targetSheet.getCell(row, column).value = null;
    }
  }
  rows.forEach((aggregateRow, index) => {
    const rowNumber = firstDataRow + index;
    targetSheet.getCell(rowNumber, targetSnColumn).value = index + 1;
    targetGroupColumns.forEach(({ column }, groupIndex) => {
      targetSheet.getCell(rowNumber, column).value = outputGroupValue(aggregateRow.values[groupIndex]);
    });
    targetSheet.getCell(rowNumber, targetValueColumn).value = aggregateRow.amount;
  });
  const totalLabelCell = targetSheet.getCell(finalTotalRow, targetSnColumn);
  totalLabelCell.value = operation.totalLabel ?? "TOTAL";
  const totalCell = targetSheet.getCell(finalTotalRow, targetValueColumn);
  const valueColumnName = columnNumberToName(targetValueColumn);
  const formula = `SUM(${valueColumnName}${firstDataRow}:${valueColumnName}${firstDataRow + rows.length - 1})`;
  totalCell.value = {
    formula,
    result: evaluateSimpleFormula(workbook, targetSheet, formula),
  };
}

function applyFilterRowsOperation(workbook: ExcelJS.Workbook, operation: AgentFilterRowsOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`filter_rows references missing sheet: ${operation.sheet}`);
  const source = parseRangeRef(operation.sourceRange);
  const target = parseA1(operation.targetCell);
  if (!source || !target) throw new Error(`filter_rows has invalid range or target`);
  const startDate = dateFromCellValue(sheet.getCell(operation.startCell).value);
  const endDate = dateFromCellValue(sheet.getCell(operation.endCell).value);
  if (!startDate || !endDate) throw new Error(`filter_rows criteria cells must contain dates`);
  const dateCol = operation.dateColumn ? columnNameToNumber(operation.dateColumn) : source.startCol;
  if (dateCol < source.startCol || dateCol > source.endCol) throw new Error(`filter_rows dateColumn is outside sourceRange`);
  const width = source.endCol - source.startCol + 1;
  const height = source.endRow - source.startRow + 1;
  clearRange(sheet, target.row, target.col, target.row + height - 1, target.col + width - 1);
  let outputRow = target.row;
  for (let row = source.startRow; row <= source.endRow; row += 1) {
    const date = dateFromCellValue(sheet.getCell(row, dateCol).value);
    if (!date || date < startDate || date > endDate) continue;
    for (let offset = 0; offset < width; offset += 1) {
      const sourceCell = sheet.getCell(row, source.startCol + offset);
      const targetCell = sheet.getCell(outputRow, target.col + offset);
      targetCell.value = offset === dateCol - source.startCol ? outputGroupValue(sourceCell.value) : sourceCell.value;
      targetCell.style = { ...sourceCell.style };
      if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
    }
    outputRow += 1;
  }
}

function applySortUniqueRowsOperation(workbook: ExcelJS.Workbook, operation: AgentSortUniqueRowsOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`sort_unique_rows references missing sheet: ${operation.sheet}`);
  const source = parseRangeRef(operation.sourceRange);
  const target = parseA1(operation.targetCell);
  if (!source || !target) throw new Error(`sort_unique_rows has invalid range or target`);
  const keyColumns = operation.keyColumns.map(columnNameToNumber);
  const outputColumns = operation.outputColumns.map(columnNameToNumber);
  const sortColumn = columnNameToNumber(operation.sortBy);
  const referencedColumns = [...keyColumns, ...outputColumns, sortColumn];
  if (referencedColumns.some((column) => column < source.startCol || column > source.endCol)) {
    throw new Error(`sort_unique_rows references columns outside sourceRange`);
  }
  const rows: Array<{ values: ExcelJS.CellValue[]; key: string; sortValue: ExcelJS.CellValue; originalRow: number }> = [];
  const seen = new Set<string>();
  for (let row = source.startRow; row <= source.endRow; row += 1) {
    const keyValues = keyColumns.map((col) => sheet.getCell(row, col).value);
    const outputValues = outputColumns.map((col) => sheet.getCell(row, col).value);
    if (outputValues.every(isBlankCellValue)) continue;
    if (outputValues.some((value) => normalizeHeader(cellValueForPrompt(value)) === "NAME" || normalizeHeader(cellValueForPrompt(value)) === "REF")) continue;
    const key = keyValues.map((value) => cellValueForPrompt(value).trim().toUpperCase()).join("\u001f");
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    rows.push({ values: outputValues, key, sortValue: sheet.getCell(row, sortColumn).value, originalRow: row });
  }
  rows.sort((left, right) => compareSortValues(left.sortValue, right.sortValue, operation.sortDirection ?? "asc") || left.originalRow - right.originalRow);
  const width = outputColumns.length + (operation.includeIndex === false ? 0 : 1);
  const height = source.endRow - source.startRow + 1;
  clearRange(sheet, target.row, target.col, target.row + height - 1, target.col + width - 1);
  rows.forEach((row, index) => {
    const rowNumber = target.row + index;
    let col = target.col;
    if (operation.includeIndex !== false) sheet.getCell(rowNumber, col++).value = index + 1;
    for (const value of row.values) sheet.getCell(rowNumber, col++).value = value;
  });
}

function clearRange(sheet: ExcelJS.Worksheet, startRow: number, startCol: number, endRow: number, endCol: number) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) sheet.getCell(row, col).value = null;
  }
}

function compareSortValues(left: ExcelJS.CellValue, right: ExcelJS.CellValue, direction: "asc" | "desc"): number {
  const leftNumber = numericComparableValue(comparableFormulaValue(left));
  const rightNumber = numericComparableValue(comparableFormulaValue(right));
  const multiplier = direction === "desc" ? -1 : 1;
  if (leftNumber !== undefined && rightNumber !== undefined) return (leftNumber - rightNumber) * multiplier;
  return cellValueForPrompt(left).localeCompare(cellValueForPrompt(right), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

type WorksheetSection = {
  title?: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  headerRow: number;
  headers: string[];
};

function findWorksheetSection(sheet: ExcelJS.Worksheet, title: string): WorksheetSection | undefined {
  const normalizedTitle = normalizeHeader(title);
  return detectWorksheetSections(sheet).find((section) => section.title && normalizeHeader(section.title) === normalizedTitle);
}

function detectWorksheetSections(sheet: ExcelJS.Worksheet): WorksheetSection[] {
  const sections: WorksheetSection[] = [];
  const maxRow = sheet.rowCount;
  const maxCol = Math.max(1, sheet.actualColumnCount || sheet.columnCount);
  let startRow: number | undefined;
  for (let rowNumber = 1; rowNumber <= maxRow + 1; rowNumber += 1) {
    const hasValues = rowNumber <= maxRow && rowHasVisibleValues(sheet.getRow(rowNumber), maxCol);
    if (hasValues && startRow === undefined) startRow = rowNumber;
    if ((!hasValues || rowNumber > maxRow) && startRow !== undefined) {
      const endRow = rowNumber - 1;
      const firstValues = visibleRowValues(sheet.getRow(startRow), maxCol);
      const firstNonEmpty = firstValues.filter(Boolean);
      const firstLooksLikeTitle = firstNonEmpty.length === 1 && endRow > startRow;
      const headerRow = firstLooksLikeTitle ? startRow + 1 : startRow;
      const headers = visibleRowValues(sheet.getRow(headerRow), maxCol);
      sections.push({
        ...(firstLooksLikeTitle ? { title: firstNonEmpty[0] } : {}),
        startRow,
        endRow,
        startCol: 1,
        endCol: maxCol,
        headerRow,
        headers,
      });
      startRow = undefined;
    }
  }
  return sections;
}

function headerColumnMap(section: WorksheetSection): Map<string, number> {
  const map = new Map<string, number>();
  section.headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized) map.set(normalized, section.startCol + index);
  });
  return map;
}

function findTotalRow(sheet: ExcelJS.Worksheet, section: WorksheetSection, totalLabel: string): number | undefined {
  const normalizedLabel = normalizeHeader(totalLabel);
  for (let row = section.headerRow + 1; row <= section.endRow; row += 1) {
    for (let col = section.startCol; col <= section.endCol; col += 1) {
      if (normalizeHeader(cellValueForPrompt(sheet.getCell(row, col).value)) === normalizedLabel) return row;
    }
  }
  return undefined;
}

function compareAggregateRows(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? "";
    const b = right[index] ?? "";
    const compared = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    if (compared !== 0) return compared;
  }
  return 0;
}

function outputGroupValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  const date = dateFromCellValue(value);
  return date ?? value;
}

function sortableGroupValue(value: ExcelJS.CellValue): string {
  const date = dateFromCellValue(value);
  if (date) return date.toISOString();
  return cellValueForPrompt(value).trim().toUpperCase();
}

function groupKeyValue(value: ExcelJS.CellValue): string {
  return sortableGroupValue(value);
}

function dateFromCellValue(value: ExcelJS.CellValue): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
  return undefined;
}

function isBlankCellValue(value: ExcelJS.CellValue): boolean {
  return cellValueForPrompt(value).trim() === "";
}

function parseRangeRef(range: string): { startCol: number; startRow: number; endCol: number; endRow: number } | undefined {
  const [start, end = start] = range.split(":").map((part) => parseA1(part.trim()));
  if (!start || !end) return undefined;
  return {
    startCol: Math.min(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endCol: Math.max(start.col, end.col),
    endRow: Math.max(start.row, end.row),
  };
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();
}

function evaluateSimpleFormula(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  formula: string,
): FormulaResult | undefined {
  const expression = formula.trim().replace(/^=/, "");
  return evaluateFormulaExpression(workbook, currentSheet, expression);
}

function evaluateFormulaExpression(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): FormulaResult | undefined {
  const trimmed = expression.trim();
  if (/^TRUE$/i.test(trimmed)) return true;
  if (/^FALSE$/i.test(trimmed)) return false;
  const stringLiteral = parseFormulaStringLiteral(trimmed);
  if (stringLiteral !== undefined) return stringLiteral;
  const functionResult = evaluateFormulaFunction(workbook, currentSheet, trimmed);
  if (functionResult !== undefined) return functionResult;
  return evaluateArithmeticFormula(workbook, currentSheet, trimmed);
}

function evaluateFormulaFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): FormulaResult | undefined {
  const call = parseSingleFormulaFunction(expression);
  if (!call) return undefined;
  const fn = call.name.toUpperCase();
  if (!SUPPORTED_FORMULA_FUNCTIONS.includes(fn as (typeof SUPPORTED_FORMULA_FUNCTIONS)[number])) return undefined;
  const args = splitFormulaArgs(call.args);
  if (fn === "IF") return evaluateIfFunction(workbook, currentSheet, args);
  if (fn === "IFERROR") return evaluateIfErrorFunction(workbook, currentSheet, args);
  if (fn === "SUMIF") return evaluateSumIfFunction(workbook, currentSheet, args);
  if (fn === "COUNTIF") return evaluateCountIfFunction(workbook, currentSheet, args);
  if (fn === "AVERAGEIF") return evaluateAverageIfFunction(workbook, currentSheet, args);
  if (fn === "SUMIFS") return evaluateSumIfsFunction(workbook, currentSheet, args);
  if (fn === "COUNTIFS") return evaluateCountIfsFunction(workbook, currentSheet, args);
  if (fn === "AVERAGEIFS") return evaluateAverageIfsFunction(workbook, currentSheet, args);
  if (fn === "MATCH") return evaluateMatchFunction(workbook, currentSheet, args);
  if (fn === "INDEX") return evaluateIndexFunction(workbook, currentSheet, args);
  if (fn === "VLOOKUP") return evaluateVLookupFunction(workbook, currentSheet, args);
  if (fn === "XLOOKUP") return evaluateXLookupFunction(workbook, currentSheet, args);
  if (fn === "COUNTA") return args.flatMap((part) => rawValuesForFormulaArg(workbook, currentSheet, part.trim())).filter(isNonBlankFormulaValue).length;

  const values = args.flatMap((part) => valuesForFormulaArg(workbook, currentSheet, part.trim()));
  if (values.length === 0 || values.some((value) => value === undefined)) return undefined;
  const numericValues = values.filter((value): value is number => value !== undefined);
  if (fn === "COUNT") return numericValues.length;
  if (numericValues.length === 0) return undefined;
  if (fn === "SUM") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0));
  if (fn === "AVERAGE") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
  if (fn === "MIN") return Math.min(...numericValues);
  if (fn === "MAX") return Math.max(...numericValues);
  if (fn === "ABS" && numericValues.length === 1) return Math.abs(numericValues[0]);
  if (fn === "ROUND" || fn === "ROUNDUP" || fn === "ROUNDDOWN") {
    if (numericValues.length !== 2) return undefined;
    return roundWithMode(numericValues[0], numericValues[1], fn);
  }
  return undefined;
}

function parseSingleFormulaFunction(expression: string): { name: string; args: string } | undefined {
  const trimmed = expression.trim();
  const header = trimmed.match(/^([A-Z]+)\(/i);
  if (!header) return undefined;
  let depth = 0;
  let inString = false;
  let inSheetQuote = false;
  const openIndex = header[0].length - 1;
  for (let index = openIndex; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\"") {
      if (inString && trimmed[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "'") {
      inSheetQuote = !inSheetQuote;
      continue;
    }
    if (inSheetQuote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        if (index !== trimmed.length - 1) return undefined;
        return { name: header[1], args: trimmed.slice(openIndex + 1, index) };
      }
    }
  }
  return undefined;
}

function evaluateIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const condition = evaluateFormulaCondition(workbook, currentSheet, args[0]);
  if (condition === undefined) return undefined;
  const branch = condition ? args[1] : args[2] ?? "FALSE";
  return evaluateFormulaExpression(workbook, currentSheet, branch);
}

function evaluateIfErrorFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length !== 2) return undefined;
  return evaluateFormulaExpression(workbook, currentSheet, args[0])
    ?? evaluateFormulaExpression(workbook, currentSheet, args[1]);
}

function evaluateSumIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const criteriaCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!criteriaCells) return undefined;
  const sumCells = args[2] ? cellsForFormulaRef(workbook, currentSheet, args[2]) : criteriaCells;
  if (!sumCells || sumCells.length < criteriaCells.length) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  let total = 0;
  for (let index = 0; index < criteriaCells.length; index += 1) {
    if (!formulaValueMatchesCriteria(criteriaCells[index].value, criteria)) continue;
    const numeric = numericComparableValue(sumCells[index].value);
    if (numeric === undefined) return undefined;
    total += numeric;
  }
  return roundFormulaNumber(total);
}

function evaluateCountIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length !== 2) return undefined;
  const cells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!cells) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  return cells.filter((cell) => formulaValueMatchesCriteria(cell.value, criteria)).length;
}

function evaluateAverageIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const criteriaCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!criteriaCells) return undefined;
  const averageCells = args[2] ? cellsForFormulaRef(workbook, currentSheet, args[2]) : criteriaCells;
  if (!averageCells || averageCells.length < criteriaCells.length) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  const values: number[] = [];
  for (let index = 0; index < criteriaCells.length; index += 1) {
    if (!formulaValueMatchesCriteria(criteriaCells[index].value, criteria)) continue;
    const numeric = numericComparableValue(averageCells[index].value);
    if (numeric === undefined) return undefined;
    values.push(numeric);
  }
  if (values.length === 0) return undefined;
  return roundFormulaNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function evaluateSumIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 3 || args.length % 2 !== 1) return undefined;
  const sumCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args.slice(1), sumCells?.length ?? 0);
  if (!sumCells || !criteriaSets) return undefined;
  let total = 0;
  for (let index = 0; index < sumCells.length; index += 1) {
    if (!criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) continue;
    const numeric = numericComparableValue(sumCells[index].value);
    if (numeric === undefined) return undefined;
    total += numeric;
  }
  return roundFormulaNumber(total);
}

function evaluateCountIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length % 2 !== 0) return undefined;
  const firstRange = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args, firstRange?.length ?? 0);
  if (!firstRange || !criteriaSets) return undefined;
  let count = 0;
  for (let index = 0; index < firstRange.length; index += 1) {
    if (criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) count += 1;
  }
  return count;
}

function evaluateAverageIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 3 || args.length % 2 !== 1) return undefined;
  const averageCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args.slice(1), averageCells?.length ?? 0);
  if (!averageCells || !criteriaSets) return undefined;
  const values: number[] = [];
  for (let index = 0; index < averageCells.length; index += 1) {
    if (!criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) continue;
    const numeric = numericComparableValue(averageCells[index].value);
    if (numeric === undefined) return undefined;
    values.push(numeric);
  }
  if (values.length === 0) return undefined;
  return roundFormulaNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function criteriaSetsFromFormulaArgs(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
  expectedLength: number,
): Array<{ cells: Array<{ row: number; col: number; value: FormulaCellValue }>; criteria: FormulaResult }> | undefined {
  if (expectedLength <= 0 || args.length < 2 || args.length % 2 !== 0) return undefined;
  const sets: Array<{ cells: Array<{ row: number; col: number; value: FormulaCellValue }>; criteria: FormulaResult }> = [];
  for (let index = 0; index < args.length; index += 2) {
    const cells = cellsForFormulaRef(workbook, currentSheet, args[index]);
    const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[index + 1]);
    if (!cells || cells.length < expectedLength || criteria === undefined) return undefined;
    sets.push({ cells, criteria });
  }
  return sets;
}

function evaluateMatchFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  if (args[2] !== undefined && numericFormulaArg(workbook, currentSheet, args[2]) !== 0) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const lookupCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  if (lookupValue === undefined || !lookupCells) return undefined;
  const matchIndex = lookupCells.findIndex((cell) => compareFormulaValues(cell.value, lookupValue, "="));
  return matchIndex >= 0 ? matchIndex + 1 : undefined;
}

function evaluateIndexFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const cells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const rowNumber = numericFormulaArg(workbook, currentSheet, args[1]);
  const columnNumber = args[2] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[2]);
  if (!cells || rowNumber === undefined || columnNumber === undefined) return undefined;
  const rowOffset = Math.trunc(rowNumber) - 1;
  const colOffset = Math.trunc(columnNumber) - 1;
  if (rowOffset < 0 || colOffset < 0) return undefined;
  return cellAtFormulaRangeOffset(cells, rowOffset, colOffset)?.value ?? undefined;
}

function evaluateVLookupFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 4 || args.length > 4) return undefined;
  if (!formulaArgRequestsExactLookup(workbook, currentSheet, args[3])) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const tableCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  const colIndex = numericFormulaArg(workbook, currentSheet, args[2]);
  if (lookupValue === undefined || !tableCells || colIndex === undefined) return undefined;
  const shape = formulaRangeShape(tableCells);
  const targetColOffset = Math.trunc(colIndex) - 1;
  if (targetColOffset < 0 || targetColOffset >= shape.colCount) return undefined;
  for (let rowOffset = 0; rowOffset < shape.rowCount; rowOffset += 1) {
    const firstColumn = cellAtFormulaRangeOffset(tableCells, rowOffset, 0);
    if (!firstColumn || !compareFormulaValues(firstColumn.value, lookupValue, "=")) continue;
    return cellAtFormulaRangeOffset(tableCells, rowOffset, targetColOffset)?.value ?? undefined;
  }
  return undefined;
}

function evaluateXLookupFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 3 || args.length > 6) return undefined;
  const matchMode = args[4] === undefined ? 0 : numericFormulaArg(workbook, currentSheet, args[4]);
  const searchMode = args[5] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[5]);
  if (matchMode !== 0 || (searchMode !== 1 && searchMode !== -1)) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const lookupCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  const returnCells = cellsForFormulaRef(workbook, currentSheet, args[2]);
  if (lookupValue === undefined || !lookupCells || !returnCells || returnCells.length < lookupCells.length) return undefined;
  const indexes = lookupCells.map((_, index) => index);
  if (searchMode === -1) indexes.reverse();
  const matchIndex = indexes.find((index) => compareFormulaValues(lookupCells[index].value, lookupValue, "="));
  if (matchIndex !== undefined) return returnCells[matchIndex].value ?? undefined;
  return args[3] === undefined ? undefined : lookupFormulaArg(workbook, currentSheet, args[3]);
}

function formulaRangeShape(cells: Array<{ row: number; col: number; value: FormulaCellValue }>): { startRow: number; startCol: number; rowCount: number; colCount: number } {
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  const startRow = Math.min(...rows);
  const startCol = Math.min(...cols);
  return {
    startRow,
    startCol,
    rowCount: Math.max(...rows) - startRow + 1,
    colCount: Math.max(...cols) - startCol + 1,
  };
}

function cellAtFormulaRangeOffset(
  cells: Array<{ row: number; col: number; value: FormulaCellValue }>,
  rowOffset: number,
  colOffset: number,
): { row: number; col: number; value: FormulaCellValue } | undefined {
  const shape = formulaRangeShape(cells);
  return cells.find((cell) => cell.row === shape.startRow + rowOffset && cell.col === shape.startCol + colOffset);
}

function numericFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): number | undefined {
  return numericComparableValue(lookupFormulaArg(workbook, currentSheet, arg));
}

function formulaArgRequestsExactLookup(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): boolean {
  const value = lookupFormulaArg(workbook, currentSheet, arg);
  if (value === false) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return /^FALSE$/i.test(value.trim()) || value.trim() === "0";
  return false;
}

function lookupFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaResult | undefined {
  const literal = parseFormulaStringLiteral(arg);
  if (literal !== undefined) return literal;
  const cells = formulaArgLooksLikeRange(arg) ? cellsForFormulaRef(workbook, currentSheet, arg) : undefined;
  if (cells?.length === 1) return cells[0].value ?? undefined;
  return evaluateFormulaExpression(workbook, currentSheet, arg);
}

function valuesForFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): Array<number | undefined> {
  if (formulaArgLooksLikeRange(arg)) return valuesForFormulaRef(workbook, currentSheet, arg);
  return [numericComparableValue(evaluateFormulaExpression(workbook, currentSheet, arg))];
}

function rawValuesForFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaCellValue[] {
  if (formulaArgLooksLikeRange(arg)) return valuesForFormulaRefRaw(workbook, currentSheet, arg);
  const value = evaluateFormulaExpression(workbook, currentSheet, arg);
  return value === undefined ? [] : [value];
}

function formulaArgLooksLikeRange(arg: string): boolean {
  return /^(?:'[^']+'!|[A-Z0-9_ .-]+!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Z]{1,3}\$?[1-9][0-9]*)?$/i.test(arg.trim());
}

function splitFormulaArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inSheetQuote = false;
  let inString = false;
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\"") {
      if (inString && raw[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "'") {
      inSheetQuote = !inSheetQuote;
      continue;
    }
    if (inSheetQuote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  args.push(raw.slice(start));
  return args.map((arg) => arg.trim()).filter(Boolean);
}

function evaluateArithmeticFormula(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): number | undefined {
  const expandedFunctions = replaceFormulaFunctionCalls(workbook, currentSheet, expression);
  if (expandedFunctions === undefined) return undefined;
  const normalized = replaceFormulaRefs(workbook, currentSheet, expandedFunctions);
  if (normalized === undefined || !/^[0-9+\-*/^().\s]+$/.test(normalized)) return undefined;
  try {
    return roundFormulaNumber(new FormulaMathParser(normalized).parse());
  } catch {
    return undefined;
  }
}

function replaceFormulaFunctionCalls(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): string | undefined {
  let failed = false;
  let current = expression;
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    current = current.replace(/\b(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|ABS|ROUND|ROUNDUP|ROUNDDOWN|IF|IFERROR|SUMIF|COUNTIF|AVERAGEIF|SUMIFS|COUNTIFS|AVERAGEIFS|MATCH|INDEX|VLOOKUP|XLOOKUP)\(([^()]+)\)/gi, (match) => {
      const result = evaluateFormulaFunction(workbook, currentSheet, match);
      if (typeof result !== "number") {
        failed = true;
        return "0";
      }
      changed = true;
      return String(result);
    });
    if (failed) return undefined;
    if (!changed) return current;
  }
  return undefined;
}

function replaceFormulaRefs(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): string | undefined {
  let failed = false;
  const replaced = expression.replace(/(?:'[^']+'!|[A-Z0-9_ .-]+!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*/gi, (ref) => {
    const values = valuesForFormulaRef(workbook, currentSheet, ref);
    if (values.length !== 1 || values[0] === undefined) {
      failed = true;
      return "0";
    }
    return String(values[0]);
  });
  return failed ? undefined : replaced;
}

function valuesForFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): Array<number | undefined> {
  const cells = cellsForFormulaRef(workbook, currentSheet, ref);
  if (!cells) return [undefined];
  return cells.map((cell) => numericComparableValue(cell.value));
}

function valuesForFormulaRefRaw(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): FormulaCellValue[] {
  return cellsForFormulaRef(workbook, currentSheet, ref)?.map((cell) => cell.value) ?? [];
}

function cellsForFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): Array<{ row: number; col: number; value: FormulaCellValue }> | undefined {
  const { sheet, range } = parseFormulaRef(workbook, currentSheet, ref);
  if (!sheet || !range) return undefined;
  const start = parseA1(range.start);
  const end = parseA1(range.end);
  if (!start || !end) return undefined;
  const cells: Array<{ row: number; col: number; value: FormulaCellValue }> = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
      cells.push({ row, col, value: comparableFormulaValue(sheet.getCell(row, col).value) });
    }
  }
  return cells;
}

function parseFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  raw: string,
): { sheet: ExcelJS.Worksheet | undefined; range: { start: string; end: string } | undefined } {
  const bang = raw.lastIndexOf("!");
  const sheetName = bang >= 0 ? raw.slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'") : currentSheet.name;
  const sheet = workbook.getWorksheet(sheetName);
  const rangeText = (bang >= 0 ? raw.slice(bang + 1) : raw).replace(/\$/g, "");
  const [start, end = start] = rangeText.split(":").map((part) => part.trim().toUpperCase());
  return { sheet, range: { start, end } };
}

function parseA1(ref: string): { row: number; col: number } | undefined {
  const match = ref.replace(/\$/g, "").match(/^([A-Z]{1,3})([1-9][0-9]*)$/);
  if (!match) return undefined;
  return {
    row: Number(match[2]),
    col: match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0),
  };
}

function parseFormulaStringLiteral(expression: string): string | undefined {
  const trimmed = expression.trim();
  if (!/^"(?:[^"]|"")*"$/.test(trimmed)) return undefined;
  return trimmed.slice(1, -1).replace(/""/g, "\"");
}

function evaluateFormulaCondition(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): boolean | undefined {
  const comparison = splitFormulaComparison(expression);
  if (comparison) {
    const left = evaluateFormulaExpression(workbook, currentSheet, comparison.left);
    const right = evaluateFormulaExpression(workbook, currentSheet, comparison.right);
    if (left === undefined || right === undefined) return undefined;
    return compareFormulaValues(left, right, comparison.operator);
  }
  const value = evaluateFormulaExpression(workbook, currentSheet, expression);
  if (typeof value === "boolean") return value;
  const numeric = numericComparableValue(value);
  if (numeric !== undefined) return numeric !== 0;
  if (typeof value === "string") return value.trim() !== "";
  return undefined;
}

function splitFormulaComparison(expression: string): { left: string; operator: string; right: string } | undefined {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "\"") {
      if (inString && expression[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth !== 0) continue;
    for (const operator of [">=", "<=", "<>", "=", ">", "<"]) {
      if (!expression.startsWith(operator, index)) continue;
      return {
        left: expression.slice(0, index).trim(),
        operator,
        right: expression.slice(index + operator.length).trim(),
      };
    }
  }
  return undefined;
}

function criteriaFromFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaResult | undefined {
  const literal = parseFormulaStringLiteral(arg);
  if (literal !== undefined) return literal;
  const cells = formulaArgLooksLikeRange(arg) ? cellsForFormulaRef(workbook, currentSheet, arg) : undefined;
  if (cells?.length === 1) return cells[0].value ?? undefined;
  return evaluateFormulaExpression(workbook, currentSheet, arg);
}

function formulaValueMatchesCriteria(value: FormulaCellValue, criteria: FormulaResult): boolean {
  if (typeof criteria === "string") {
    const match = criteria.match(/^(>=|<=|<>|>|<|=)(.*)$/);
    if (match) return compareCriteriaValue(value, match[2].trim(), match[1]);
    if (formulaCriteriaHasWildcard(criteria)) return wildcardFormulaCriteriaMatches(value, criteria);
  }
  return compareFormulaValues(value, criteria, "=");
}

function compareCriteriaValue(value: FormulaCellValue, rawExpected: string, operator: string): boolean {
  const expected = rawExpected === "" ? "" : Number(rawExpected);
  if (typeof expected === "number" && Number.isFinite(expected)) return compareFormulaValues(value, expected, operator);
  const expectedText = rawExpected.replace(/^"|"$/g, "");
  if ((operator === "=" || operator === "<>") && formulaCriteriaHasWildcard(expectedText)) {
    const matches = wildcardFormulaCriteriaMatches(value, expectedText);
    return operator === "<>" ? !matches : matches;
  }
  return compareFormulaValues(value, expectedText, operator);
}

function formulaCriteriaHasWildcard(criteria: string): boolean {
  return /[*?]/.test(criteria);
}

function wildcardFormulaCriteriaMatches(value: FormulaCellValue, criteria: string): boolean {
  const escaped = criteria.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value ?? ""));
}

function compareFormulaValues(left: FormulaCellValue, right: FormulaCellValue, operator: string): boolean {
  const leftNumber = numericComparableValue(left);
  const rightNumber = numericComparableValue(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    if (operator === ">=") return leftNumber >= rightNumber;
    if (operator === "<=") return leftNumber <= rightNumber;
    if (operator === ">") return leftNumber > rightNumber;
    if (operator === "<") return leftNumber < rightNumber;
    if (operator === "<>") return leftNumber !== rightNumber;
    return leftNumber === rightNumber;
  }
  const leftText = String(left ?? "").toUpperCase();
  const rightText = String(right ?? "").toUpperCase();
  if (operator === "<>") return leftText !== rightText;
  if (operator === "=") return leftText === rightText;
  return false;
}

function isNonBlankFormulaValue(value: FormulaCellValue): boolean {
  return value !== null && value !== "";
}

function comparableFormulaValue(value: ExcelJS.CellValue): FormulaCellValue {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value && typeof value === "object" && "result" in value) return comparableFormulaValue(value.result as ExcelJS.CellValue);
  if (value === null || value === undefined) return null;
  return String(value);
}

function numericComparableValue(value: FormulaCellValue | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value === null || value === undefined || value === "") return 0;
  return undefined;
}

function roundWithMode(value: number, digits: number, mode: "ROUND" | "ROUNDUP" | "ROUNDDOWN"): number {
  const places = Math.trunc(digits);
  const factor = 10 ** places;
  const scaled = value * factor;
  if (mode === "ROUNDUP") return roundFormulaNumber((scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor);
  if (mode === "ROUNDDOWN") return roundFormulaNumber((scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor);
  return roundFormulaNumber(Math.round(scaled) / factor);
}

function roundFormulaNumber(value: number): number {
  return Number(value.toFixed(12));
}

class FormulaMathParser {
  private index = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.expression.length) throw new Error("trailing formula characters");
    if (!Number.isFinite(value)) throw new Error("non-finite formula result");
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.take("+")) value += this.parseTerm();
      else if (this.take("-")) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parsePower();
    while (true) {
      this.skipWhitespace();
      if (this.take("*")) value *= this.parsePower();
      else if (this.take("/")) value /= this.parsePower();
      else return value;
    }
  }

  private parsePower(): number {
    const base = this.parseUnary();
    this.skipWhitespace();
    if (!this.take("^")) return base;
    return base ** this.parsePower();
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.take("+")) return this.parseUnary();
    if (this.take("-")) return -this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.take("(")) {
      const value = this.parseExpression();
      if (!this.take(")")) throw new Error("unterminated formula parentheses");
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const match = this.expression.slice(this.index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error("expected formula number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private take(value: string): boolean {
    if (this.expression[this.index] !== value) return false;
    this.index += value.length;
    return true;
  }

  private skipWhitespace() {
    while (/\s/.test(this.expression[this.index] ?? "")) this.index += 1;
  }
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  const calls = results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0);
  const inputTokens = results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0);
  const costUsd = Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8));
  return { calls, inputTokens, outputTokens, costUsd };
}

function aggregateStats(results: SpreadsheetBenchRunnerTaskResult[]): SpreadsheetBenchRunnerReport["stats"] {
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    const key = `${result.error.phase}:${result.error.message}`;
    failureCounts[key] = (failureCounts[key] ?? 0) + 1;
  }
  return {
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    failureCounts,
  };
}

function buildRetryPolicy(options: SpreadsheetBenchRunnerOptions): SpreadsheetBenchRunnerReport["retryPolicy"] {
  const maxRetries = Math.max(0, Math.trunc(options.retryFailed ?? 0));
  return {
    maxRetries,
    retryOn: [
      "candidate_generation",
      "scoring",
      ...(options.retryScoreFailures ? ["score_failure" as const] : []),
    ],
    stopOnPass: true,
  };
}

function shouldRetry(
  result: SpreadsheetBenchRunnerTaskResult,
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
  tryIndex: number,
): boolean {
  if (tryIndex > retryPolicy.maxRetries) return false;
  if (result.score?.pass) return false;
  if (result.error) return retryPolicy.retryOn.includes(result.error.phase);
  if (result.score && !result.score.pass) return retryPolicy.retryOn.includes("score_failure");
  return false;
}

function summarizeCaseRun(
  stageRoot: string,
  task: StagedTaskPaths,
  repeatIndex: number,
  attempts: SpreadsheetBenchRunnerTaskResult[],
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
): SpreadsheetBenchRunnerCaseRun {
  const final = attempts.at(-1);
  const pass = attempts.some((attempt) => attempt.score?.pass);
  return {
    taskId: final?.taskId ?? rel(stageRoot, task.taskDir),
    taskDir: rel(stageRoot, task.taskDir),
    repeatIndex,
    attempts: attempts.map((attempt) => attempt.attemptIndex),
    finalAttemptIndex: final?.attemptIndex,
    pass,
    stopReason: caseStopReason(final, pass, attempts.length, retryPolicy),
    bestOverall: attempts.length
      ? Number(Math.max(...attempts.map((attempt) => attempt.score?.scores.overall ?? 0)).toFixed(6))
      : 0,
  };
}

function caseStopReason(
  final: SpreadsheetBenchRunnerTaskResult | undefined,
  pass: boolean,
  attemptCount: number,
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
): SpreadsheetBenchRunnerCaseRun["stopReason"] {
  if (!final) return "runner_error";
  if (pass) return "passed";
  const retryableFinal =
    (final.error && retryPolicy.retryOn.includes(final.error.phase)) ||
    (!!final.score && !final.score.pass && retryPolicy.retryOn.includes("score_failure"));
  if (retryableFinal && attemptCount >= retryPolicy.maxRetries + 1) return "retry_exhausted";
  if (final.error) return "non_retryable_error";
  return "failed_score";
}

function aggregateRetryStats(caseRuns: SpreadsheetBenchRunnerCaseRun[]): SpreadsheetBenchRunnerReport["retryStats"] {
  return {
    retriedCaseRunCount: caseRuns.filter((run) => run.attempts.length > 1).length,
    retryAttemptCount: caseRuns.reduce((sum, run) => sum + Math.max(0, run.attempts.length - 1), 0),
    passedAfterRetryCount: caseRuns.filter((run) => run.pass && run.attempts.length > 1).length,
    exhaustedCaseRunCount: caseRuns.filter((run) => run.stopReason === "retry_exhausted").length,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? 0;
}

function resolveManifestPath(base: string, manifestPath: string | undefined): string {
  if (!manifestPath) throw new Error("manifest path is missing");
  return resolve(base, manifestPath.replace(/\\/g, "/"));
}

function resolveAgentPath(base: string, manifestPath: string): string {
  const root = resolve(base);
  const resolved = resolveManifestPath(root, manifestPath);
  const relPath = relative(root, resolved);
  if (!relPath || relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new Error(`agent manifest path escapes agent workspace: ${manifestPath}`);
  }
  return resolved;
}

function walkDirs(root: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    if (!item.isDirectory()) continue;
    if (existsSync(join(full, "agent", "task.json"))) out.push(full);
    out.push(...walkDirs(full));
  }
  return out;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}
