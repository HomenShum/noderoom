import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "./spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";

export type SpreadsheetBenchRunnerMode = "copy-input-baseline" | "apply-agent-patch";

export type SpreadsheetBenchRunnerOptions = {
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  limit?: number;
  clean?: boolean;
  compareStyles?: boolean;
  maxMismatches?: number;
  generatedAt?: string;
};

export type SpreadsheetBenchRunnerTaskResult = {
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  mode: SpreadsheetBenchRunnerMode;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  candidateWorkbook: string;
  score: SpreadsheetBenchWorkbookScore;
  timingsMs: {
    candidateGeneration: number;
    scoring: number;
    total: number;
  };
  trajectory: Array<{
    step: "read_agent_manifest" | "read_agent_edit_plan" | "emit_candidate_workbook" | "read_evaluator_manifest" | "score_candidate";
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
  harness: {
    toolPolicy: "agent_dir_only_until_candidate";
    evaluatorAccess: "after_candidate_emit_only";
    budget: {
      modelCalls: 0;
      providerCostUsd: 0;
    };
  };
  warnings: string[];
  results: SpreadsheetBenchRunnerTaskResult[];
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
  const warnings: string[] = [];
  const results: SpreadsheetBenchRunnerTaskResult[] = [];
  for (const task of tasks) {
    try {
      results.push(await runTask(stageRoot, outputRoot, task, options));
    } catch (error) {
      warnings.push(`${rel(stageRoot, task.taskDir)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + result.score.scores.overall, 0) / results.length).toFixed(6))
    : 0;
  return {
    schema: 1,
    generatedAt: options.generatedAt,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    mode: options.mode,
    taskCount: results.length,
    passCount: results.filter((result) => result.score.pass).length,
    averageOverall,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      budget: {
        modelCalls: 0,
        providerCostUsd: 0,
      },
    },
    warnings,
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
): Promise<SpreadsheetBenchRunnerTaskResult> {
  const started = Date.now();
  const trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"] = [];
  const agent = readJson<AgentManifest>(task.agentManifestPath);
  trajectory.push({ step: "read_agent_manifest", detail: rel(stageRoot, task.agentManifestPath) });
  const generationStarted = Date.now();
  const taskOutDir = join(outputRoot, rel(join(stageRoot, "tasks"), task.taskDir));
  const candidateWorkbook = emitCandidateWorkbook({
    stageRoot,
    taskDir: task.taskDir,
    taskOutDir,
    agent,
    mode: options.mode,
    trajectory,
  });
  const resolvedCandidateWorkbook = await candidateWorkbook;
  const generationMs = Date.now() - generationStarted;
  trajectory.push({ step: "emit_candidate_workbook", detail: rel(outputRoot, resolvedCandidateWorkbook) });

  const scoreStarted = Date.now();
  const evaluator = readJson<EvaluatorManifest>(task.evaluatorManifestPath);
  trajectory.push({ step: "read_evaluator_manifest", detail: rel(stageRoot, task.evaluatorManifestPath) });
  const goldWorkbook = resolveManifestPath(dirname(task.evaluatorManifestPath), evaluator.goldFiles[0]);
  const score = await scoreSpreadsheetBenchWorkbook({
    taskId: agent.taskId,
    candidateWorkbookPath: resolvedCandidateWorkbook,
    goldWorkbookPath: goldWorkbook,
    answerPosition: evaluator.answerPosition,
    answerSheet: evaluator.answerSheet,
    compareStyles: options.compareStyles,
    maxMismatches: options.maxMismatches,
    generatedAt: options.generatedAt,
  });
  const scoringMs = Date.now() - scoreStarted;
  trajectory.push({ step: "score_candidate", detail: `${score.totals.mismatches} mismatch(es)` });

  return {
    taskId: agent.taskId,
    track: agent.track,
    category: agent.category,
    mode: options.mode,
    taskDir: rel(stageRoot, task.taskDir),
    agentManifest: rel(stageRoot, task.agentManifestPath),
    evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
    candidateWorkbook: rel(outputRoot, resolvedCandidateWorkbook),
    score,
    timingsMs: {
      candidateGeneration: generationMs,
      scoring: scoringMs,
      total: Date.now() - started,
    },
    trajectory,
  };
}

function emitCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
}): Promise<string> | string {
  const firstInput = args.agent.inputFiles[0];
  if (!firstInput) throw new Error(`agent manifest has no input workbook: ${args.agent.taskId}`);
  const source = resolveManifestPath(join(args.taskDir, "agent"), firstInput);
  if (!existsSync(source)) throw new Error(`agent input workbook does not exist: ${source}`);
  mkdirSync(args.taskOutDir, { recursive: true });
  const target = join(args.taskOutDir, `candidate-${safeFileName(basename(source))}`);
  if (args.mode === "apply-agent-patch") return emitPatchedCandidateWorkbook({ ...args, source, target });
  if (args.mode !== "copy-input-baseline") throw new Error(`Unsupported SpreadsheetBench runner mode: ${args.mode}`);
  copyFileSync(source, target);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    candidateWorkbook: basename(target),
    note: "copy-input-baseline proves runner/export/scoring plumbing only; it is not a model score.",
  });
  return target;
}

async function emitPatchedCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
}): Promise<string> {
  const editPlanPath = join(args.taskDir, "agent", "edit-plan.json");
  if (!existsSync(editPlanPath)) throw new Error(`apply-agent-patch requires agent/edit-plan.json: ${args.agent.taskId}`);
  const plan = readJson<AgentEditPlan>(editPlanPath);
  validateEditPlan(plan, args.agent.taskId);
  args.trajectory.push({ step: "read_agent_edit_plan", detail: rel(args.stageRoot, editPlanPath) });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(args.source);
  for (const operation of plan.operations) applyOperation(workbook, operation);
  await workbook.xlsx.writeFile(args.target);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    sourceEditPlan: rel(args.stageRoot, editPlanPath),
    candidateWorkbook: basename(args.target),
    appliedOperationCount: plan.operations.length,
    note: "apply-agent-patch proves agent-side workbook edit/export/reopen plumbing; it is not an official model score.",
  });
  return args.target;
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
    if (!/^[A-Z]{1,3}[1-9][0-9]*$/i.test(operation.cell)) {
      throw new Error(`edit-plan operation ${index + 1} has invalid cell: ${operation.cell}`);
    }
    if (operation.formula === undefined && !("value" in operation)) {
      throw new Error(`edit-plan operation ${index + 1} must set value or formula`);
    }
  }
}

function applyOperation(workbook: ExcelJS.Workbook, operation: AgentEditOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`edit-plan references missing sheet: ${operation.sheet}`);
  const cell = sheet.getCell(operation.cell);
  if (operation.formula !== undefined) cell.value = { formula: operation.formula, result: operation.result ?? undefined };
  else cell.value = operation.value ?? null;
  if (operation.numFmt) cell.numFmt = operation.numFmt;
}

function resolveManifestPath(base: string, manifestPath: string | undefined): string {
  if (!manifestPath) throw new Error("manifest path is missing");
  return resolve(base, manifestPath.replace(/\\/g, "/"));
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
