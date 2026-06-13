import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "./spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { AgentModel, TokenUsage } from "../agent/types";
import { priceRun } from "../agent/model";

export type SpreadsheetBenchRunnerMode = "copy-input-baseline" | "apply-agent-patch" | "model-edit-plan";

export type SpreadsheetBenchRunnerOptions = {
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
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
      const result = await runTask(stageRoot, outputRoot, task, options);
      if (result.error) warnings.push(`${result.taskDir}: ${result.error.message}`);
      results.push(result);
    } catch (error) {
      warnings.push(`${rel(stageRoot, task.taskDir)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
    : 0;
  const usage = aggregateUsage(results);
  return {
    schema: 1,
    generatedAt: options.generatedAt,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    mode: options.mode,
    taskCount: results.length,
    passCount: results.filter((result) => result.score?.pass).length,
    averageOverall,
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
      maxMismatches: options.maxMismatches,
      generatedAt: options.generatedAt,
    });
  } catch (error) {
    return failedTaskResult({
      stageRoot,
      task,
      agent,
      mode: options.mode,
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
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
}): Promise<string | ModelCandidateEmission> | string {
  const firstInput = args.agent.inputFiles[0];
  if (!firstInput) throw new Error(`agent manifest has no input workbook: ${args.agent.taskId}`);
  const source = resolveManifestPath(join(args.taskDir, "agent"), firstInput);
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

async function emitModelEditCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
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
  const promptFiles = readPromptFiles(join(args.taskDir, "agent"), args.agent.promptFiles);
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
  try {
    if (step.toolCalls.length) throw new Error(`model-edit-plan expected JSON text, got ${step.toolCalls.length} tool call(s)`);
    const plan = parseEditPlanText(step.text ?? "", args.agent.taskId);
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
      generatedEditPlan: basename(editPlanPath),
      candidateWorkbook: basename(args.target),
      appliedOperationCount: plan.operations.length,
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
    if (!/^[A-Z]{1,3}[1-9][0-9]*$/i.test(operation.cell)) {
      throw new Error(`edit-plan operation ${index + 1} has invalid cell: ${operation.cell}`);
    }
    if (operation.formula === undefined && !("value" in operation)) {
      throw new Error(`edit-plan operation ${index + 1} must set value or formula`);
    }
  }
}

type WorkbookSnapshot = {
  sheets: Array<{
    name: string;
    cells: Array<{ address: string; value: string; formula?: string; numFmt?: string }>;
  }>;
  cellCount: number;
  truncated: boolean;
};

async function snapshotWorkbook(path: string, maxCells = 240): Promise<WorkbookSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheets: WorkbookSnapshot["sheets"] = [];
  let cellCount = 0;
  let truncated = false;
  for (const sheet of workbook.worksheets) {
    const cells: WorkbookSnapshot["sheets"][number]["cells"] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cellCount >= maxCells) {
          truncated = true;
          return;
        }
        cells.push({
          address: cell.address,
          value: cellValueForPrompt(cell.value),
          ...(cellFormula(cell.value) ? { formula: cellFormula(cell.value) } : {}),
          ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
        });
        cellCount += 1;
      });
    });
    if (cells.length) sheets.push({ name: sheet.name, cells });
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
  const jsonText = cleaned.startsWith("{") ? cleaned : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  if (!jsonText.startsWith("{")) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  return JSON.parse(jsonText) as AgentEditPlan;
}

function applyOperation(workbook: ExcelJS.Workbook, operation: AgentEditOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`edit-plan references missing sheet: ${operation.sheet}`);
  const cell = sheet.getCell(operation.cell);
  if (operation.formula !== undefined) cell.value = { formula: operation.formula, result: operation.result ?? undefined };
  else cell.value = operation.value ?? null;
  if (operation.numFmt) cell.numFmt = operation.numFmt;
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  const calls = results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0);
  const inputTokens = results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0);
  const costUsd = Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8));
  return { calls, inputTokens, outputTokens, costUsd };
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
