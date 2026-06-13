import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { scanSpreadsheetBenchBundle, type SpreadsheetBenchTask, type SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";
import { scoreSpreadsheetBenchWorkbook, type SpreadsheetBenchWorkbookScore } from "../src/eval/spreadsheetBenchScorer";

const args = process.argv.slice(2);
const candidate = optionValue("--candidate");
const gold = optionValue("--gold");
const answerPosition = optionValue("--answer-position");
const answerSheet = optionValue("--answer-sheet");
const root = optionValue("--root");
const track = optionValue("--track") as SpreadsheetBenchTrack | undefined;
const jsonOut = optionValue("--json-out");
const taskId = optionValue("--task-id");
const limit = numberOption("--limit") ?? 3;
const maxMismatches = numberOption("--max-mismatches") ?? 20;
const compareStyles = args.includes("--compare-styles");
const compareCharts = args.includes("--compare-charts");
const generatedAt = new Date().toISOString();

const report = candidate && gold
  ? await scoreSpreadsheetBenchWorkbook({
      taskId,
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition,
      answerSheet,
      compareStyles,
      compareCharts,
      maxMismatches,
      generatedAt,
    })
  : root && track
    ? await scoreBundleBaseline({ root, track, limit, compareStyles, compareCharts, maxMismatches, generatedAt })
    : usage();

writeReport(report);

function usage(): never {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:score -- --candidate <candidate.xlsx> --gold <golden.xlsx> [--answer-position \"'Sheet'!A1:B2\"] [--compare-charts] [--json-out <path>]",
    "  npm run benchmark:spreadsheetbench:score -- --track spreadsheetbench-v1 --root <extracted-v1-root> [--limit 3] [--compare-charts] [--json-out <path>]",
    "",
    "Bundle mode scores the official input workbook as a candidate baseline against evaluator-only gold. It proves open/score wiring; it is not a model score.",
  ].join("\n"));
  process.exit(2);
}

async function scoreBundleBaseline(options: {
  root: string;
  track: SpreadsheetBenchTrack;
  limit: number;
  compareStyles: boolean;
  compareCharts: boolean;
  maxMismatches: number;
  generatedAt: string;
}) {
  const rootPath = resolve(options.root);
  const ingest = scanSpreadsheetBenchBundle(rootPath, {
    track: options.track,
    includeTasks: true,
    sampleLimit: 0,
    generatedAt: options.generatedAt,
  });
  const candidates = (ingest.tasks ?? [])
    .filter((task) => task.agentTask.inputFiles.length > 0 && task.evaluatorGoldFiles.length > 0)
    .slice(0, options.limit);
  const results: SpreadsheetBenchWorkbookScore[] = [];
  for (const task of candidates) {
    results.push(await scoreTask(rootPath, task, options));
  }
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + result.scores.overall, 0) / results.length).toFixed(6))
    : 0;
  return {
    schema: 1,
    generatedAt: options.generatedAt,
    mode: "input-vs-gold-baseline",
    track: options.track,
    sourceRoot: ingest.sourceRoot,
    taskCount: ingest.taskCount,
    scoredTaskCount: results.length,
    passCount: results.filter((result) => result.pass).length,
    averageOverall,
    warningCount: ingest.warnings.length + results.reduce((sum, result) => sum + result.warnings.length, 0),
    warnings: [
      ...ingest.warnings,
      ...results.flatMap((result) => result.warnings.map((warning) => `${result.taskId}: ${warning}`)),
    ],
    results,
  };
}

async function scoreTask(rootPath: string, task: SpreadsheetBenchTask, options: {
  compareStyles: boolean;
  compareCharts: boolean;
  maxMismatches: number;
  generatedAt: string;
}): Promise<SpreadsheetBenchWorkbookScore> {
  return scoreSpreadsheetBenchWorkbook({
    taskId: task.id,
    candidateWorkbookPath: join(rootPath, task.agentTask.inputFiles[0]),
    goldWorkbookPath: join(rootPath, task.evaluatorGoldFiles[0]),
    answerPosition: task.evaluatorMetadata.answerPosition,
    answerSheet: task.evaluatorMetadata.answerSheet,
    compareStyles: options.compareStyles,
    compareCharts: options.compareCharts || task.track === "spreadsheetbench-v2",
    maxMismatches: options.maxMismatches,
    generatedAt: options.generatedAt,
  });
}

function writeReport(report: unknown) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (jsonOut) {
    const outPath = resolve(jsonOut);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content);
    console.log(`wrote ${rel(outPath)}`);
  } else {
    process.stdout.write(content);
  }
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
