import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "./spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { AgentModel, TokenUsage } from "../agent/types";
import { priceRun } from "../agent/model";

export type SpreadsheetBenchRunnerMode = "copy-input-baseline" | "apply-agent-patch" | "model-edit-plan";

const FORMULA_RESULT_POLICY = "deterministic_local_subset";
const SUPPORTED_FORMULA_FUNCTIONS = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT"] as const;

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

type AgentEditOperation = {
  sheet: string;
  cell: string;
  value?: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
  numFmt?: string;
};

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
    const plan = normalizeEditPlan(parseEditPlanText(step.text ?? "", args.agent.taskId), snapshot);
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

function isCellRef(value: string): boolean {
  return /^[A-Z]{1,3}[1-9][0-9]*$/i.test(value);
}

function normalizeEditPlan(plan: AgentEditPlan, snapshot: WorkbookSnapshot): AgentEditPlan {
  const sheetNames = new Set(snapshot.sheets.map((sheet) => sheet.name));
  let lastKnownSheet: string | undefined;
  return {
    ...plan,
    operations: Array.isArray(plan.operations)
      ? plan.operations.map((operation) => {
          if (!operation || typeof operation.sheet !== "string") return operation;
          if (sheetNames.has(operation.sheet)) {
            lastKnownSheet = operation.sheet;
            return operation;
          }
          if (lastKnownSheet && isCellRef(operation.sheet)) {
            return {
              ...operation,
              sheet: lastKnownSheet,
              cell: typeof operation.cell === "string" && isCellRef(operation.cell) ? operation.cell : operation.sheet,
            };
          }
          return operation;
        })
      : plan.operations,
  };
}

type WorkbookSnapshot = {
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    actualRowCount: number;
    actualColumnCount: number;
    truncated: boolean;
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
      cells,
    });
  }
  return { sheets, cellCount, truncated };
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
    "Use value for literal values, or formula plus optional result for formulas.",
    "Use exactly one of the sheet names shown in workbook.sheets[].name; do not invent Sheet1 unless Sheet1 exists.",
    "If the task requires many cells, emit every required cell operation explicitly. Do not use placeholders, spill ranges, or one-cell dynamic-array shortcuts.",
    "When a visible example/reference table shows the desired output shape, infer the repeated operation from that reference and write the concrete target cells.",
    "The JSON must be valid strict JSON: double-quoted keys/strings, no comments, no trailing commas.",
    "Do not include markdown, prose, comments, evaluator metadata, or hidden answers.",
  ].join("\n");
}

function spreadsheetBenchPlannerPrompt(agent: AgentManifest, snapshot: WorkbookSnapshot, promptFiles: Array<{ path: string; text: string }>): string {
  return JSON.stringify({
    taskId: agent.taskId,
    instruction: agent.instruction,
    instructionType: agent.instructionType,
    prompts: promptFiles,
    workbook: snapshot,
  }, null, 2);
}

function parseEditPlanText(text: string, taskId: string): AgentEditPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonText = extractFirstJsonObject(cleaned, taskId);
  if (!jsonText.startsWith("{")) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  return JSON.parse(jsonText) as AgentEditPlan;
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

function evaluateSimpleFormula(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  formula: string,
): number | undefined {
  const expression = formula.trim().replace(/^=/, "");
  return evaluateFormulaExpression(workbook, currentSheet, expression);
}

function evaluateFormulaExpression(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): number | undefined {
  const functionResult = evaluateFormulaFunction(workbook, currentSheet, expression);
  if (functionResult !== undefined) return functionResult;
  return evaluateArithmeticFormula(workbook, currentSheet, expression);
}

function evaluateFormulaFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): number | undefined {
  const match = expression.trim().match(/^([A-Z]+)\((.*)\)$/i);
  if (!match) return undefined;
  const fn = match[1].toUpperCase();
  if (!SUPPORTED_FORMULA_FUNCTIONS.includes(fn as (typeof SUPPORTED_FORMULA_FUNCTIONS)[number])) return undefined;
  const values = splitFormulaArgs(match[2]).flatMap((part) => valuesForFormulaArg(workbook, currentSheet, part.trim()));
  if (values.length === 0 || values.some((value) => value === undefined)) return undefined;
  const numericValues = values.filter((value): value is number => value !== undefined);
  if (fn === "COUNT") return numericValues.length;
  if (numericValues.length === 0) return undefined;
  if (fn === "SUM") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0));
  if (fn === "AVERAGE") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
  if (fn === "MIN") return Math.min(...numericValues);
  if (fn === "MAX") return Math.max(...numericValues);
  return undefined;
}

function valuesForFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): Array<number | undefined> {
  if (formulaArgLooksLikeRange(arg)) return valuesForFormulaRef(workbook, currentSheet, arg);
  return [evaluateFormulaExpression(workbook, currentSheet, arg)];
}

function formulaArgLooksLikeRange(arg: string): boolean {
  return /^(?:'[^']+'!|[A-Z0-9_ .-]+!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Z]{1,3}\$?[1-9][0-9]*)?$/i.test(arg.trim());
}

function splitFormulaArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inSheetQuote = false;
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
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
    current = current.replace(/\b(SUM|AVERAGE|MIN|MAX|COUNT)\(([^()]+)\)/gi, (match) => {
      const result = evaluateFormulaFunction(workbook, currentSheet, match);
      if (result === undefined) {
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
  const { sheet, range } = parseFormulaRef(workbook, currentSheet, ref);
  if (!sheet || !range) return [undefined];
  const start = parseA1(range.start);
  const end = parseA1(range.end);
  if (!start || !end) return [undefined];
  const values: Array<number | undefined> = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
      values.push(numericCellValue(sheet.getCell(row, col).value));
    }
  }
  return values;
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

function numericCellValue(value: ExcelJS.CellValue): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object" && "result" in value) return numericCellValue(value.result as ExcelJS.CellValue);
  if (value === null || value === undefined || value === "") return 0;
  return undefined;
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
