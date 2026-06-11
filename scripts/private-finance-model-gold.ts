import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  FINANCE_MODEL_MODE_CONTRACTS,
  FINANCE_MODEL_REQUIRED_SHEETS,
  PRIVATE_FINANCE_MODEL_GOLD_ENV,
  formulaMentionsAllRefs,
  formulaMentionsAllTokens,
} from "../evals/financeModelGold";

type Check = {
  id: string;
  ok: boolean;
  detail: string;
};

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

function workbookPath(): string | undefined {
  return optionValue("--gold") ?? optionValue("--workbook") ?? process.env[PRIVATE_FINANCE_MODEL_GOLD_ENV];
}

function contentHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function formulaText(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value;
  if (typeof value === "string" && value.trim().startsWith("=")) return value;
  if (value && typeof value === "object" && "formula" in value) {
    return String((value as FormulaCellValue).formula ?? "");
  }
  return undefined;
}

function cachedResult(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return (value as FormulaCellValue).result;
  return value;
}

async function readWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

function validateGoldWorkbook(workbook: ExcelJS.Workbook): Check[] {
  const checks: Check[] = [];
  const sheetNames = new Set(workbook.worksheets.map((sheet) => sheet.name));
  for (const sheet of FINANCE_MODEL_REQUIRED_SHEETS) {
    checks.push({
      id: `sheet:${sheet}`,
      ok: sheetNames.has(sheet),
      detail: sheetNames.has(sheet) ? "present" : "missing",
    });
  }

  const answer = workbook.getWorksheet("Answer Key");
  const userModel = workbook.getWorksheet("Your Model");
  if (!answer || !userModel) return checks;

  for (const formulaCheck of FINANCE_MODEL_CRITICAL_FORMULAS) {
    const answerCell = answer.getCell(formulaCheck.cell);
    const answerFormula = formulaText(answerCell);
    checks.push({
      id: `answer_formula:${formulaCheck.cell}`,
      ok:
        Boolean(answerFormula) &&
        formulaMentionsAllRefs(answerFormula ?? "", formulaCheck.requiredRefs) &&
        formulaMentionsAllTokens(answerFormula ?? "", formulaCheck.requiredTokens),
      detail: answerFormula ? formulaCheck.label : "missing formula",
    });

    const candidateSeed = userModel.getCell(formulaCheck.cell);
    checks.push({
      id: `blank_user_model:${formulaCheck.cell}`,
      ok: candidateSeed.value === null || candidateSeed.value === undefined || candidateSeed.value === "",
      detail: candidateSeed.value == null || candidateSeed.value === "" ? "blank" : "already populated",
    });
  }

  return checks;
}

function compareCandidateWorkbook(gold: ExcelJS.Workbook, candidate: ExcelJS.Workbook): Check[] {
  const checks: Check[] = [];
  const answer = gold.getWorksheet("Answer Key");
  const model = candidate.getWorksheet("Your Model");
  if (!answer || !model) {
    return [{
      id: "candidate:required_sheets",
      ok: false,
      detail: "gold Answer Key or candidate Your Model sheet is missing",
    }];
  }

  for (const formulaCheck of FINANCE_MODEL_CRITICAL_FORMULAS) {
    const answerCell = answer.getCell(formulaCheck.cell);
    const candidateCell = model.getCell(formulaCheck.cell);
    const candidateFormula = formulaText(candidateCell);
    const answerValue = cachedResult(answerCell);
    const candidateValue = cachedResult(candidateCell);
    const numericTie =
      typeof answerValue === "number" && typeof candidateValue === "number"
        ? Math.abs(answerValue - candidateValue) <= 0.05
        : candidateValue !== null && candidateValue !== undefined && String(candidateValue) === String(answerValue);

    checks.push({
      id: `candidate_formula:${formulaCheck.cell}`,
      ok:
        Boolean(candidateFormula) &&
        formulaMentionsAllRefs(candidateFormula ?? "", formulaCheck.requiredRefs) &&
        formulaMentionsAllTokens(candidateFormula ?? "", formulaCheck.requiredTokens),
      detail: candidateFormula ? formulaCheck.label : "missing formula",
    });
    checks.push({
      id: `candidate_value:${formulaCheck.cell}`,
      ok: numericTie,
      detail: formulaCheck.label,
    });
  }

  return checks;
}

async function main(): Promise<void> {
  const goldPath = workbookPath();
  if (!goldPath) {
    console.log(JSON.stringify({
      status: "skipped",
      reason: `set --gold <xlsx> or ${PRIVATE_FINANCE_MODEL_GOLD_ENV} to run the private finance model gold-pack check`,
      modes: FINANCE_MODEL_MODE_CONTRACTS.map((contract) => contract.mode),
    }, null, 2));
    return;
  }
  if (!existsSync(goldPath)) {
    console.error(JSON.stringify({ status: "failed", reason: `workbook not found: ${goldPath}` }, null, 2));
    process.exitCode = 1;
    return;
  }

  const gold = await readWorkbook(goldPath);
  const checks = validateGoldWorkbook(gold);
  const candidatePath = optionValue("--candidate");
  if (candidatePath) {
    if (!existsSync(candidatePath)) {
      checks.push({ id: "candidate:path", ok: false, detail: `candidate not found: ${candidatePath}` });
    } else {
      const candidate = await readWorkbook(candidatePath);
      checks.push(...compareCandidateWorkbook(gold, candidate));
    }
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    status: failed.length === 0 ? "passed" : "failed",
    goldHash: contentHash(goldPath),
    workbook: { sheets: gold.worksheets.length },
    modes: FINANCE_MODEL_MODE_CONTRACTS.map((contract) => ({
      mode: contract.mode,
      mutationPolicy: contract.mutationPolicy,
    })),
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
