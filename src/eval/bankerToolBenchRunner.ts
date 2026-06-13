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

export type BankerToolBenchRunnerMode = "copy-input-baseline" | "apply-agent-output";

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
    verifier: "local_exact_golden_smoke";
  };
  warnings: string[];
  results: BankerToolBenchRunnerTaskResult[];
};

export type BankerToolBenchScore = {
  schema: 1;
  generatedAt?: string;
  taskId: string;
  harborTaskId: string;
  verifier: "local_exact_golden_smoke";
  totals: {
    rubricCriteria: number;
    weightedTotal: number;
    awardedWeight: number;
    exactMatchingGoldenFiles: number;
    missingGoldenFiles: number;
    mismatchedGoldenFiles: number;
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
  }>;
  goldenFiles: Array<{
    path: string;
    matchedCandidate?: string;
    exactMatch: boolean;
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

export function runStagedBankerToolBench(options: BankerToolBenchRunnerOptions): BankerToolBenchRunnerReport {
  const stageRoot = resolve(options.stageRoot);
  const outputRoot = resolve(options.outputRoot);
  if (!existsSync(stageRoot)) throw new Error(`BankerToolBench stage root does not exist: ${options.stageRoot}`);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const tasks = findStagedTasks(stageRoot).slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  const warnings: string[] = [];
  const results = tasks.map((task) => {
    const result = runTask(stageRoot, outputRoot, task, options);
    if (result.error) warnings.push(`${result.taskDir}: ${result.error.message}`);
    return result;
  });
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
      verifier: "local_exact_golden_smoke",
    },
    warnings,
    results,
  };
}

function runTask(
  stageRoot: string,
  outputRoot: string,
  task: StagedTaskPaths,
  options: BankerToolBenchRunnerOptions,
): BankerToolBenchRunnerTaskResult {
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
    const score = scoreCandidate({
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
    note: "Candidate package emitted before private scoring metadata is opened; local exact-file verifier smoke is not a Harbor/Gandalf score.",
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

function scoreCandidate(args: {
  generatedAt?: string;
  taskOutDir: string;
  candidateManifestPath: string;
  evaluatorManifestPath: string;
  evaluator: EvaluatorManifest;
}): BankerToolBenchScore {
  const candidate = readJson<{
    taskId: string;
    harborTaskId: string;
    candidateDeliverables: Array<{ path: string; sha256: string; bytes: number }>;
  }>(args.candidateManifestPath);
  const candidateByName = new Map(candidate.candidateDeliverables.map((deliverable) => [normalizedOutputName(deliverable.path), deliverable]));
  const goldenFiles = args.evaluator.goldenFiles.map((goldenFile) => {
    const goldenPath = resolveManifestPath(dirname(args.evaluatorManifestPath), goldenFile);
    const candidateDeliverable = candidateByName.get(normalizedOutputName(goldenFile));
    const exactMatch = !!candidateDeliverable && sha256(goldenPath) === candidateDeliverable.sha256;
    return {
      path: goldenFile,
      matchedCandidate: candidateDeliverable?.path,
      exactMatch,
    };
  });
  const missingGoldenFiles = goldenFiles.filter((file) => !file.matchedCandidate).length;
  const mismatchedGoldenFiles = goldenFiles.filter((file) => file.matchedCandidate && !file.exactMatch).length;
  const exactMatchingGoldenFiles = goldenFiles.filter((file) => file.exactMatch).length;
  const allGoldenFilesMatch = goldenFiles.length > 0 && missingGoldenFiles === 0 && mismatchedGoldenFiles === 0;
  const awardedWeight = allGoldenFilesMatch ? args.evaluator.weightedRubricTotal : 0;
  const warnings = [
    "local_exact_golden_smoke is a packaging/verifier-boundary smoke; it is not the official Harbor/Gandalf verifier.",
    ...(goldenFiles.length === 0 ? ["no evaluator golden files were available"] : []),
  ];
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    taskId: candidate.taskId,
    harborTaskId: candidate.harborTaskId,
    verifier: "local_exact_golden_smoke",
    totals: {
      rubricCriteria: args.evaluator.rubricItems.length,
      weightedTotal: args.evaluator.weightedRubricTotal,
      awardedWeight,
      exactMatchingGoldenFiles,
      missingGoldenFiles,
      mismatchedGoldenFiles,
    },
    weightedScore: ratio(awardedWeight, args.evaluator.weightedRubricTotal),
    pass: args.evaluator.weightedRubricTotal > 0 && awardedWeight === args.evaluator.weightedRubricTotal,
    rubricResults: args.evaluator.rubricItems.map((item) => ({
      ...item,
      passed: allGoldenFilesMatch,
      reason: allGoldenFilesMatch
        ? "all evaluator golden files exactly matched candidate deliverables"
        : "candidate deliverables did not exactly match evaluator golden files",
    })),
    deliverables: candidate.candidateDeliverables,
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
  return basename(path).replace(/^\d{2}-/, "").toLowerCase();
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
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
