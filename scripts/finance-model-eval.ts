import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  PRIVATE_FINANCE_MODEL_GOLD_ENV,
} from "../evals/financeModelGold";
import {
  makeSyntheticFinanceModelGold,
  runFinanceModelSolveEval,
  type FinanceModelGold,
} from "../evals/financeModelRuntime";

type FormulaCellValue = {
  formula?: string;
  result?: unknown;
};

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function contentHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function formulaText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (typeof value === "string" && value.trim().startsWith("=")) return value.trim();
  if (value && typeof value === "object" && "formula" in value) {
    return String((value as FormulaCellValue).formula ?? "");
  }
  return "";
}

function cachedResult(cell: ExcelJS.Cell): number | string {
  const value = cell.value;
  const raw = value && typeof value === "object" && "result" in value
    ? (value as FormulaCellValue).result
    : value;
  if (typeof raw === "number" || typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  return JSON.stringify(raw);
}

async function readPrivateWorkbookGold(path: string): Promise<FinanceModelGold> {
  if (!existsSync(path)) throw new Error(`finance model gold workbook not found: ${path}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const answer = workbook.getWorksheet("Answer Key");
  if (!answer) throw new Error("private workbook is missing the Answer Key sheet");
  return {
    id: "finance-model-private-workbook",
    title: "Private three-statement model gold pack",
    source: "private_workbook",
    sourceHash: contentHash(path),
    cells: FINANCE_MODEL_CRITICAL_FORMULAS.map((contract) => {
      const cell = answer.getCell(contract.cell);
      return {
        ...contract,
        formula: formulaText(cell),
        value: cachedResult(cell),
      };
    }),
  };
}

async function main() {
  const goldPath = optionValue("--gold") ?? optionValue("--workbook") ?? process.env[PRIVATE_FINANCE_MODEL_GOLD_ENV];
  const gold = goldPath ? await readPrivateWorkbookGold(goldPath) : makeSyntheticFinanceModelGold();
  const report = await runFinanceModelSolveEval(gold);
  const traceOut = optionValue("--trace-out")
    ?? (gold.source === "synthetic"
      ? "docs/eval/traces/finance-model/finance_model_solve_synthetic.json"
      : ".tmp/finance-model/finance_model_solve_private.json");

  if (!hasFlag("--no-trace")) {
    mkdirSync(dirname(traceOut), { recursive: true });
    writeFileSync(traceOut, JSON.stringify({
      generatedAt: new Date().toISOString(),
      caseId: report.caseId,
      source: gold.source,
      sourceHash: gold.sourceHash,
      status: report.status,
      score: report.score,
      checks: report.checks,
      cellResults: report.cellResults,
      trace: report.trace,
      messages: report.messages,
    }, null, 2));
  }

  console.log(JSON.stringify({
    caseId: report.caseId,
    source: gold.source,
    sourceHash: gold.sourceHash,
    status: report.status,
    score: report.score,
    checks: report.checks,
    traceOut: hasFlag("--no-trace") ? null : traceOut,
    failingCells: report.cellResults
      .filter((cell) => !cell.formulaOk || !cell.valueOk)
      .map((cell) => ({ cell: cell.cell, formulaOk: cell.formulaOk, valueOk: cell.valueOk })),
  }, null, 2));

  if (report.status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
