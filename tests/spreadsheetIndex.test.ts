import { describe, expect, it } from "vitest";
import { buildSpreadsheetSemanticIndex } from "../src/app/spreadsheetIndex";
import type { CellPayload, DataframeColumn } from "../src/engine/types";

const columns: DataframeColumn[] = [
  { id: "account", label: "Account", order: 0 },
  { id: "q2", label: "Q2", order: 1 },
  { id: "q3", label: "Q3", order: 2 },
  { id: "variance", label: "Variance", order: 3 },
];

function payload(value: unknown, formula?: string): CellPayload {
  return { value, formula, status: "complete", confidence: 1, evidence: [] };
}

describe("spreadsheet semantic index", () => {
  it("prepends sheet, row, column, coordinate, and value context to every cell", () => {
    const index = buildSpreadsheetSemanticIndex({
      title: "Q3 variance",
      columns,
      seed: [
        { id: "u1__account", value: payload("Revenue") },
        { id: "u1__q2", value: payload("$10,000") },
        { id: "u1__q3", value: payload("$12,400") },
        { id: "u1__variance", value: payload("+24%") },
      ],
    });

    const q3 = index.cells.find((cell) => cell.elementId === "u1__q3");
    expect(q3?.coordinate).toBe("C2");
    expect(q3?.semanticSummary).toContain("Sheet: Q3 variance");
    expect(q3?.semanticSummary).toContain("Row: Revenue");
    expect(q3?.semanticSummary).toContain("Column: Q3");
    expect(q3?.semanticSummary).toContain("Value: $12,400");
    expect(index.chunks[0]?.text).toContain("Global columns: Account | Q2 | Q3 | Variance");
  });

  it("indexes asymmetric formula dependencies for downstream lock expansion", () => {
    const index = buildSpreadsheetSemanticIndex({
      title: "Q3 variance",
      columns,
      seed: [
        { id: "u1__account", value: payload("Revenue") },
        { id: "u1__q2", value: payload(10_000) },
        { id: "u1__q3", value: payload(12_400) },
        { id: "u1__variance", value: payload("+24%", "=C2/B2-1") },
      ],
    });

    expect(index.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentElementId: "u1__q3", childElementId: "u1__variance", parentCoordinate: "C2" }),
      expect.objectContaining({ parentElementId: "u1__q2", childElementId: "u1__variance", parentCoordinate: "B2" }),
    ]));
  });
});
