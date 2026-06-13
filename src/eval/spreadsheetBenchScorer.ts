import ExcelJS from "exceljs";
import { basename } from "node:path";

export type SpreadsheetBenchCellMismatchKind = "value" | "formula" | "style" | "missing_sheet";

export type SpreadsheetBenchCellMismatch = {
  kind: SpreadsheetBenchCellMismatchKind;
  sheet: string;
  cell?: string;
  expected?: string;
  actual?: string;
};

export type SpreadsheetBenchScoreOptions = {
  taskId?: string;
  candidateWorkbookPath: string;
  goldWorkbookPath: string;
  answerPosition?: string;
  answerSheet?: string;
  compareStyles?: boolean;
  maxMismatches?: number;
  generatedAt?: string;
};

export type SpreadsheetBenchWorkbookScore = {
  schema: 1;
  generatedAt?: string;
  taskId?: string;
  candidateWorkbook: string;
  goldWorkbook: string;
  answerPosition?: string;
  ranges: string[];
  totals: {
    comparedCells: number;
    valueMatches: number;
    formulaCells: number;
    formulaMatches: number;
    styleCells: number;
    styleMatches: number;
    mismatches: number;
    missingSheets: number;
  };
  scores: {
    value: number;
    formula: number | null;
    style: number | null;
    overall: number;
  };
  pass: boolean;
  warnings: string[];
  mismatches: SpreadsheetBenchCellMismatch[];
};

type ParsedRange = {
  sheetName?: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  label: string;
};

type CellParts = {
  value: unknown;
  formula?: string;
  style: string;
};

export async function scoreSpreadsheetBenchWorkbook(options: SpreadsheetBenchScoreOptions): Promise<SpreadsheetBenchWorkbookScore> {
  const [candidate, gold] = await Promise.all([
    readWorkbook(options.candidateWorkbookPath),
    readWorkbook(options.goldWorkbookPath),
  ]);
  const maxMismatches = options.maxMismatches ?? 50;
  const warnings: string[] = [];
  const mismatches: SpreadsheetBenchCellMismatch[] = [];
  const ranges = parseAnswerPosition(options.answerPosition, options.answerSheet);
  const concreteRanges = ranges.length > 0 ? ranges : usedRangesFromGold(gold);

  let comparedCells = 0;
  let valueMatches = 0;
  let formulaCells = 0;
  let formulaMatches = 0;
  let styleCells = 0;
  let styleMatches = 0;
  let missingSheets = 0;
  let mismatchCount = 0;

  for (const range of concreteRanges) {
    const sheetName = range.sheetName ?? options.answerSheet ?? gold.worksheets[0]?.name;
    if (!sheetName) {
      warnings.push(`range ${range.label} has no sheet and the gold workbook has no worksheets`);
      continue;
    }
    const goldSheet = gold.getWorksheet(sheetName);
    const candidateSheet = candidate.getWorksheet(sheetName);
    if (!goldSheet || !candidateSheet) {
      missingSheets += 1;
      mismatchCount += rangeCellCount(range);
      pushMismatch(mismatches, maxMismatches, {
        kind: "missing_sheet",
        sheet: sheetName,
        expected: goldSheet ? "gold sheet exists" : "gold sheet missing",
        actual: candidateSheet ? "candidate sheet exists" : "candidate sheet missing",
      });
      continue;
    }

    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        comparedCells += 1;
        const cellRef = `${colToLetters(col)}${row}`;
        const expected = cellParts(goldSheet.getCell(row, col));
        const actual = cellParts(candidateSheet.getCell(row, col));
        const valueOk = valuesEqual(actual.value, expected.value);
        if (valueOk) valueMatches += 1;
        else {
          mismatchCount += 1;
          pushMismatch(mismatches, maxMismatches, {
            kind: "value",
            sheet: sheetName,
            cell: cellRef,
            expected: preview(expected.value),
            actual: preview(actual.value),
          });
        }

        if (expected.formula || actual.formula) {
          formulaCells += 1;
          const formulaOk = normalizeFormula(actual.formula) === normalizeFormula(expected.formula);
          if (formulaOk) formulaMatches += 1;
          else {
            mismatchCount += 1;
            pushMismatch(mismatches, maxMismatches, {
              kind: "formula",
              sheet: sheetName,
              cell: cellRef,
              expected: expected.formula,
              actual: actual.formula,
            });
          }
        }

        if (options.compareStyles) {
          styleCells += 1;
          if (actual.style === expected.style) styleMatches += 1;
          else {
            mismatchCount += 1;
            pushMismatch(mismatches, maxMismatches, {
              kind: "style",
              sheet: sheetName,
              cell: cellRef,
              expected: expected.style,
              actual: actual.style,
            });
          }
        }
      }
    }
  }

  const valueScore = ratio(valueMatches, comparedCells);
  const formulaScore = formulaCells > 0 ? ratio(formulaMatches, formulaCells) : null;
  const styleScore = options.compareStyles && styleCells > 0 ? ratio(styleMatches, styleCells) : null;
  const overallParts = [
    valueScore,
    ...(formulaScore === null ? [] : [formulaScore]),
    ...(styleScore === null ? [] : [styleScore]),
  ];
  const overall = overallParts.reduce((sum, item) => sum + item, 0) / Math.max(1, overallParts.length);

  if (mismatchCount > mismatches.length) warnings.push(`mismatch list capped at ${mismatches.length}/${mismatchCount}`);

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    taskId: options.taskId,
    candidateWorkbook: basename(options.candidateWorkbookPath),
    goldWorkbook: basename(options.goldWorkbookPath),
    answerPosition: options.answerPosition,
    ranges: concreteRanges.map((range) => range.label),
    totals: {
      comparedCells,
      valueMatches,
      formulaCells,
      formulaMatches,
      styleCells,
      styleMatches,
      mismatches: mismatchCount,
      missingSheets,
    },
    scores: {
      value: valueScore,
      formula: formulaScore,
      style: styleScore,
      overall,
    },
    pass: comparedCells > 0 && mismatchCount === 0 && missingSheets === 0,
    warnings,
    mismatches,
  };
}

export function parseAnswerPosition(answerPosition: string | undefined, defaultSheet?: string): ParsedRange[] {
  if (!answerPosition?.trim()) return [];
  return splitOutsideQuotes(answerPosition).map((raw) => {
    const part = raw.trim();
    const bang = indexOfSheetBang(part);
    const sheetName = bang >= 0 ? unquoteSheet(part.slice(0, bang)) : defaultSheet;
    const rangeText = bang >= 0 ? part.slice(bang + 1) : part;
    const [startText, endText = startText] = rangeText.split(":").map((item) => item.trim());
    const start = parseCellRef(startText);
    const end = parseCellRef(endText);
    return {
      sheetName,
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endCol: Math.max(start.col, end.col),
      label: `${sheetName ? `'${sheetName}'!` : ""}${startText}${endText === startText ? "" : `:${endText}`}`,
    };
  });
}

async function readWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

function usedRangesFromGold(workbook: ExcelJS.Workbook): ParsedRange[] {
  return workbook.worksheets.flatMap((sheet) => {
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = 0;
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        minRow = Math.min(minRow, rowNumber);
        maxRow = Math.max(maxRow, rowNumber);
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      });
    });
    if (!maxRow || !maxCol) return [];
    return [{
      sheetName: sheet.name,
      startRow: minRow,
      endRow: maxRow,
      startCol: minCol,
      endCol: maxCol,
      label: `'${sheet.name}'!${colToLetters(minCol)}${minRow}:${colToLetters(maxCol)}${maxRow}`,
    }];
  });
}

function cellParts(cell: ExcelJS.Cell): CellParts {
  return {
    value: comparableValue(cell.value),
    formula: formulaText(cell.value),
    style: styleFingerprint(cell),
  };
}

function comparableValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("formula" in value) return comparableValue(value.result as ExcelJS.CellValue);
  if ("sharedFormula" in value) return comparableValue(value.result as ExcelJS.CellValue);
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text ?? "").join("");
  if ("hyperlink" in value) return value.text ?? value.hyperlink;
  if ("error" in value) return value.error;
  return JSON.stringify(value);
}

function formulaText(value: ExcelJS.CellValue): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("formula" in value && typeof value.formula === "string") return ensureEquals(value.formula);
  if ("sharedFormula" in value && typeof value.sharedFormula === "string") return ensureEquals(value.sharedFormula);
  return undefined;
}

function ensureEquals(formula: string): string {
  return formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`;
}

function normalizeFormula(formula: string | undefined): string {
  return (formula ?? "").replace(/^=/, "").replace(/\s+/g, "").replace(/\$/g, "").toUpperCase();
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") return Math.abs(actual - expected) <= 1e-9;
  if (actual === expected) return true;
  return normalizeText(actual) === normalizeText(expected);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function styleFingerprint(cell: ExcelJS.Cell): string {
  const style = cell.style ?? {};
  return stableJson({
    numFmt: style.numFmt,
    font: compact({
      name: style.font?.name,
      size: style.font?.size,
      bold: style.font?.bold,
      italic: style.font?.italic,
      underline: style.font?.underline,
      color: style.font?.color,
    }),
    fill: style.fill,
    alignment: style.alignment,
    border: style.border,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function splitOutsideQuotes(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'") {
      current += ch;
      if (value[i + 1] === "'") {
        current += value[i + 1];
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function indexOfSheetBang(value: string): number {
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'") {
      if (value[i + 1] === "'") i += 1;
      else quoted = !quoted;
    } else if (ch === "!" && !quoted) {
      return i;
    }
  }
  return value.indexOf("!");
}

function unquoteSheet(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function parseCellRef(value: string): { row: number; col: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(value.trim());
  if (!match) throw new Error(`Unsupported SpreadsheetBench cell reference: ${value}`);
  return { col: lettersToCol(match[1].toUpperCase()), row: Number(match[2]) };
}

function lettersToCol(letters: string): number {
  return [...letters].reduce((total, ch) => total * 26 + ch.charCodeAt(0) - 64, 0);
}

function colToLetters(col: number): string {
  let value = col;
  let out = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function rangeCellCount(range: ParsedRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function preview(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

function pushMismatch(items: SpreadsheetBenchCellMismatch[], max: number, item: SpreadsheetBenchCellMismatch) {
  if (items.length < max) items.push(item);
}
