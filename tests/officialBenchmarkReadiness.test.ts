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

  it("records BankerToolBench ingest and gold-isolated staging progress without promoting readiness", () => {
    const btb = officialBenchmarkReadiness().find((item) => item.id === "bankertoolbench");
    const ingest = btb?.capabilities.find((capability) => capability.capability === "official_task_ingest");
    const gold = btb?.capabilities.find((capability) => capability.capability === "official_gold_isolation");
    const rubric = btb?.capabilities.find((capability) => capability.capability === "rubric_weighted_scoring");
    const runner = btb?.capabilities.find((capability) => capability.capability === "official_runner_adapter");
    const documentOutputs = btb?.capabilities.find((capability) => capability.capability === "pptx_docx_pdf_outputs");

    expect(ingest).toMatchObject({
      state: "implemented",
      evidence: "src/eval/bankerToolBenchAdapter.ts",
    });
    expect(gold).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchStage.ts",
    });
    expect(gold?.blocker).toContain("contamination checks");
    expect(gold?.blocker).toContain("expected deliverable package metadata");
    expect(rubric).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(runner).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(runner?.blocker).toContain("agent workspaces");
    expect(runner?.blocker).toContain("Gandalf");
    expect(documentOutputs).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(documentOutputs?.blocker).toContain("multi-file candidate packages");
    expect(documentOutputs?.blocker).toContain("official verifier");
    expect(btb?.ready).toBe(false);
    expect(btb?.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("official_runner_adapter"),
      expect.stringContaining("docker_sandbox"),
    ]));
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

  it("records SpreadsheetBench local-bundle ingest progress without promoting benchmark readiness", () => {
    const spreadsheet = officialBenchmarkReadiness().filter((item) => item.id.startsWith("spreadsheetbench"));

    for (const item of spreadsheet) {
      const ingest = item.capabilities.find((capability) => capability.capability === "official_task_ingest");
      const gold = item.capabilities.find((capability) => capability.capability === "official_gold_isolation");
      const runner = item.capabilities.find((capability) => capability.capability === "official_runner_adapter");
      const format = item.capabilities.find((capability) => capability.capability === "format_diff");
      const xlsx = item.capabilities.find((capability) => capability.capability === "xlsx_import_export");
      const formula = item.capabilities.find((capability) => capability.capability === "formula_recompute");
      const chart = item.capabilities.find((capability) => capability.capability === "chart_visual_grade");

      expect(ingest).toMatchObject({
        state: "implemented",
        evidence: "src/eval/spreadsheetBenchAdapter.ts",
      });
      expect(gold).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchStage.ts",
      });
      expect(gold?.blocker).toContain("contamination");
      expect(runner).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchRunner.ts",
      });
      expect(runner?.blocker).toContain("model-edit-plan");
      expect(runner?.blocker).toContain("N=5");
      expect(runner?.blocker).toContain("retry-policy");
      expect(runner?.blocker).toContain("raw model output");
      expect(runner?.blocker).toContain("SUM");
      expect(runner?.blocker).toContain("workspace");
      expect(runner?.blocker).toContain("OS/Docker");
      expect(runner?.blocker).not.toContain("benchmark retry policy");
      expect(xlsx).toMatchObject({
        state: "implemented",
        evidence: "src/eval/spreadsheetBenchRunner.ts",
      });
      expect(formula).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchRunner.ts",
      });
      expect(formula?.blocker).toContain("SUM/AVERAGE/MIN/MAX/COUNT");
      expect(formula?.blocker).toContain("full Excel-compatible");
      expect(format).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchScorer.ts",
      });
      if (item.id === "spreadsheetbench-v2") {
        expect(chart).toMatchObject({
          state: "partial",
          evidence: "src/eval/spreadsheetBenchChartScorer.ts",
        });
        expect(chart?.blocker).toContain("static XLSX chart-package comparison");
        expect(chart?.blocker).toContain("VLM visual quality");
      }
      expect(item.ready).toBe(false);
      expect(item.blockers).toEqual(expect.arrayContaining([
        expect.stringContaining("official_runner_adapter"),
        expect.stringContaining("format_diff"),
      ]));
    }
  });

  it("summarizes blockers so HALO can target real benchmark gaps", () => {
    const summary = officialBenchmarkSummary();

    expect(summary.total).toBe(3);
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.missingCapabilities).toEqual(expect.arrayContaining([
      "official_runner_adapter",
      "format_diff",
    ]));
    expect(summary.missingCapabilities).not.toContain("official_task_ingest");
  });
});
