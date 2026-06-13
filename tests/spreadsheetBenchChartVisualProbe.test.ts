import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSpreadsheetBenchChartVisualProbe } from "../src/eval/spreadsheetBenchChartVisualProbe";

describe("SpreadsheetBench chart visual probe", () => {
  it("keeps readiness red when chart rendering is unavailable", () => {
    const report = runSpreadsheetBenchChartVisualProbe({
      generatedAt: "2026-06-13T00:00:00.000Z",
      rendererCommands: [{ command: "soffice", args: ["--version"] }],
      runCommand: (command, args) => ({
        command: [command, ...args].join(" "),
        exitCode: 1,
        stdoutPreview: "",
        stderrPreview: "not found",
        ok: false,
      }),
      env: {},
    });

    expect(report.status).toBe("renderer_unavailable");
    expect(report.pass).toBe(false);
    expect(report.warnings.join(" ")).toContain("official benchmark readiness must remain red");
    expect(report.warnings.join(" ")).toContain("No LibreOffice/soffice renderer command");
    expect(report.vlm.apiKeyPresent).toBe(false);
  });

  it("passes only with renderer, screenshot pair, API key, and accepted VLM report", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-chart-visual-probe-"));
    const candidate = join(root, "candidate.png");
    const gold = join(root, "gold.png");
    const vlmReport = join(root, "vlm-report.json");
    writeFileSync(candidate, "candidate image");
    writeFileSync(gold, "gold image");
    writeFileSync(vlmReport, JSON.stringify({
      verifier: "spreadsheetbench_chart_visual_vlm",
      status: "judged",
      pass: true,
    }));

    const report = runSpreadsheetBenchChartVisualProbe({
      generatedAt: "2026-06-13T00:00:00.000Z",
      rendererCommands: [{ command: "soffice", args: ["--version"] }],
      runCommand: (command, args) => ({
        command: [command, ...args].join(" "),
        exitCode: 0,
        stdoutPreview: "LibreOffice 25",
        stderrPreview: "",
        ok: true,
      }),
      candidateImagePath: candidate,
      goldImagePath: gold,
      vlmReportPath: vlmReport,
      env: { GOOGLE_GENERATIVE_AI_API_KEY: "test-key" },
    });

    expect(report.status).toBe("chart_visual_grade_proven");
    expect(report.pass).toBe(true);
    expect(report.renderer.selected).toBe("soffice --version");
    expect(report.imagePair).toMatchObject({ candidateImage: "candidate.png", goldImage: "gold.png", available: true });
    expect(report.vlm.reportAccepted).toBe(true);
  });
});
