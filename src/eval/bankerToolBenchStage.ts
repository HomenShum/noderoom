import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { scanBankerToolBenchBundle, type BankerToolBenchTask } from "./bankerToolBenchAdapter";

export type BankerToolBenchStageOptions = {
  outputRoot: string;
  limit?: number;
  clean?: boolean;
  generatedAt?: string;
};

export type BankerToolBenchStagedTask = {
  id: string;
  harborTaskId: string;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  agentInputFiles: string[];
  evaluatorGoldenFiles: string[];
  warnings: string[];
};

export type BankerToolBenchStageReport = {
  schema: 1;
  generatedAt?: string;
  sourceRoot: string;
  outputRoot: string;
  scannedTaskCount: number;
  stagedTaskCount: number;
  skippedTaskCount: number;
  agentFileCount: number;
  evaluatorGoldenFileCount: number;
  rubricCriterionCount: number;
  weightedRubricTotal: number;
  isolation: {
    agentDirectoryGoldenFileCount: number;
    agentManifestGoldenPathLeaks: number;
    agentManifestRubricLeaks: number;
    agentManifestCanaryLeaks: number;
    agentEvaluatorPathOverlap: boolean;
  };
  warnings: string[];
  tasks: BankerToolBenchStagedTask[];
};

type AgentManifest = {
  schema: 1;
  taskId: string;
  benchmark: "bankertoolbench";
  harborTaskId: string;
  product?: string;
  workflowCategory?: string;
  workflowSubcategory?: string;
  instruction: string;
  inputFiles: string[];
};

type EvaluatorManifest = {
  schema: 1;
  taskId: string;
  benchmark: "bankertoolbench";
  harborTaskId: string;
  promptContext?: string;
  formattingContext?: string;
  canary?: string;
  rubricItems: Array<{ criterion: string; weight: number; category?: string }>;
  weightedRubricTotal: number;
  goldenFiles: string[];
  expectedDeliverables: Array<{
    name: string;
    extension: string;
    goldenFile: string;
  }>;
};

export function stageBankerToolBenchBundle(rootDir: string, options: BankerToolBenchStageOptions): BankerToolBenchStageReport {
  const sourceRoot = resolve(rootDir);
  const outputRoot = resolve(options.outputRoot);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const ingest = scanBankerToolBenchBundle(sourceRoot, {
    includeTasks: true,
    sampleLimit: 0,
    generatedAt: options.generatedAt,
  });
  const allTasks = ingest.tasks ?? [];
  const eligible = allTasks.filter((task) => task.agentTask.inputFiles.length > 0 && task.evaluatorMetadata.rubricItems.length > 0);
  const selected = eligible.slice(0, options.limit ?? eligible.length);
  const staged = selected.map((task) => stageTask(sourceRoot, outputRoot, task));
  const warnings = [
    ...ingest.warnings,
    ...allTasks
      .filter((task) => task.agentTask.inputFiles.length === 0 || task.evaluatorMetadata.rubricItems.length === 0)
      .map((task) => `${task.id}: skipped because agent input files or weighted rubric criteria are missing`),
    ...staged.flatMap((task) => task.warnings.map((warning) => `${task.id}: ${warning}`)),
  ];
  const agentDirectoryGoldenFileCount = staged.reduce((sum, task) =>
    sum + task.agentInputFiles.filter((file) => /gold|golden|golden-outputs/i.test(file)).length, 0);
  const agentManifestGoldenPathLeaks = staged.filter((task) => manifestLeaksGolden(join(outputRoot, task.agentManifest))).length;
  const agentManifestRubricLeaks = staged.filter((task) => manifestLeaksRubric(join(outputRoot, task.agentManifest))).length;
  const agentManifestCanaryLeaks = staged.filter((task) => manifestLeaksCanary(join(outputRoot, task.agentManifest))).length;
  const agentEvaluatorPathOverlap = staged.some((task) =>
    task.agentInputFiles.some((agentPath) => task.evaluatorGoldenFiles.includes(agentPath)));

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    sourceRoot: basename(sourceRoot),
    outputRoot: basename(outputRoot),
    scannedTaskCount: ingest.taskCount,
    stagedTaskCount: staged.length,
    skippedTaskCount: allTasks.length - staged.length,
    agentFileCount: staged.reduce((sum, task) => sum + task.agentInputFiles.length, 0),
    evaluatorGoldenFileCount: staged.reduce((sum, task) => sum + task.evaluatorGoldenFiles.length, 0),
    rubricCriterionCount: selected.reduce((sum, task) => sum + task.evaluatorMetadata.rubricItems.length, 0),
    weightedRubricTotal: selected.reduce((sum, task) => sum + task.evaluatorMetadata.weightedRubricTotal, 0),
    isolation: {
      agentDirectoryGoldenFileCount,
      agentManifestGoldenPathLeaks,
      agentManifestRubricLeaks,
      agentManifestCanaryLeaks,
      agentEvaluatorPathOverlap,
    },
    warnings,
    tasks: staged,
  };
}

function stageTask(sourceRoot: string, outputRoot: string, task: BankerToolBenchTask): BankerToolBenchStagedTask {
  const taskDir = `tasks/${safeId(task.harborTaskId)}`;
  const agentDir = join(outputRoot, taskDir, "agent");
  const evaluatorDir = join(outputRoot, taskDir, "evaluator");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  mkdirSync(join(evaluatorDir, "golden-outputs"), { recursive: true });

  const warnings: string[] = [];
  const agentInputFiles = copyFiles(sourceRoot, task.agentTask.inputFiles, join(agentDir, "inputs"), warnings)
    .map((file) => rel(outputRoot, file));
  const evaluatorGoldenFiles = copyFiles(sourceRoot, task.evaluatorGoldenFiles, join(evaluatorDir, "golden-outputs"), warnings)
    .map((file) => rel(outputRoot, file));
  const agentManifest: AgentManifest = {
    schema: 1,
    benchmark: "bankertoolbench",
    taskId: task.id,
    harborTaskId: task.harborTaskId,
    product: task.agentTask.product,
    workflowCategory: task.agentTask.workflowCategory,
    workflowSubcategory: task.agentTask.workflowSubcategory,
    instruction: task.agentTask.instruction,
    inputFiles: agentInputFiles.map((file) => rel(join(outputRoot, taskDir, "agent"), join(outputRoot, file))),
  };
  const evaluatorManifest: EvaluatorManifest = {
    schema: 1,
    benchmark: "bankertoolbench",
    taskId: task.id,
    harborTaskId: task.harborTaskId,
    promptContext: task.evaluatorMetadata.promptContext,
    formattingContext: task.evaluatorMetadata.formattingContext,
    canary: task.evaluatorMetadata.canary,
    rubricItems: task.evaluatorMetadata.rubricItems,
    weightedRubricTotal: task.evaluatorMetadata.weightedRubricTotal,
    goldenFiles: evaluatorGoldenFiles.map((file) => rel(join(outputRoot, taskDir, "evaluator"), join(outputRoot, file))),
    expectedDeliverables: evaluatorGoldenFiles.map((file) => {
      const evaluatorPath = rel(join(outputRoot, taskDir, "evaluator"), join(outputRoot, file));
      return {
        name: outputName(evaluatorPath),
        extension: extensionOf(evaluatorPath),
        goldenFile: evaluatorPath,
      };
    }),
  };
  const agentManifestPath = join(agentDir, "task.json");
  const evaluatorManifestPath = join(evaluatorDir, "evaluator.json");
  writeJson(agentManifestPath, agentManifest);
  writeJson(evaluatorManifestPath, evaluatorManifest);

  return {
    id: task.id,
    harborTaskId: task.harborTaskId,
    taskDir,
    agentManifest: rel(outputRoot, agentManifestPath),
    evaluatorManifest: rel(outputRoot, evaluatorManifestPath),
    agentInputFiles,
    evaluatorGoldenFiles,
    warnings,
  };
}

function copyFiles(sourceRoot: string, sourceFiles: string[], destinationDir: string, warnings: string[]): string[] {
  return sourceFiles.flatMap((sourceFile, index) => {
    const source = join(sourceRoot, sourceFile);
    if (!existsSync(source)) {
      warnings.push(`missing source file for copy: ${sourceFile}`);
      return [];
    }
    const target = join(destinationDir, `${String(index + 1).padStart(2, "0")}-${safeFileName(basename(sourceFile))}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return [target];
  });
}

function manifestLeaksGolden(path: string): boolean {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const forbiddenKeys = Object.keys(parsed).some((key) => /gold|golden|evaluator/i.test(key));
  const fileValues = stringArray(parsed.inputFiles);
  return forbiddenKeys || fileValues.some((file) => /gold|golden|golden-outputs/i.test(file));
}

function manifestLeaksRubric(path: string): boolean {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return ["rubricItems", "weightedRubricTotal", "criterion", "weight", "promptContext", "formattingContext"].some((key) => key in parsed);
}

function manifestLeaksCanary(path: string): boolean {
  return readFileSync(path, "utf8").toLowerCase().includes("canary");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "task";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function outputName(path: string): string {
  return basename(path).replace(/^\d{2}-/, "");
}

function extensionOf(path: string): string {
  const match = basename(path).match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}
