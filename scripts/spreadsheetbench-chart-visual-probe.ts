import "./benchmark/loadEnv";
import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runSpreadsheetBenchChartVisualProbe } from "../src/eval/spreadsheetBenchChartVisualProbe";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOut = optionValue("--json-out") ?? "docs/eval/spreadsheetbench-chart-visual-probe.json";
const defaultEvidenceDir = join("docs", "eval", "spreadsheetbench-chart-visual", "task-126");

const report = runSpreadsheetBenchChartVisualProbe({
  generatedAt: new Date().toISOString(),
  candidateImagePath: optionValue("--candidate-image") ?? existing(join(defaultEvidenceDir, "candidate-oracle.png")),
  goldImagePath: optionValue("--gold-image") ?? existing(join(defaultEvidenceDir, "gold.png")),
  vlmReportPath: optionValue("--vlm-report") ?? existing(join(defaultEvidenceDir, "vlm-report.json")),
  model: optionValue("--model"),
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${jsonOut}`);
console.log(`SpreadsheetBench chart visual probe: ${report.status}${report.pass ? " pass" : " not-ready"}`);

if (strict && !report.pass) process.exitCode = 1;

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function existing(path: string): string | undefined {
  return existsSync(path) ? path : undefined;
}
