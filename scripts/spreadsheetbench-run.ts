import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runStagedSpreadsheetBench, type SpreadsheetBenchRunnerMode } from "../src/eval/spreadsheetBenchRunner";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const mode = (optionValue("--mode") ?? "copy-input-baseline") as SpreadsheetBenchRunnerMode;
const limit = numberOption("--limit");
const maxMismatches = numberOption("--max-mismatches") ?? 20;
const clean = args.includes("--clean");
const compareStyles = args.includes("--compare-styles");

if (!stageRoot || !outputRoot || mode !== "copy-input-baseline") {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:run -- --stage-root <staged-dir> --output-root <candidate-output-dir> [--mode copy-input-baseline] [--limit 3] [--clean] [--json-out <path>]",
    "",
    "The current mode is a copy-input baseline. It proves runner/export/scoring plumbing and the agent/evaluator directory boundary; it is not a model score.",
  ].join("\n"));
  process.exit(2);
}

const report = await runStagedSpreadsheetBench({
  stageRoot,
  outputRoot,
  mode,
  limit,
  clean,
  compareStyles,
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
