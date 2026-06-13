import "./benchmark/loadEnv";

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type {
  SpreadsheetBenchRunnerMode,
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
} from "../src/eval/spreadsheetBenchRunner";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const mode = (optionValue("--mode") ?? "copy-input-baseline") as SpreadsheetBenchRunnerMode;
const chunkSize = numberOption("--chunk-size") ?? 25;
const repeats = numberOption("--repeats") ?? 1;
const retryFailed = numberOption("--retry-failed") ?? 0;
const maxMismatches = numberOption("--max-mismatches") ?? 5;
const model = optionValue("--model");
const modelTimeoutMs = numberOption("--model-timeout-ms");
const compareStyles = args.includes("--compare-styles");
const compareCharts = args.includes("--compare-charts");
const retryScoreFailures = args.includes("--retry-score-failures");
const clean = args.includes("--clean");

if (!stageRoot || !outputRoot || !jsonOut || chunkSize <= 0) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:run-chunked -- --stage-root <staged-dir> --output-root <candidate-output-dir> --json-out <report.json> [--mode copy-input-baseline|apply-agent-patch|model-edit-plan] [--chunk-size 25] [--model <route>] [--clean]",
    "",
    "Runs staged SpreadsheetBench tasks in fresh child processes and aggregates the reports.",
  ].join("\n"));
  process.exit(2);
}
if (mode === "model-edit-plan" && !model) {
  console.error("model-edit-plan requires --model <route>.");
  process.exit(2);
}

const stage = resolve(stageRoot);
const output = resolve(outputRoot);
const outPath = resolve(jsonOut);
if (!existsSync(stage)) throw new Error(`stage root does not exist: ${stageRoot}`);
if (clean && existsSync(output)) rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });
const chunkRoot = resolve(output, ".chunks");
rmSync(chunkRoot, { recursive: true, force: true });
mkdirSync(chunkRoot, { recursive: true });

const taskCount = findStagedTaskCount(stage);
const chunkReports: SpreadsheetBenchRunnerReport[] = [];
const chunks: Array<{ index: number; offset: number; limit: number; reportPath: string; taskCount: number; passCount: number; exitCode: number | null }> = [];
for (let offset = 0, index = 1; offset < taskCount; offset += chunkSize, index += 1) {
  const limit = Math.min(chunkSize, taskCount - offset);
  for (const report of runChunk(index, offset, limit)) {
    chunkReports.push(report);
  }
}

const aggregate = aggregateChunkReports({
  generatedAt: new Date().toISOString(),
  stageRoot: basename(stage),
  outputRoot: basename(output),
  mode,
  chunkSize,
  chunks,
  reports: chunkReports,
});
writeFileSync(outPath, `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(`wrote ${rel(outPath)}`);
console.log(`SpreadsheetBench chunked run: ${aggregate.passCount}/${aggregate.taskCount} pass, average=${aggregate.averageOverall}`);

function runChunk(index: number, offset: number, limit: number): SpreadsheetBenchRunnerReport[] {
  const reportPath = resolve(chunkRoot, `chunk-${String(index).padStart(3, "0")}-${offset}-${limit}.json`);
  const childArgs = [
    resolve("node_modules", "tsx", "dist", "cli.mjs"),
    resolve("scripts", "spreadsheetbench-run.ts"),
    "--stage-root",
    stage,
    "--output-root",
    output,
    "--mode",
    mode,
    "--offset",
    String(offset),
    "--limit",
    String(limit),
    "--repeats",
    String(repeats),
    "--retry-failed",
    String(retryFailed),
    "--max-mismatches",
    String(maxMismatches),
    "--json-out",
    reportPath,
    ...(model ? ["--model", model] : []),
    ...(modelTimeoutMs !== undefined ? ["--model-timeout-ms", String(modelTimeoutMs)] : []),
    ...(retryScoreFailures ? ["--retry-score-failures"] : []),
    ...(compareStyles ? ["--compare-styles"] : []),
    ...(compareCharts ? ["--compare-charts"] : []),
  ];
  const child = spawnSync(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 30 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.status !== 0) {
    process.stderr.write(child.stdout ?? "");
    process.stderr.write(child.stderr ?? "");
    if (limit > 1) {
      console.log(`chunk ${index}: offset=${offset} limit=${limit} failed; splitting into single-task chunks`);
      const reports: SpreadsheetBenchRunnerReport[] = [];
      for (let next = offset; next < offset + limit; next += 1) {
        reports.push(...runChunk(index, next, 1));
      }
      return reports;
    }
    const synthetic = syntheticFailedReport(offset, child.status, child.error?.message ?? child.stderr ?? "child process failed");
    chunks.push({
      index,
      offset,
      limit,
      reportPath: "(synthetic child failure)",
      taskCount: synthetic.taskCount,
      passCount: synthetic.passCount,
      exitCode: child.status,
    });
    console.log(`chunk ${index}: offset=${offset} limit=1 failed -> recorded synthetic error`);
    return [synthetic];
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as SpreadsheetBenchRunnerReport;
  chunks.push({
    index,
    offset,
    limit,
    reportPath: rel(reportPath),
    taskCount: report.taskCount,
    passCount: report.passCount,
    exitCode: child.status,
  });
  console.log(`chunk ${index}: offset=${offset} limit=${limit} pass=${report.passCount}/${report.taskCount}`);
  return [report];
}

function aggregateChunkReports(args: {
  generatedAt: string;
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  chunkSize: number;
  chunks: Array<{ index: number; offset: number; limit: number; reportPath: string; taskCount: number; passCount: number; exitCode: number | null }>;
  reports: SpreadsheetBenchRunnerReport[];
}) {
  const results = args.reports.flatMap((report) => report.results);
  const caseRuns = args.reports.flatMap((report) => report.caseRuns);
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const usage = aggregateUsage(results);
  const stats = aggregateStats(results);
  const retryStats = {
    retriedCaseRunCount: args.reports.reduce((sum, report) => sum + report.retryStats.retriedCaseRunCount, 0),
    retryAttemptCount: args.reports.reduce((sum, report) => sum + report.retryStats.retryAttemptCount, 0),
    passedAfterRetryCount: args.reports.reduce((sum, report) => sum + report.retryStats.passedAfterRetryCount, 0),
    exhaustedCaseRunCount: args.reports.reduce((sum, report) => sum + report.retryStats.exhaustedCaseRunCount, 0),
  };
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
    : 0;
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    stageRoot: args.stageRoot,
    outputRoot: args.outputRoot,
    mode: args.mode,
    chunked: true,
    chunkSize: args.chunkSize,
    chunks: args.chunks,
    taskCount: results.length,
    passCount,
    averageOverall,
    caseCount: args.reports.reduce((sum, report) => sum + report.caseCount, 0),
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    repeatCount: args.reports[0]?.repeatCount ?? 1,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryPolicy: args.reports[0]?.retryPolicy,
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
    warnings: args.reports.flatMap((report) => report.warnings),
    caseRuns,
    results,
  };
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  return {
    calls: results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0),
    inputTokens: results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0),
    costUsd: Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8)),
  };
}

function aggregateStats(results: SpreadsheetBenchRunnerTaskResult[]) {
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    failureCounts[result.error.phase] = (failureCounts[result.error.phase] ?? 0) + 1;
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

function syntheticFailedReport(offset: number, exitCode: number | null, rawMessage: string): SpreadsheetBenchRunnerReport {
  const task = stagedTaskAtOffset(offset);
  const agent = readJson<{
    taskId?: string;
    track?: SpreadsheetBenchTrack;
    category?: string;
  }>(task.agentManifestPath);
  const message = previewFailure(rawMessage);
  const result: SpreadsheetBenchRunnerTaskResult = {
    taskId: agent.taskId ?? basename(task.taskDir),
    track: agent.track ?? "spreadsheetbench-v1",
    category: agent.category,
    mode,
    attemptIndex: offset,
    repeatIndex: 0,
    tryIndex: 0,
    taskDir: relTo(stage, task.taskDir),
    agentManifest: relTo(stage, task.agentManifestPath),
    evaluatorManifest: relTo(stage, task.evaluatorManifestPath),
    error: {
      phase: "candidate_generation",
      message: `child process exited ${exitCode ?? "without status"}: ${message}`,
    },
    timingsMs: {
      candidateGeneration: 0,
      scoring: 0,
      total: 0,
    },
    trajectory: [
      { step: "read_agent_manifest", detail: relTo(stage, task.agentManifestPath) },
      { step: "prepare_agent_workspace", detail: "not reached; child process failed before report emission" },
    ],
  };
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    stageRoot: basename(stage),
    outputRoot: basename(output),
    mode,
    taskOffset: offset,
    taskCount: 1,
    passCount: 0,
    averageOverall: 0,
    caseCount: 1,
    caseRunCount: 1,
    casePassCount: 0,
    casePassRate: 0,
    repeatCount: 1,
    attemptCount: 1,
    passRate: 0,
    retryPolicy: {
      maxRetries: retryFailed,
      retryOn: ["candidate_generation", "scoring", ...(retryScoreFailures ? ["score_failure" as const] : [])],
      stopOnPass: true,
    },
    retryStats: {
      retriedCaseRunCount: 0,
      retryAttemptCount: 0,
      passedAfterRetryCount: 0,
      exhaustedCaseRunCount: 0,
    },
    stats: {
      latencyMs: { p50: 0, p95: 0, max: 0 },
      failureCounts: { candidate_generation: 1 },
    },
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      budget: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        providerCostUsd: 0,
      },
    },
    warnings: [
      `chunked runner recorded a synthetic failure for offset ${offset} (${result.taskId}) after a child process failed before writing a report`,
    ],
    caseRuns: [
      {
        taskId: result.taskId,
        taskDir: result.taskDir,
        repeatIndex: 0,
        attempts: [result.attemptIndex],
        finalAttemptIndex: result.attemptIndex,
        pass: false,
        stopReason: "runner_error",
        bestOverall: 0,
      },
    ],
    results: [result],
  };
}

function stagedTaskAtOffset(offset: number): { taskDir: string; agentManifestPath: string; evaluatorManifestPath: string } {
  const tasks = walkDirs(resolve(stage, "tasks"))
    .map((taskDir) => ({
      taskDir,
      agentManifestPath: resolve(taskDir, "agent", "task.json"),
      evaluatorManifestPath: resolve(taskDir, "evaluator", "evaluator.json"),
    }))
    .filter((task) => existsSync(task.agentManifestPath) && existsSync(task.evaluatorManifestPath))
    .sort((a, b) => a.taskDir.localeCompare(b.taskDir));
  const task = tasks[offset];
  if (!task) throw new Error(`no staged SpreadsheetBench task at offset ${offset}; task count is ${tasks.length}`);
  return task;
}

function previewFailure(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized || "child process failed before emitting stderr";
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
}

function findStagedTaskCount(stageRoot: string): number {
  return walkDirs(resolve(stageRoot, "tasks")).filter((dir) =>
    existsSync(resolve(dir, "agent", "task.json")) && existsSync(resolve(dir, "evaluator", "evaluator.json")),
  ).length;
}

function walkDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (!entry.isDirectory()) continue;
    out.push(path, ...walkDirs(path));
  }
  return out;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(value);
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}

function relTo(base: string, path: string): string {
  return relative(resolve(base), resolve(path)).replace(/\\/g, "/");
}
