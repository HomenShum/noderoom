import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { scanBenchmarkContamination } from "../src/eval/benchmarkContamination";

const args = process.argv.slice(2);
const root = optionValue("--root");
const jsonOut = optionValue("--json-out");
const strict = args.includes("--strict");

if (!root) {
  console.error([
    "Usage:",
    "  npm run benchmark:contamination -- --root <staged-or-run-dir> [--json-out <path>] [--strict]",
    "",
    "Checks agent-facing benchmark manifests and candidate metadata for evaluator-only gold/rubric/canary leaks.",
  ].join("\n"));
  process.exit(2);
}

const report = scanBenchmarkContamination(root, {
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

console.log(`benchmark contamination: ${report.leakCount} leak(s) across ${report.checkedFiles} checked file(s)`);
if (strict && report.leakCount > 0) process.exit(1);

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
