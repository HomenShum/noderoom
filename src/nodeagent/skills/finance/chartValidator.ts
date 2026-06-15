/**
 * Chart-data-vs-cells validator (deep-review Workflow 2 — banker-ready visual / chart exhibit).
 *
 * A chart is only diligence-grade if every plotted point is traceable to a real source cell, or is
 * EXPLICITLY flagged as an estimate. This is the deterministic guard that turns a passive rendered
 * chart (e.g. runwayChartSvg) into a source-linked exhibit: it refuses a chart whose series silently
 * invents numbers that don't tie out to the cells they claim to visualize.
 *
 * Pure + deterministic (no model, no I/O) — the same honesty discipline as the formula/CAS spine.
 */

export interface ChartSeriesPoint {
  /** Human label for the plotted point (e.g. "FY2025E runway", "Mercury cash"). */
  label: string;
  /** The value as plotted in the chart. */
  value: number;
  /** The source cell id this point claims to visualize (e.g. "r_mercury__cash"). */
  sourceRef?: string;
  /** True when the point is a model estimate not backed by a source cell — allowed, but must be declared. */
  estimated?: boolean;
}

export interface ChartCellLinkResult {
  ok: boolean;
  checked: number;
  /** Points whose plotted value does not tie out to (or reference) a real source cell. */
  mismatches: Array<{ label: string; reason: string }>;
  /** Points that are neither sourced nor flagged estimated — a silent invention. */
  unsourced: string[];
  estimatedCount: number;
}

/**
 * Assert each plotted point either (a) references a source cell whose value matches within tolerance,
 * or (b) is explicitly flagged `estimated`. Anything else is a mismatch (wrong value / dangling ref)
 * or unsourced (a number with no provenance and no estimate flag).
 */
export function validateChartDataAgainstCells(
  sourceCells: Record<string, number>,
  series: ChartSeriesPoint[],
  opts?: { tolerance?: number },
): ChartCellLinkResult {
  const tolerance = opts?.tolerance ?? 1e-6;
  const mismatches: Array<{ label: string; reason: string }> = [];
  const unsourced: string[] = [];
  let estimatedCount = 0;

  for (const point of series) {
    if (point.estimated) {
      estimatedCount += 1;
      continue; // a declared estimate is allowed without a source cell
    }
    if (!point.sourceRef) {
      unsourced.push(point.label); // a number with no provenance and no estimate flag
      continue;
    }
    if (!(point.sourceRef in sourceCells)) {
      mismatches.push({ label: point.label, reason: `sourceRef "${point.sourceRef}" is not a source cell` });
      continue;
    }
    const cellValue = sourceCells[point.sourceRef];
    if (!Number.isFinite(cellValue) || Math.abs(cellValue - point.value) > tolerance) {
      mismatches.push({ label: point.label, reason: `plotted ${point.value} does not tie out to ${point.sourceRef}=${cellValue}` });
    }
  }

  return { ok: mismatches.length === 0 && unsourced.length === 0, checked: series.length, mismatches, unsourced, estimatedCount };
}
