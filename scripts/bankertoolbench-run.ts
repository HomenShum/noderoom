import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runStagedBankerToolBench, type BankerToolBenchRunnerMode } from "../src/eval/bankerToolBenchRunner";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const mode = optionValue("--mode") as BankerToolBenchRunnerMode | undefined;
const jsonOut = optionValue("--json-out");
const limit = numberOption("--limit");
const clean = args.includes("--clean");

if (!stageRoot || !outputRoot || !mode || !["copy-input-baseline", "apply-agent-output"].includes(mode)) {
  console.error([
    "Usage:",
    "  npm run benchmark:bankertoolbench:run -- --stage-root <stage-dir> --output-root <run-dir> --mode copy-input-baseline|apply-agent-output [--limit 3] [--clean] [--json-out <path>]",
    "",
    "This emits candidate deliverables from staged agent-visible files, then opens evaluator-only rubric/golden metadata for local exact-golden smoke scoring.",
    "It does not run Harbor/Docker, MCP financial tools, or the official Gandalf verifier.",
  ].join("\n"));
  process.exit(2);
}

const report = runStagedBankerToolBench({
  stageRoot,
  outputRoot,
  mode,
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
