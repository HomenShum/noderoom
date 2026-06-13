import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scoreSpreadsheetBenchCharts } from "../src/eval/spreadsheetBenchChartScorer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench chart package scorer", () => {
  it("passes when candidate chart and drawing package XML matches evaluator-only gold", () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    writeZip(candidate, [
      ["xl/charts/chart1.xml", "<c:chartSpace>\n  <c:title><c:v>Revenue</c:v></c:title>\n</c:chartSpace>"],
      ["xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor><xdr:graphicFrame/></xdr:twoCellAnchor></xdr:wsDr>"],
      ["xl/worksheets/sheet1.xml", "<worksheet/>"],
    ]);
    writeZip(gold, [
      ["xl/charts/chart1.xml", "<c:chartSpace><c:title><c:v>Revenue</c:v></c:title></c:chartSpace>"],
      ["xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor><xdr:graphicFrame/></xdr:twoCellAnchor></xdr:wsDr>"],
    ]);

    const score = scoreSpreadsheetBenchCharts({
      taskId: "v2-chart",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score).toMatchObject({
      schema: 1,
      verifier: "xlsx_chart_package_static",
      pass: true,
      totals: {
        goldChartParts: 2,
        candidateChartParts: 2,
        matchedChartParts: 2,
        missingChartParts: 0,
        extraChartParts: 0,
        mismatchedChartParts: 0,
      },
      scores: { package: 1 },
    });
    expect(score.candidateParts.map((part) => [part.kind, part.path])).toEqual([
      ["chart", "xl/charts/chart1.xml"],
      ["drawing", "xl/drawings/drawing1.xml"],
    ]);
    expect(score.warnings[0]).toContain("not a rendered visual or VLM");
  });

  it("fails missing, extra, and changed chart package parts without reading workbook cells", () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    writeZip(candidate, [
      ["xl/charts/chart1.xml", "<c:chartSpace><c:title><c:v>Wrong</c:v></c:title></c:chartSpace>"],
      ["xl/charts/chart2.xml", "<c:chartSpace><c:title><c:v>Extra</c:v></c:title></c:chartSpace>"],
    ]);
    writeZip(gold, [
      ["xl/charts/chart1.xml", "<c:chartSpace><c:title><c:v>Right</c:v></c:title></c:chartSpace>"],
      ["xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor/></xdr:wsDr>"],
    ]);

    const score = scoreSpreadsheetBenchCharts({
      taskId: "v2-chart",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
    });

    expect(score.pass).toBe(false);
    expect(score.totals).toMatchObject({
      goldChartParts: 2,
      candidateChartParts: 2,
      matchedChartParts: 0,
      missingChartParts: 1,
      extraChartParts: 1,
      mismatchedChartParts: 1,
    });
    expect(score.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "chart_xml", path: "xl/charts/chart1.xml" }),
      expect.objectContaining({ kind: "missing_chart_part", path: "xl/drawings/drawing1.xml" }),
      expect.objectContaining({ kind: "extra_chart_part", path: "xl/charts/chart2.xml" }),
    ]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-chart-score-"));
  roots.push(root);
  return root;
}

function writeZip(path: string, entries: Array<[string, string]>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const content = Buffer.from(text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + content.length;
  }
  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  writeFileSync(path, Buffer.concat([...localParts, centralDirectory, eocd]));
}
