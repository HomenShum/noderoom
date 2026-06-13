import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { stageSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchStage";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

const args = process.argv.slice(2);
const root = optionValue("--root");
const track = optionValue("--track") as SpreadsheetBenchTrack | undefined;
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const limit = numberOption("--limit");
const clean = args.includes("--clean");

if (!root || !track || !outputRoot || !["spreadsheetbench-v1", "spreadsheetbench-v2"].includes(track)) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:stage -- --track spreadsheetbench-v1 --root <extracted-v1-root> --output-root <stage-dir> [--limit 3] [--clean] [--json-out <path>]",
    "  npm run benchmark:spreadsheetbench:stage -- --track spreadsheetbench-v2 --root <extracted-v2-root> --output-root <stage-dir> [--limit 3] [--clean] [--json-out <path>]",
    "",
    "This creates separate agent/ and evaluator/ directories. Agent manifests contain only instructions, prompts, and input workbooks; evaluator manifests contain golden workbooks and scorer metadata.",
  ].join("\n"));
  process.exit(2);
}

const report = stageSpreadsheetBenchBundle(root, {
  track,
  outputRoot,
  limit,
  clean,
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

if (
  report.isolation.agentDirectoryGoldFileCount > 0 ||
  report.isolation.agentManifestGoldPathLeaks > 0 ||
  report.isolation.agentManifestScorerMetadataLeaks > 0 ||
  report.isolation.agentEvaluatorPathOverlap
) {
  process.exitCode = 1;
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
