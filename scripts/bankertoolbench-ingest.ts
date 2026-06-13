import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { scanBankerToolBenchBundle } from "../src/eval/bankerToolBenchAdapter";

const args = process.argv.slice(2);
const root = optionValue("--root");
const jsonOut = optionValue("--json-out");
const includeTasks = args.includes("--include-tasks");
const sampleLimit = numberOption("--sample-limit") ?? 12;

if (!root) {
  console.error([
    "Usage:",
    "  npm run benchmark:bankertoolbench:ingest -- --root <btb-data-root> [--json-out <path>]",
    "",
    "This scans an already-downloaded BankerToolBench bundle containing tasks.jsonl, task-data/, and optional golden-outputs/.",
    "It does not download Hugging Face data, run Harbor/Docker, run models, or expose rubric/golden/canary metadata to agent-facing task payloads.",
  ].join("\n"));
  process.exit(2);
}

const report = scanBankerToolBenchBundle(root, {
  includeTasks,
  sampleLimit,
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
  report.goldIsolation.agentTasksExposeGoldenOutputs ||
  report.goldIsolation.agentTasksExposeRubricMetadata ||
  report.goldIsolation.agentTasksExposeCanary
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
