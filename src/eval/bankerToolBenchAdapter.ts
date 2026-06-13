import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export type BankerToolBenchAgentTask = {
  id: string;
  harborTaskId: string;
  product?: string;
  workflowCategory?: string;
  workflowSubcategory?: string;
  instruction: string;
  inputFiles: string[];
  hasPromptContext: boolean;
  hasFormattingContext: boolean;
};

export type BankerToolBenchRubricItem = {
  criterion: string;
  weight: number;
  category?: string;
};

export type BankerToolBenchEvaluatorMetadata = {
  promptContext?: string;
  formattingContext?: string;
  canary?: string;
  rubricItems: BankerToolBenchRubricItem[];
  weightedRubricTotal: number;
};

export type BankerToolBenchTask = {
  id: string;
  harborTaskId: string;
  sourceTasksJsonl: string;
  agentTask: BankerToolBenchAgentTask;
  evaluatorMetadata: BankerToolBenchEvaluatorMetadata;
  evaluatorGoldenFiles: string[];
  warnings: string[];
};

export type BankerToolBenchIngestReport = {
  schema: 1;
  generatedAt?: string;
  sourceRoot: string;
  taskCount: number;
  inputFileCount: number;
  evaluatorGoldenFileCount: number;
  rubricCriterionCount: number;
  weightedRubricTotal: number;
  productCounts: Record<string, number>;
  workflowCategoryCounts: Record<string, number>;
  goldIsolation: {
    agentTaskGoldenPathLeaks: number;
    agentTasksExposeGoldenOutputs: boolean;
    agentTaskRubricLeaks: number;
    agentTasksExposeRubricMetadata: boolean;
    agentTaskCanaryLeaks: number;
    agentTasksExposeCanary: boolean;
  };
  warnings: string[];
  sampleAgentTasks: BankerToolBenchAgentTask[];
  tasks?: BankerToolBenchTask[];
};

type ScanOptions = {
  includeTasks?: boolean;
  sampleLimit?: number;
  generatedAt?: string;
};

type RawTask = Record<string, unknown>;

export function scanBankerToolBenchBundle(rootDir: string, options: ScanOptions = {}): BankerToolBenchIngestReport {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`BankerToolBench root does not exist: ${rootDir}`);
  if (!statSync(root).isDirectory()) throw new Error(`BankerToolBench root is not a directory: ${rootDir}`);

  const tasksJsonl = join(root, "tasks.jsonl");
  if (!existsSync(tasksJsonl)) throw new Error("BankerToolBench root must contain tasks.jsonl");

  const taskDataRoot = join(root, "task-data");
  const goldenRoot = join(root, "golden-outputs");
  const rows = readJsonl(tasksJsonl);
  const tasks = rows.flatMap((row) => taskFromRow(root, tasksJsonl, taskDataRoot, goldenRoot, row));
  const warnings = tasks.flatMap((task) => task.warnings.map((warning) => `${task.id}: ${warning}`));
  const productCounts: Record<string, number> = {};
  const workflowCategoryCounts: Record<string, number> = {};
  for (const task of tasks) {
    productCounts[task.agentTask.product || "uncategorized"] = (productCounts[task.agentTask.product || "uncategorized"] ?? 0) + 1;
    workflowCategoryCounts[task.agentTask.workflowCategory || "uncategorized"] =
      (workflowCategoryCounts[task.agentTask.workflowCategory || "uncategorized"] ?? 0) + 1;
  }
  const agentTaskGoldenPathLeaks = tasks.filter((task) => task.agentTask.inputFiles.some(isGoldenPath)).length;
  const agentTaskRubricLeaks = tasks.filter((task) => agentTaskContainsRubricMetadata(task.agentTask)).length;
  const agentTaskCanaryLeaks = tasks.filter((task) => agentTaskContainsCanary(task.agentTask)).length;
  const sampleLimit = options.sampleLimit ?? 12;

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    sourceRoot: basename(root),
    taskCount: tasks.length,
    inputFileCount: sum(tasks, (task) => task.agentTask.inputFiles.length),
    evaluatorGoldenFileCount: sum(tasks, (task) => task.evaluatorGoldenFiles.length),
    rubricCriterionCount: sum(tasks, (task) => task.evaluatorMetadata.rubricItems.length),
    weightedRubricTotal: sum(tasks, (task) => task.evaluatorMetadata.weightedRubricTotal),
    productCounts,
    workflowCategoryCounts,
    goldIsolation: {
      agentTaskGoldenPathLeaks,
      agentTasksExposeGoldenOutputs: agentTaskGoldenPathLeaks > 0,
      agentTaskRubricLeaks,
      agentTasksExposeRubricMetadata: agentTaskRubricLeaks > 0,
      agentTaskCanaryLeaks,
      agentTasksExposeCanary: agentTaskCanaryLeaks > 0,
    },
    warnings,
    sampleAgentTasks: tasks.slice(0, sampleLimit).map((task) => task.agentTask),
    ...(options.includeTasks ? { tasks } : {}),
  };
}

function taskFromRow(
  root: string,
  tasksJsonl: string,
  taskDataRoot: string,
  goldenRoot: string,
  row: RawTask,
): BankerToolBenchTask[] {
  const id = optionalString(row, "task_id");
  if (!id) return [];
  const finalPrompt = optionalString(row, "final_prompt");
  if (!finalPrompt) {
    return [{
      id,
      harborTaskId: harborTaskId(id),
      sourceTasksJsonl: rel(root, tasksJsonl),
      agentTask: {
        id,
        harborTaskId: harborTaskId(id),
        instruction: "",
        inputFiles: [],
        hasPromptContext: false,
        hasFormattingContext: false,
      },
      evaluatorMetadata: { rubricItems: [], weightedRubricTotal: 0 },
      evaluatorGoldenFiles: [],
      warnings: ["missing final_prompt"],
    }];
  }
  const rubricItems = parseRubricItems(optionalString(row, "aggregated_rubric_json"));
  const promptContext = normalizeContext(optionalString(row, "prompt_context"));
  const formattingContext = normalizeContext(optionalString(row, "formatting_context"));
  const taskDataDir = join(taskDataRoot, id);
  const inputFiles = collectInputFiles(taskDataDir).map((file) => rel(root, file));
  const evaluatorGoldenFiles = collectGoldenFiles(join(goldenRoot, id)).map((file) => rel(root, file));
  const warnings = missingPathWarnings(taskDataDir, inputFiles, rubricItems, evaluatorGoldenFiles);
  return [{
    id,
    harborTaskId: harborTaskId(id),
    sourceTasksJsonl: rel(root, tasksJsonl),
    agentTask: {
      id,
      harborTaskId: harborTaskId(id),
      product: optionalString(row, "product"),
      workflowCategory: optionalString(row, "workflow_cat"),
      workflowSubcategory: optionalString(row, "workflow_subcat"),
      instruction: finalPrompt,
      inputFiles,
      hasPromptContext: !!promptContext,
      hasFormattingContext: !!formattingContext,
    },
    evaluatorMetadata: {
      promptContext,
      formattingContext,
      canary: optionalString(row, "canary"),
      rubricItems,
      weightedRubricTotal: rubricItems.reduce((total, item) => total + item.weight, 0),
    },
    evaluatorGoldenFiles,
    warnings,
  }];
}

function collectInputFiles(taskDataDir: string): string[] {
  const inputDir = findInputDir(taskDataDir);
  return inputDir ? walkFiles(inputDir) : [];
}

function collectGoldenFiles(goldenDir: string): string[] {
  return existsSync(goldenDir) && statSync(goldenDir).isDirectory() ? walkFiles(goldenDir) : [];
}

function findInputDir(taskDataDir: string): string | undefined {
  if (!existsSync(taskDataDir) || !statSync(taskDataDir).isDirectory()) return undefined;
  for (const item of readdirSync(taskDataDir, { withFileTypes: true })) {
    if (item.isDirectory() && item.name.trim().toLowerCase() === "input") return join(taskDataDir, item.name);
    if (item.isDirectory() && item.name.trim().toLowerCase() === "inputs") return join(taskDataDir, item.name);
  }
  return undefined;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walkFiles(full));
    else if (item.isFile()) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function parseRubricItems(raw: string | undefined): BankerToolBenchRubricItem[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const criterion = optionalString(row, "criterion");
    const weight = numericWeight(row.weight);
    if (!criterion || weight <= 0) return [];
    return [{ criterion, weight, category: optionalString(row, "category") }];
  });
}

function numericWeight(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function agentTaskContainsRubricMetadata(task: BankerToolBenchAgentTask): boolean {
  return Object.keys(task).some((key) => /rubric|criterion|weight|canary/i.test(key));
}

function agentTaskContainsCanary(task: BankerToolBenchAgentTask): boolean {
  return JSON.stringify(task).toLowerCase().includes("canary");
}

function isGoldenPath(file: string): boolean {
  return /(^|[/\\])golden-outputs([/\\]|$)|(^|[/\\])gold(en)?([/\\]|$)/i.test(file);
}

function normalizeContext(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.trim().toLowerCase() === "prompt_context") return undefined;
  return value.trim() || undefined;
}

function readJsonl(file: string): RawTask[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawTask);
}

function optionalString(row: RawTask, key: string): string | undefined {
  const value = row[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function harborTaskId(id: string): string {
  return `btb-${id.split("-")[0]}`;
}

function missingPathWarnings(
  taskDataDir: string,
  inputFiles: string[],
  rubricItems: BankerToolBenchRubricItem[],
  evaluatorGoldenFiles: string[],
): string[] {
  const warnings: string[] = [];
  if (!existsSync(taskDataDir)) warnings.push(`missing task-data directory: ${taskDataDir}`);
  if (inputFiles.length === 0) warnings.push("no agent input files found");
  if (rubricItems.length === 0) warnings.push("no weighted rubric criteria found");
  if (evaluatorGoldenFiles.length === 0) warnings.push("no evaluator golden outputs found");
  return warnings;
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((total, item) => total + fn(item), 0);
}
