import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { selectSpreadsheetBenchRoutes } from "../src/eval/spreadsheetBenchRouteSelection";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const jsonOut = optionValue("--json-out");
const jsonOnly = args.includes("--json");

if (!stageRoot) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:routes -- --stage-root <staged-dir> [--json-out <path>] [--json]",
    "",
    "Classifies staged SpreadsheetBench tasks into deterministic/model/blocker routes using only agent-visible task manifests.",
  ].join("\n"));
  process.exit(2);
}

const report = selectSpreadsheetBenchRoutes(stageRoot, new Date().toISOString());
const content = `${JSON.stringify(report, null, 2)}\n`;

if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  if (!jsonOnly) console.log(`wrote ${rel(outPath)}`);
}

if (jsonOnly || !jsonOut) {
  console.log(content.trimEnd());
} else {
  const counts = Object.entries(report.routeCounts).map(([route, count]) => `${route}=${count}`).join(", ");
  console.log(`SpreadsheetBench route selection: ${report.taskCount} task(s), ${counts}`);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
