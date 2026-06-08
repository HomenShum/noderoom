import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheetArtifacts } from "../src/app/spreadsheetParser";
import type { CellPayload } from "../src/engine/types";

function payloadValue(value: unknown) {
  return (value as CellPayload).value;
}

describe("spreadsheet parser", () => {
  it("parses CSV into a dataframe artifact with evidence-bearing cells", async () => {
    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "accounts.csv",
      mimeType: "text/csv",
      size: 42,
      text: "Company,Score\nAcme,High\nGlobex,Medium\n",
    });

    expect(artifact.title).toBe("accounts.csv");
    expect(artifact.kind).toBe("sheet");
    expect(artifact.meta?.dataframe?.columns.map((c) => c.label)).toEqual(["Company", "Score"]);
    expect(artifact.meta?.dataframe?.rowCount).toBe(2);
    expect(payloadValue(artifact.seed.find((s) => s.id === "u1__company")?.value)).toBe("Acme");
    expect((artifact.seed.find((s) => s.id === "u1__company")?.value as CellPayload).evidence?.[0]?.kind).toBe("upload");
  });

  it("parses each XLSX worksheet into a separate dataframe artifact", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("PitchBook");
    first.addRow(["Company", "PBId", "Score"]);
    first.addRow(["Acme AI", "pb-1", "High"]);
    const second = workbook.addWorksheet("Rubric");
    second.addRow(["Company", "Tier"]);
    second.addRow(["Globex", "A"]);
    const buffer = await workbook.xlsx.writeBuffer();

    const artifacts = await parseSpreadsheetArtifacts({
      fileName: "corpus.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.byteLength,
      arrayBuffer: buffer,
    });

    expect(artifacts.map((a) => a.title)).toEqual(["corpus.xlsx / PitchBook", "corpus.xlsx / Rubric"]);
    expect(artifacts[0].meta?.dataframe?.sheetNames).toEqual(["PitchBook", "Rubric"]);
    expect(payloadValue(artifacts[0].seed.find((s) => s.id === "u1__pbid")?.value)).toBe("pb-1");
    expect(payloadValue(artifacts[1].seed.find((s) => s.id === "u1__tier")?.value)).toBe("A");
  });

  it("detects headers below banner rows", async () => {
    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "accounting.csv",
      mimeType: "text/csv",
      size: 128,
      text: "Business income and expense\nWendy Liu CPA\nAccount,Amount,Note\nRevenue,1000,Stripe\nCOGS,400,Vendor\n",
    });

    expect(artifact.meta?.dataframe?.columns.map((c) => c.label)).toEqual(["Account", "Amount", "Note"]);
    expect(payloadValue(artifact.seed.find((s) => s.id === "u1__account")?.value)).toBe("Revenue");
    expect(artifact.meta?.dataframe?.warnings?.[0]).toContain("Skipped 2 banner rows");
  });

  it("caps wide uploads to the live 20k-cell artifact budget", async () => {
    const header = Array.from({ length: 80 }, (_, i) => `Col ${i + 1}`).join(",");
    const row = Array.from({ length: 80 }, (_, i) => String(i + 1)).join(",");
    const text = [header, ...Array.from({ length: 300 }, () => row)].join("\n");
    const [artifact] = await parseSpreadsheetArtifacts({ fileName: "wide.csv", mimeType: "text/csv", size: text.length, text });

    expect(artifact.seed).toHaveLength(20_000);
    expect(artifact.meta?.dataframe?.rowCount).toBe(250);
    expect(artifact.meta?.dataframe?.warnings?.join(" ")).toContain("20000 cells");
  });
});
