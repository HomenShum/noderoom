import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

type SpreadsheetBenchRunReport = {
  schema: number;
  taskCount: number;
  passCount: number;
  passRate: number;
  caseCount: number;
  repeatCount: number;
  attemptCount: number;
  casePassRate: number;
  averageOverall: number;
  stats?: {
    latencyMs?: {
      p95?: number;
    };
    failureCounts?: Record<string, number>;
  };
  retryStats?: {
    retryAttemptCount?: number;
  };
  harness?: {
    budget?: {
      providerCostUsd?: number;
    };
  };
  results?: Array<{
    taskId?: string;
    score?: {
      pass?: boolean;
      totals?: {
        mismatches?: number;
      };
      scores?: {
        overall?: number;
      };
    };
    error?: {
      message?: string;
    };
    model?: {
      name?: string;
      calls?: number;
      costUsd?: number;
    };
  }>;
};

type ContaminationReport = {
  schema: number;
  checkedFiles: number;
  leakCount: number;
};

const args = process.argv.slice(2);
const runPath = optionValue("--run") ?? "docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json";
const contaminationPath = optionValue("--contamination") ?? "docs/eval/spreadsheetbench-v1-run-3task-n5-contamination-smoke.json";
const minTaskCount = numberOption("--min-task-count") ?? 15;
const minCaseCount = numberOption("--min-case-count") ?? 3;
const minRepeatCount = numberOption("--min-repeats") ?? 5;
const minPassRate = numberOption("--min-pass-rate") ?? 1;
const minAverageOverall = numberOption("--min-average-overall") ?? 1;
const maxP95Ms = numberOption("--max-p95-ms") ?? 10_000;
const maxCostUsd = numberOption("--max-cost-usd") ?? 0.06;
const maxRetries = numberOption("--max-retries") ?? 0;
const minCheckedFiles = numberOption("--min-checked-files") ?? 60;

const run = readJson<SpreadsheetBenchRunReport>(runPath);
const contamination = readJson<ContaminationReport>(contaminationPath);
const failures: string[] = [];

expect(run.schema === 1, `run schema must be 1, got ${run.schema}`);
expect(run.taskCount >= minTaskCount, `taskCount ${run.taskCount} < ${minTaskCount}`);
expect(run.caseCount >= minCaseCount, `caseCount ${run.caseCount} < ${minCaseCount}`);
expect(run.repeatCount >= minRepeatCount, `repeatCount ${run.repeatCount} < ${minRepeatCount}`);
expect(run.attemptCount === run.taskCount, `attemptCount ${run.attemptCount} must equal taskCount ${run.taskCount}`);
expect(run.passCount === run.taskCount, `passCount ${run.passCount} must equal taskCount ${run.taskCount}`);
expect(run.passRate >= minPassRate, `passRate ${run.passRate} < ${minPassRate}`);
expect(run.casePassRate >= minPassRate, `casePassRate ${run.casePassRate} < ${minPassRate}`);
expect(run.averageOverall >= minAverageOverall, `averageOverall ${run.averageOverall} < ${minAverageOverall}`);
expect((run.stats?.latencyMs?.p95 ?? Number.POSITIVE_INFINITY) <= maxP95Ms, `p95 ${run.stats?.latencyMs?.p95 ?? "missing"} > ${maxP95Ms}`);
expect((run.harness?.budget?.providerCostUsd ?? Number.POSITIVE_INFINITY) <= maxCostUsd, `providerCostUsd ${run.harness?.budget?.providerCostUsd ?? "missing"} > ${maxCostUsd}`);
expect((run.retryStats?.retryAttemptCount ?? Number.POSITIVE_INFINITY) <= maxRetries, `retryAttemptCount ${run.retryStats?.retryAttemptCount ?? "missing"} > ${maxRetries}`);

const failureCounts = Object.entries(run.stats?.failureCounts ?? {}).filter(([, count]) => count > 0);
expect(failureCounts.length === 0, `failureCounts must be empty, got ${JSON.stringify(Object.fromEntries(failureCounts))}`);
expect(Array.isArray(run.results), "run results must be present");
expect((run.results?.length ?? 0) === run.taskCount, `results length ${run.results?.length ?? "missing"} must equal taskCount ${run.taskCount}`);
for (const [index, result] of (run.results ?? []).entries()) {
  const label = result.taskId ?? `result#${index + 1}`;
  expect(!result.error, `${label} has error ${result.error?.message ?? "unknown"}`);
  expect(result.score?.pass === true, `${label} score.pass must be true`);
  expect((result.score?.totals?.mismatches ?? Number.POSITIVE_INFINITY) === 0, `${label} mismatches must be 0`);
  expect((result.score?.scores?.overall ?? 0) >= minAverageOverall, `${label} overall ${result.score?.scores?.overall ?? "missing"} < ${minAverageOverall}`);
  expect(Boolean(result.model?.name), `${label} must record resolved model name`);
  expect((result.model?.calls ?? 0) > 0, `${label} must record at least one model call`);
}

expect(contamination.schema === 1, `contamination schema must be 1, got ${contamination.schema}`);
expect(contamination.leakCount === 0, `contamination leakCount must be 0, got ${contamination.leakCount}`);
expect(contamination.checkedFiles >= minCheckedFiles, `contamination checkedFiles ${contamination.checkedFiles} < ${minCheckedFiles}`);

if (failures.length > 0) {
  console.error(`SpreadsheetBench proof check failed for ${rel(runPath)} and ${rel(contaminationPath)}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log([
  "SpreadsheetBench proof check passed:",
  `${run.passCount}/${run.taskCount} attempts`,
  `${run.caseCount} case(s) x ${run.repeatCount} repeat(s)`,
  `p95=${run.stats?.latencyMs?.p95}ms`,
  `cost=$${run.harness?.budget?.providerCostUsd}`,
  `leaks=${contamination.leakCount}/${contamination.checkedFiles}`,
].join(" "));

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
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
  return value;
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}
