import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "./spreadsheetBenchScorer";

export type BankerToolBenchRunnerMode = "copy-input-baseline" | "apply-agent-output";

const supportedDeliverableExtensions = new Set([".xlsx", ".xlsm", ".pptx", ".docx", ".pdf", ".csv", ".png", ".jpg", ".jpeg"]);
const runnerVerifier = "local_exact_or_workbook_semantic_smoke" as const;

export type BankerToolBenchRunnerOptions = {
  stageRoot: string;
  outputRoot: string;
  mode: BankerToolBenchRunnerMode;
  limit?: number;
  clean?: boolean;
  generatedAt?: string;
};

export type BankerToolBenchRunnerTaskResult = {
  taskId: string;
  harborTaskId: string;
  mode: BankerToolBenchRunnerMode;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  candidateManifest?: string;
  score?: BankerToolBenchScore;
  timingsMs: {
    total: number;
  };
  trajectory: Array<{
    step:
      | "read_agent_manifest"
      | "prepare_agent_workspace"
      | "emit_candidate_deliverables"
      | "read_evaluator_manifest"
      | "score_candidate";
    detail: string;
  }>;
  error?: {
    phase: "candidate_generation" | "scoring";
    message: string;
  };
};

export type BankerToolBenchRunnerReport = {
  schema: 1;
  generatedAt?: string;
  stageRoot: string;
  outputRoot: string;
  mode: BankerToolBenchRunnerMode;
  taskCount: number;
  passCount: number;
  passRate: number;
  averageWeightedScore: number;
  harness: {
    toolPolicy: "agent_workspace_until_candidate";
    evaluatorAccess: "after_candidate_emit_only";
    verifier: typeof runnerVerifier;
    packagePolicy: "exact_expected_deliverables";
    supportedDeliverableExtensions: string[];
  };
  warnings: string[];
  results: BankerToolBenchRunnerTaskResult[];
};

export type BankerToolBenchScore = {
  schema: 1;
  generatedAt?: string;
  taskId: string;
  harborTaskId: string;
  verifier: typeof runnerVerifier;
  totals: {
    rubricCriteria: number;
    weightedTotal: number;
    awardedWeight: number;
    exactMatchingGoldenFiles: number;
    acceptedGoldenFiles: number;
    workbookComparedGoldenFiles: number;
    workbookSemanticMatches: number;
    workbookSemanticMismatches: number;
    missingGoldenFiles: number;
    mismatchedGoldenFiles: number;
    expectedDeliverables: number;
    candidateDeliverables: number;
    matchedExpectedDeliverables: number;
    missingExpectedDeliverables: number;
    extraCandidateDeliverables: number;
    duplicateCandidateDeliverables: number;
    unsupportedCandidateDeliverables: number;
  };
  weightedScore: number;
  pass: boolean;
  rubricResults: Array<{
    criterion: string;
    weight: number;
    category?: string;
    passed: boolean;
    reason: string;
  }>;
  deliverables: Array<{
    path: string;
    sha256: string;
    bytes: number;
    extension: string;
    supported: boolean;
  }>;
  expectedDeliverables: Array<{
    name: string;
    extension: string;
    matchedCandidate?: string;
  }>;
  goldenFiles: Array<{
    path: string;
    expectedDeliverable: string;
    matchedCandidate?: string;
    exactMatch: boolean;
    accepted: boolean;
    semanticMatch?: boolean;
    workbookScore?: SpreadsheetBenchWorkbookScore;
  }>;
  warnings: string[];
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
  expectedDeliverables?: Array<{
    name: string;
    extension: string;
    goldenFile: string;
  }>;
};

type AgentOutputManifest = {
  schema: 1;
  deliverables: Array<{
    path: string;
    text?: string;
    sourceInput?: string;
  }>;
};

type StagedTaskPaths = {
  taskDir: string;
  agentManifestPath: string;
  evaluatorManifestPath: string;
};

type AgentWorkspace = {
  agentDir: string;
  manifestPath: string;
};

export async function runStagedBankerToolBench(options: BankerToolBenchRunnerOptions): Promise<BankerToolBenchRunnerReport> {
  const stageRoot = resolve(options.stageRoot);
  const outputRoot = resolve(options.outputRoot);
  if (!existsSync(stageRoot)) throw new Error(`BankerToolBench stage root does not exist: ${options.stageRoot}`);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const tasks = findStagedTasks(stageRoot).slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  const warnings: string[] = [];
  const results: BankerToolBenchRunnerTaskResult[] = [];
  for (const task of tasks) {
    const result = await runTask(stageRoot, outputRoot, task, options);
    if (result.error) warnings.push(`${result.taskDir}: ${result.error.message}`);
    results.push(result);
  }
  const passCount = results.filter((result) => result.score?.pass).length;
  const averageWeightedScore = ratio(
    results.reduce((sum, result) => sum + (result.score?.weightedScore ?? 0), 0),
    results.length,
  );

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    mode: options.mode,
    taskCount: results.length,
    passCount,
    passRate: ratio(passCount, results.length),
    averageWeightedScore,
    harness: {
      toolPolicy: "agent_workspace_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      verifier: runnerVerifier,
      packagePolicy: "exact_expected_deliverables",
      supportedDeliverableExtensions: [...supportedDeliverableExtensions].sort(),
    },
    warnings,
    results,
  };
}

async function runTask(
  stageRoot: string,
  outputRoot: string,
  task: StagedTaskPaths,
  options: BankerToolBenchRunnerOptions,
): Promise<BankerToolBenchRunnerTaskResult> {
  const started = Date.now();
  const trajectory: BankerToolBenchRunnerTaskResult["trajectory"] = [];
  const agent = readJson<AgentManifest>(task.agentManifestPath);
  trajectory.push({ step: "read_agent_manifest", detail: rel(stageRoot, task.agentManifestPath) });
  const taskOutDir = join(outputRoot, rel(join(stageRoot, "tasks"), task.taskDir));
  const agentWorkspace = prepareAgentWorkspace(stageRoot, task, taskOutDir, agent);
  trajectory.push({ step: "prepare_agent_workspace", detail: rel(outputRoot, agentWorkspace.manifestPath) });
  try {
    const candidateManifest = emitCandidateDeliverables({
      stageRoot,
      task,
      taskOutDir,
      agent,
      agentWorkspace,
      mode: options.mode,
    });
    trajectory.push({ step: "emit_candidate_deliverables", detail: rel(outputRoot, candidateManifest) });

    const evaluator = readJson<EvaluatorManifest>(task.evaluatorManifestPath);
    trajectory.push({ step: "read_evaluator_manifest", detail: rel(stageRoot, task.evaluatorManifestPath) });
    const score = await scoreCandidate({
      generatedAt: options.generatedAt,
      taskOutDir,
      candidateManifestPath: candidateManifest,
      evaluatorManifestPath: task.evaluatorManifestPath,
      evaluator,
    });
    trajectory.push({ step: "score_candidate", detail: `${score.totals.awardedWeight}/${score.totals.weightedTotal} weighted points` });
    return {
      taskId: agent.taskId,
      harborTaskId: agent.harborTaskId,
      mode: options.mode,
      taskDir: rel(stageRoot, task.taskDir),
      agentManifest: rel(stageRoot, task.agentManifestPath),
      evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
      candidateManifest: rel(outputRoot, candidateManifest),
      score,
      timingsMs: { total: Date.now() - started },
      trajectory,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      taskId: agent.taskId,
      harborTaskId: agent.harborTaskId,
      mode: options.mode,
      taskDir: rel(stageRoot, task.taskDir),
      agentManifest: rel(stageRoot, task.agentManifestPath),
      evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
      timingsMs: { total: Date.now() - started },
      trajectory,
      error: {
        phase: trajectory.some((step) => step.step === "read_evaluator_manifest") ? "scoring" : "candidate_generation",
        message,
      },
    };
  }
}

function prepareAgentWorkspace(
  stageRoot: string,
  task: StagedTaskPaths,
  taskOutDir: string,
  agent: AgentManifest,
): AgentWorkspace {
  const root = join(taskOutDir, "agent-workspace");
  const agentDir = join(root, "agent");
  const sourceAgentDir = join(task.taskDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const copiedFiles: Array<{ role: "manifest" | "input" | "output_manifest"; path: string }> = [];

  copyFileSync(task.agentManifestPath, join(agentDir, "task.json"));
  copiedFiles.push({ role: "manifest", path: "agent/task.json" });
  for (const file of agent.inputFiles) copiedFiles.push(copyAgentFile(sourceAgentDir, agentDir, file, "input"));
  const outputManifest = join(sourceAgentDir, "output-manifest.json");
  if (existsSync(outputManifest)) {
    copyFileSync(outputManifest, join(agentDir, "output-manifest.json"));
    copiedFiles.push({ role: "output_manifest", path: "agent/output-manifest.json" });
  }

  const manifestPath = join(root, "agent-workspace-manifest.json");
  writeJson(manifestPath, {
    schema: 1,
    taskId: agent.taskId,
    harborTaskId: agent.harborTaskId,
    boundary: "agent_visible_files_only",
    sourceAgentManifest: rel(stageRoot, task.agentManifestPath),
    workspaceAgentManifest: "agent/task.json",
    copiedFiles,
    policy: "candidate generation reads only this workspace; private scoring metadata is opened after candidate emission.",
  });
  return { agentDir, manifestPath };
}

function copyAgentFile(
  sourceAgentDir: string,
  workspaceAgentDir: string,
  manifestPath: string,
  role: "input",
): { role: "input"; path: string } {
  const normalized = manifestPath.replace(/\\/g, "/");
  const source = resolveManifestPath(sourceAgentDir, normalized);
  const target = resolveAgentPath(workspaceAgentDir, normalized);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { role, path: `agent/${normalized}` };
}

function emitCandidateDeliverables(args: {
  stageRoot: string;
  task: StagedTaskPaths;
  taskOutDir: string;
  agent: AgentManifest;
  agentWorkspace: AgentWorkspace;
  mode: BankerToolBenchRunnerMode;
}): string {
  const deliverableDir = join(args.taskOutDir, "deliverables");
  mkdirSync(deliverableDir, { recursive: true });
  const deliverables = args.mode === "copy-input-baseline"
    ? copyInputDeliverables(args.agentWorkspace.agentDir, deliverableDir, args.agent.inputFiles)
    : applyAgentOutputManifest(args.agentWorkspace.agentDir, deliverableDir);
  const candidateManifestPath = join(args.taskOutDir, "candidate-manifest.json");
  writeJson(candidateManifestPath, {
    schema: 1,
    benchmark: "bankertoolbench",
    taskId: args.agent.taskId,
    harborTaskId: args.agent.harborTaskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, args.task.agentManifestPath),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    candidateDeliverables: deliverables,
    note: "Candidate package emitted before private scoring metadata is opened; local exact-or-workbook-semantic verifier smoke is not a Harbor/Gandalf score.",
  });
  return candidateManifestPath;
}

function copyInputDeliverables(agentDir: string, deliverableDir: string, inputFiles: string[]) {
  return inputFiles.map((file, index) => {
    const source = resolveManifestPath(agentDir, file);
    const target = join(deliverableDir, `${String(index + 1).padStart(2, "0")}-${safeFileName(basename(file))}`);
    copyFileSync(source, target);
    return deliverableRecord(deliverableDir, target);
  });
}

function applyAgentOutputManifest(agentDir: string, deliverableDir: string) {
  const manifestPath = join(agentDir, "output-manifest.json");
  if (!existsSync(manifestPath)) throw new Error("apply-agent-output requires agent/output-manifest.json");
  const manifest = readJson<AgentOutputManifest>(manifestPath);
  if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.deliverables) || manifest.deliverables.length === 0) {
    throw new Error("invalid output-manifest schema");
  }
  return manifest.deliverables.map((deliverable) => {
    const target = resolveAgentPath(deliverableDir, deliverable.path);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof deliverable.text === "string") writeFileSync(target, deliverable.text);
    else if (typeof deliverable.sourceInput === "string") copyFileSync(resolveManifestPath(agentDir, deliverable.sourceInput), target);
    else throw new Error(`deliverable ${deliverable.path} must specify text or sourceInput`);
    return deliverableRecord(deliverableDir, target);
  });
}

async function scoreCandidate(args: {
  generatedAt?: string;
  taskOutDir: string;
  candidateManifestPath: string;
  evaluatorManifestPath: string;
  evaluator: EvaluatorManifest;
}): Promise<BankerToolBenchScore> {
  const candidate = readJson<{
    taskId: string;
    harborTaskId: string;
    candidateDeliverables: Array<{ path: string; sha256: string; bytes: number; extension?: string; supported?: boolean }>;
  }>(args.candidateManifestPath);
  const expectedDeliverables = evaluatorExpectedDeliverables(args.evaluator);
  const candidateNameCounts = countBy(candidate.candidateDeliverables.map((deliverable) => normalizedOutputName(deliverable.path)));
  const duplicateCandidateDeliverables = [...candidateNameCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const candidateByName = new Map<string, { path: string; sha256: string; bytes: number; extension: string; supported: boolean }>();
  for (const deliverable of candidate.candidateDeliverables) {
    const key = normalizedOutputName(deliverable.path);
    if (!candidateByName.has(key)) {
      candidateByName.set(key, {
        ...deliverable,
        extension: deliverable.extension ?? extensionOf(deliverable.path),
        supported: deliverable.supported ?? isSupportedDeliverable(deliverable.path),
      });
    }
  }
  const expectedByName = new Set(expectedDeliverables.map((deliverable) => normalizedOutputName(deliverable.name)));
  const unsupportedCandidateDeliverables = candidate.candidateDeliverables.filter((deliverable) => !isSupportedDeliverable(deliverable.path)).length;
  const extraCandidateDeliverables = candidate.candidateDeliverables.filter((deliverable) => !expectedByName.has(normalizedOutputName(deliverable.path))).length;
  const expectedResults = expectedDeliverables.map((expected) => ({
    name: expected.name,
    extension: expected.extension,
    matchedCandidate: candidateByName.get(normalizedOutputName(expected.name))?.path,
  }));
  const goldenFiles = await Promise.all(args.evaluator.goldenFiles.map(async (goldenFile) => {
    const goldenPath = resolveManifestPath(dirname(args.evaluatorManifestPath), goldenFile);
    const expected = expectedDeliverables.find((deliverable) => deliverable.goldenFile === goldenFile) ?? {
      name: outputName(goldenFile),
      extension: extensionOf(goldenFile),
      goldenFile,
    };
    const candidateDeliverable = candidateByName.get(normalizedOutputName(expected.name));
    const candidatePath = candidateDeliverable ? resolveManifestPath(join(args.taskOutDir, "deliverables"), candidateDeliverable.path) : undefined;
    const exactMatch = !!candidateDeliverable && sha256(goldenPath) === candidateDeliverable.sha256;
    const workbookScore = candidatePath && isWorkbookDeliverable(expected.name)
      ? await scoreWorkbookDeliverable({
          taskId: candidate.taskId,
          generatedAt: args.generatedAt,
          candidateWorkbookPath: candidatePath,
          goldWorkbookPath: goldenPath,
        })
      : undefined;
    const semanticMatch = workbookScore?.pass;
    return {
      path: goldenFile,
      expectedDeliverable: expected.name,
      matchedCandidate: candidateDeliverable?.path,
      exactMatch,
      accepted: exactMatch || semanticMatch === true,
      ...(semanticMatch === undefined ? {} : { semanticMatch }),
      ...(workbookScore ? { workbookScore } : {}),
    };
  }));
  const missingGoldenFiles = goldenFiles.filter((file) => !file.matchedCandidate).length;
  const mismatchedGoldenFiles = goldenFiles.filter((file) => file.matchedCandidate && !file.exactMatch).length;
  const exactMatchingGoldenFiles = goldenFiles.filter((file) => file.exactMatch).length;
  const acceptedGoldenFiles = goldenFiles.filter((file) => file.accepted).length;
  const workbookComparedGoldenFiles = goldenFiles.filter((file) => file.workbookScore).length;
  const workbookSemanticMatches = goldenFiles.filter((file) => file.workbookScore?.pass).length;
  const workbookSemanticMismatches = goldenFiles.filter((file) => file.workbookScore && !file.workbookScore.pass).length;
  const missingExpectedDeliverables = expectedResults.filter((deliverable) => !deliverable.matchedCandidate).length;
  const matchedExpectedDeliverables = expectedResults.length - missingExpectedDeliverables;
  const exactPackage =
    expectedResults.length > 0 &&
    missingExpectedDeliverables === 0 &&
    extraCandidateDeliverables === 0 &&
    duplicateCandidateDeliverables === 0 &&
    unsupportedCandidateDeliverables === 0;
  const allGoldenFilesAccepted = goldenFiles.length > 0 && missingGoldenFiles === 0 && acceptedGoldenFiles === goldenFiles.length;
  const packageAndFilesMatch = exactPackage && allGoldenFilesAccepted;
  const awardedWeight = packageAndFilesMatch ? args.evaluator.weightedRubricTotal : 0;
  const warnings = [
    "local_exact_or_workbook_semantic_smoke is a packaging/verifier-boundary smoke; it is not the official Harbor/Gandalf verifier.",
    ...(goldenFiles.length === 0 ? ["no evaluator golden files were available"] : []),
    ...(unsupportedCandidateDeliverables > 0 ? ["candidate package includes unsupported deliverable extensions"] : []),
    ...(extraCandidateDeliverables > 0 ? ["candidate package includes extra deliverables not present in evaluator expected outputs"] : []),
    ...(duplicateCandidateDeliverables > 0 ? ["candidate package includes duplicate deliverable names"] : []),
    ...(workbookSemanticMatches > 0 ? ["one or more workbook deliverables were accepted by semantic workbook scoring despite package hash drift"] : []),
    ...(workbookSemanticMismatches > 0 ? ["one or more workbook deliverables failed semantic workbook scoring"] : []),
  ];
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    taskId: candidate.taskId,
    harborTaskId: candidate.harborTaskId,
    verifier: runnerVerifier,
    totals: {
      rubricCriteria: args.evaluator.rubricItems.length,
      weightedTotal: args.evaluator.weightedRubricTotal,
      awardedWeight,
      exactMatchingGoldenFiles,
      acceptedGoldenFiles,
      workbookComparedGoldenFiles,
      workbookSemanticMatches,
      workbookSemanticMismatches,
      missingGoldenFiles,
      mismatchedGoldenFiles,
      expectedDeliverables: expectedResults.length,
      candidateDeliverables: candidate.candidateDeliverables.length,
      matchedExpectedDeliverables,
      missingExpectedDeliverables,
      extraCandidateDeliverables,
      duplicateCandidateDeliverables,
      unsupportedCandidateDeliverables,
    },
    weightedScore: ratio(awardedWeight, args.evaluator.weightedRubricTotal),
    pass: args.evaluator.weightedRubricTotal > 0 && awardedWeight === args.evaluator.weightedRubricTotal,
    rubricResults: args.evaluator.rubricItems.map((item) => ({
      ...item,
      passed: packageAndFilesMatch,
      reason: packageAndFilesMatch
        ? "candidate package matched evaluator expected deliverables and all golden files by exact hash or workbook semantic scoring"
        : "candidate package did not match evaluator expected deliverables and golden files by exact hash or workbook semantic scoring",
    })),
    deliverables: candidate.candidateDeliverables.map((deliverable) => ({
      ...deliverable,
      extension: deliverable.extension ?? extensionOf(deliverable.path),
      supported: deliverable.supported ?? isSupportedDeliverable(deliverable.path),
    })),
    expectedDeliverables: expectedResults,
    goldenFiles,
    warnings,
  };
}

function findStagedTasks(stageRoot: string): StagedTaskPaths[] {
  const tasksRoot = join(stageRoot, "tasks");
  if (!existsSync(tasksRoot)) throw new Error(`BankerToolBench staged root must contain tasks/: ${stageRoot}`);
  return readdirSync(tasksRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const taskDir = join(tasksRoot, entry.name);
    const agentManifestPath = join(taskDir, "agent", "task.json");
    const evaluatorManifestPath = join(taskDir, "evaluator", "evaluator.json");
    return existsSync(agentManifestPath) && existsSync(evaluatorManifestPath)
      ? [{ taskDir, agentManifestPath, evaluatorManifestPath }]
      : [];
  }).sort((a, b) => a.taskDir.localeCompare(b.taskDir));
}

function deliverableRecord(root: string, path: string) {
  const bytes = statSync(path).size;
  return {
    path: rel(root, path),
    sha256: sha256(path),
    bytes,
    extension: extensionOf(path),
    supported: isSupportedDeliverable(path),
  };
}

function resolveManifestPath(base: string, manifestPath: string | undefined): string {
  if (!manifestPath?.trim()) throw new Error("manifest file path is empty");
  return resolve(base, manifestPath.replace(/\\/g, "/"));
}

function resolveAgentPath(base: string, manifestPath: string): string {
  const root = resolve(base);
  const resolved = resolveManifestPath(root, manifestPath);
  const relPath = relative(root, resolved);
  if (!relPath || relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new Error(`agent manifest path escapes workspace: ${manifestPath}`);
  }
  return resolved;
}

function normalizedOutputName(path: string): string {
  return outputName(path).toLowerCase();
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function evaluatorExpectedDeliverables(evaluator: EvaluatorManifest): Array<{ name: string; extension: string; goldenFile: string }> {
  if (evaluator.expectedDeliverables?.length) {
    return evaluator.expectedDeliverables.map((deliverable) => ({
      name: outputName(deliverable.name),
      extension: deliverable.extension || extensionOf(deliverable.name),
      goldenFile: deliverable.goldenFile,
    }));
  }
  return evaluator.goldenFiles.map((goldenFile) => ({
    name: outputName(goldenFile),
    extension: extensionOf(goldenFile),
    goldenFile,
  }));
}

function outputName(path: string): string {
  return basename(path).replace(/^\d{2}-/, "");
}

function extensionOf(path: string): string {
  const match = basename(path).match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

function isSupportedDeliverable(path: string): boolean {
  return supportedDeliverableExtensions.has(extensionOf(path));
}

function isWorkbookDeliverable(path: string): boolean {
  return [".xlsx", ".xlsm"].includes(extensionOf(path));
}

async function scoreWorkbookDeliverable(args: {
  taskId: string;
  generatedAt?: string;
  candidateWorkbookPath: string;
  goldWorkbookPath: string;
}): Promise<SpreadsheetBenchWorkbookScore | undefined> {
  try {
    return await scoreSpreadsheetBenchWorkbook({
      taskId: `bankertoolbench/${args.taskId}`,
      candidateWorkbookPath: args.candidateWorkbookPath,
      goldWorkbookPath: args.goldWorkbookPath,
      compareStyles: true,
      compareCharts: true,
      maxMismatches: 25,
      generatedAt: args.generatedAt,
    });
  } catch {
    return undefined;
  }
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(6));
}
