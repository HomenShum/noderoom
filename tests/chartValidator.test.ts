/**
 * WF2 chart-data-vs-cells validator — a chart is diligence-grade only if every plotted point ties
 * out to a real source cell or is explicitly flagged as an estimate. Scenario-based: a banker's
 * runway exhibit over a Company Research fixture, including the adversarial "silently invented number"
 * and "wrong value" paths.
 */
import { describe, expect, it } from "vitest";
import { validateChartDataAgainstCells, type ChartSeriesPoint } from "../src/nodeagent/skills/finance/chartValidator";

const CELLS = {
  r_mercury__cash: 1_400_000,
  r_mercury__burn: 100_000,
  r_mercury__runway_months: 14,
};

describe("validateChartDataAgainstCells", () => {
  it("passes when every plotted point ties out to its source cell", () => {
    const series: ChartSeriesPoint[] = [
      { label: "Mercury cash", value: 1_400_000, sourceRef: "r_mercury__cash" },
      { label: "Mercury burn", value: 100_000, sourceRef: "r_mercury__burn" },
      { label: "Mercury runway", value: 14, sourceRef: "r_mercury__runway_months" },
    ];
    const r = validateChartDataAgainstCells(CELLS, series);
    expect(r.ok).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.unsourced).toHaveLength(0);
    expect(r.checked).toBe(3);
  });

  it("fails a plotted value that does not tie out to its source cell", () => {
    const series: ChartSeriesPoint[] = [
      { label: "Mercury runway", value: 24, sourceRef: "r_mercury__runway_months" }, // cell says 14
    ];
    const r = validateChartDataAgainstCells(CELLS, series);
    expect(r.ok).toBe(false);
    expect(r.mismatches[0].reason).toMatch(/does not tie out/);
  });

  it("fails a number with no provenance and no estimate flag (silent invention)", () => {
    const series: ChartSeriesPoint[] = [
      { label: "Projected ARR", value: 5_000_000 }, // no sourceRef, not estimated
    ];
    const r = validateChartDataAgainstCells(CELLS, series);
    expect(r.ok).toBe(false);
    expect(r.unsourced).toContain("Projected ARR");
  });

  it("fails a sourceRef that points at a non-existent cell", () => {
    const series: ChartSeriesPoint[] = [
      { label: "Mystery", value: 1, sourceRef: "r_mercury__does_not_exist" },
    ];
    const r = validateChartDataAgainstCells(CELLS, series);
    expect(r.ok).toBe(false);
    expect(r.mismatches[0].reason).toMatch(/is not a source cell/);
  });

  it("allows a point that is explicitly flagged as an estimate", () => {
    const series: ChartSeriesPoint[] = [
      { label: "FY2027E (model estimate)", value: 9_000_000, estimated: true },
      { label: "Mercury cash", value: 1_400_000, sourceRef: "r_mercury__cash" },
    ];
    const r = validateChartDataAgainstCells(CELLS, series);
    expect(r.ok).toBe(true);
    expect(r.estimatedCount).toBe(1);
  });
});
