import "./benchmark/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runStagedSpreadsheetBench, type SpreadsheetBenchRunnerMode } from "../src/eval/spreadsheetBenchRunner";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const mode = (optionValue("--mode") ?? "copy-input-baseline") as SpreadsheetBenchRunnerMode;
const modelId = optionValue("--model");
const modelTimeoutMs = numberOption("--model-timeout-ms") ?? 120_000;
const limit = numberOption("--limit");
const offset = numberOption("--offset") ?? 0;
const repeats = numberOption("--repeats") ?? 1;
const retryFailed = numberOption("--retry-failed") ?? 0;
const maxMismatches = numberOption("--max-mismatches") ?? 20;
const clean = args.includes("--clean");
const compareStyles = args.includes("--compare-styles");
const compareCharts = args.includes("--compare-charts");
const retryScoreFailures = args.includes("--retry-score-failures");

const allowedModes: SpreadsheetBenchRunnerMode[] = ["copy-input-baseline", "apply-agent-patch", "model-edit-plan"];

if (!stageRoot || !outputRoot || !allowedModes.includes(mode)) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:run -- --stage-root <staged-dir> --output-root <candidate-output-dir> [--mode copy-input-baseline|apply-agent-patch|model-edit-plan] [--model <route>] [--offset 0] [--limit 3] [--repeats 5] [--retry-failed 2] [--retry-score-failures] [--compare-charts] [--clean] [--json-out <path>]",
    "",
    "copy-input-baseline proves runner/export/scoring plumbing.",
    "apply-agent-patch reads agent/edit-plan.json, edits the workbook, emits a candidate, then opens evaluator metadata.",
    "model-edit-plan asks the configured model to emit that edit plan from the staged agent bundle.",
    "Neither mode is an official model score unless the edit plan was produced by a benchmark runner under the recorded model/tool policy.",
  ].join("\n"));
  process.exit(2);
}

if (mode === "model-edit-plan" && !modelId) {
  console.error("model-edit-plan requires --model <route>.");
  process.exit(2);
}

const agentModel = modelId ? (await import("../src/agent/model")).model(modelId) : undefined;

const report = await runStagedSpreadsheetBench({
  stageRoot,
  outputRoot,
  mode,
  model: agentModel,
  modelName: modelId,
  modelTimeoutMs,
  limit,
  offset,
  repeats,
  retryFailed,
  retryScoreFailures,
  clean,
  compareStyles,
  compareCharts,
  maxMismatches,
  generatedAt: new Date().toISOString(),
});

const content = `${JSON.stringify(report, null, 2)}\n`;
if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`wrote ${rel(outPath)}`);
} else {
  process.stdout.write(content);
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
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
