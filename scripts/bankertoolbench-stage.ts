import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { stageBankerToolBenchBundle } from "../src/eval/bankerToolBenchStage";

const args = process.argv.slice(2);
const root = optionValue("--root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const limit = numberOption("--limit");
const clean = args.includes("--clean");

if (!root || !outputRoot) {
  console.error([
    "Usage:",
    "  npm run benchmark:bankertoolbench:stage -- --root <btb-data-root> --output-root <stage-dir> [--limit 3] [--clean] [--json-out <path>]",
    "",
    "This creates separate agent/ and evaluator/ directories. Agent manifests contain only the final prompt and input files; evaluator manifests contain prompt context, formatting context, canary, weighted rubric, and golden outputs.",
  ].join("\n"));
  process.exit(2);
}

const report = stageBankerToolBenchBundle(root, {
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
  report.isolation.agentDirectoryGoldenFileCount > 0 ||
  report.isolation.agentManifestGoldenPathLeaks > 0 ||
  report.isolation.agentManifestRubricLeaks > 0 ||
  report.isolation.agentManifestCanaryLeaks > 0 ||
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
