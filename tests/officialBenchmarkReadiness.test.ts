import { describe, expect, it } from "vitest";
import {
  OFFICIAL_BENCHMARK_CONTRACTS,
  officialBenchmarkReadiness,
  officialBenchmarkSummary,
} from "../src/eval/officialBenchmarkReadiness";

describe("official benchmark readiness", () => {
  it("tracks BankerToolBench and both SpreadsheetBench targets", () => {
    expect(OFFICIAL_BENCHMARK_CONTRACTS.map((item) => item.id)).toEqual([
      "bankertoolbench",
      "spreadsheetbench-v1",
      "spreadsheetbench-v2",
    ]);
  });

  it("requires BTB-specific multi-file, MCP, Docker, and weighted-rubric capabilities", () => {
    const btb = officialBenchmarkReadiness().find((item) => item.id === "bankertoolbench");

    expect(btb?.requiredCapabilities).toEqual(expect.arrayContaining([
      "pptx_docx_pdf_outputs",
      "mcp_financial_tools",
      "docker_sandbox",
      "rubric_weighted_scoring",
      "xlsx_import_export",
    ]));
    expect(btb?.ready).toBe(false);
  });

  it("requires SpreadsheetBench spreadsheet-native grading beyond internal finance evals", () => {
    const spreadsheet = officialBenchmarkReadiness().filter((item) => item.id.startsWith("spreadsheetbench"));

    for (const item of spreadsheet) {
      expect(item.requiredCapabilities).toEqual(expect.arrayContaining([
        "official_task_ingest",
        "official_gold_isolation",
        "official_runner_adapter",
        "xlsx_import_export",
        "formula_recompute",
        "format_diff",
      ]));
    }
    expect(spreadsheet.find((item) => item.id === "spreadsheetbench-v2")?.requiredCapabilities).toContain("chart_visual_grade");
  });

  it("summarizes blockers so HALO can target real benchmark gaps", () => {
    const summary = officialBenchmarkSummary();

    expect(summary.total).toBe(3);
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.missingCapabilities).toEqual(expect.arrayContaining([
      "official_runner_adapter",
      "official_task_ingest",
      "format_diff",
    ]));
  });
});
