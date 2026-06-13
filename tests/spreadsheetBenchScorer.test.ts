import ExcelJS from "exceljs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseAnswerPosition, scoreSpreadsheetBenchWorkbook } from "../src/eval/spreadsheetBenchScorer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench workbook scorer", () => {
  it("parses quoted multi-sheet answer ranges", () => {
    expect(parseAnswerPosition("'Valuation'!C3:D4,'Ratio Analysis'!B2:B3")).toEqual([
      { sheetName: "Valuation", startRow: 3, endRow: 4, startCol: 3, endCol: 4, label: "'Valuation'!C3:D4" },
      { sheetName: "Ratio Analysis", startRow: 2, endRow: 3, startCol: 2, endCol: 2, label: "'Ratio Analysis'!B2:B3" },
    ]);
  });

  it("passes when candidate workbook matches evaluator-only gold across values, formulas, and styles", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeWorkbook(candidate, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });
    await writeWorkbook(gold, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/pass",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      compareStyles: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(true);
    expect(score.totals).toMatchObject({
      comparedCells: 2,
      valueMatches: 2,
      formulaCells: 1,
      formulaMatches: 1,
      styleCells: 2,
      styleMatches: 2,
      mismatches: 0,
    });
    expect(score.scores).toMatchObject({ value: 1, formula: 1, style: 1, overall: 1 });
  });

  it("reports value, formula, and style mismatches without mutating either workbook", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeWorkbook(candidate, { value: 23, formula: "B2+1", bold: false, numFmt: "0.0%" });
    await writeWorkbook(gold, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/fail",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      compareStyles: true,
      maxMismatches: 10,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(false);
    expect(score.totals.comparedCells).toBe(2);
    expect(score.totals.mismatches).toBeGreaterThanOrEqual(3);
    expect(score.mismatches.map((item) => item.kind)).toEqual(expect.arrayContaining(["value", "formula", "style"]));
    expect(score.scores.overall).toBeLessThan(1);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-spreadsheetbench-score-"));
  roots.push(root);
  return root;
}

async function writeWorkbook(path: string, args: { value: number; formula: string; bold: boolean; numFmt: string }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("B2").value = args.value;
  sheet.getCell("B2").numFmt = args.numFmt;
  sheet.getCell("B2").font = { bold: args.bold };
  sheet.getCell("C2").value = { formula: args.formula, result: args.value * 2 };
  sheet.getCell("C2").numFmt = args.numFmt;
  sheet.getCell("C2").font = { bold: args.bold };
  await workbook.xlsx.writeFile(path);
}
