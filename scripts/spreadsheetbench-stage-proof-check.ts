import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { verifySpreadsheetBenchStageProof } from "../src/eval/spreadsheetBenchStageProof";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

const args = process.argv.slice(2);
const reportPath = optionValue("--report");
const stageRoot = optionValue("--stage-root");
const jsonOut = optionValue("--json-out");
const track = optionValue("--track") as SpreadsheetBenchTrack | undefined;
const minTasks = numberOption("--min-tasks") ?? 1;

if (!reportPath) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:stage-proof -- --report <stage-report.json> [--stage-root <staged-dir>] [--track spreadsheetbench-v1|spreadsheetbench-v2] [--min-tasks 400] [--json-out <path>]",
    "",
    "Validates that a SpreadsheetBench stage report covers enough official tasks and preserves agent/evaluator isolation.",
  ].join("\n"));
  process.exit(2);
}

const proof = verifySpreadsheetBenchStageProof({
  reportPath,
  stageRoot,
  track,
  minTasks,
});

const content = `${JSON.stringify(proof, null, 2)}\n`;
if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`wrote ${rel(outPath)}`);
}

if (!proof.ok) {
  console.error(`SpreadsheetBench stage proof failed:\n- ${proof.failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`SpreadsheetBench stage proof passed: ${proof.stagedTaskCount}/${proof.scannedTaskCount} staged task(s), agentFiles=${proof.agentFileCount}, goldFiles=${proof.evaluatorGoldFileCount}`);
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
