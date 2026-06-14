/**
 * Scenario: a middle-market credit analyst at a regional bank underwrites a $4.0M term loan to
 * "Cascade Components LLC" (a manufacturer). She spreads 3 years of financials and must produce a
 * credit memo whose ratios are CORRECT and whose gaps are HONEST. The agent may read her workbook and
 * propose which cells are EBITDA / debt service, but these numbers are computed deterministically.
 *
 * Coverage (scenario_testing rule): happy path, missing-data (sad), negative-EBITDA + footing-mismatch
 * (adversarial), covenant breach, and multi-period accumulation (long-running spread).
 */
import { describe, it, expect } from "vitest";
import {
  dscr, leverage, ltv, interestCoverage, fixedChargeCoverage, debtYield,
  normalizeEbitda, testCovenant, foots, spreadByPeriod,
} from "../src/nodeagent/skills/finance/creditRatios";

describe("Cascade Components term-loan underwrite — clean FY2024 spread (happy path)", () => {
  it("computes the 5-Cs ratios a credit committee underwrites", () => {
    // Capital: normalized EBITDA = reported 1.8M + owner-comp 0.15M + one-time legal 0.05M = 2.0M
    const ebitda = normalizeEbitda(1.8, { ownerComp: 0.15, oneTimeLegal: 0.05 });
    expect(ebitda).toMatchObject({ ok: true, value: 2.0 });

    expect(leverage(6.4, 2.0)).toMatchObject({ ok: true, value: 3.2 });        // total debt / EBITDA
    expect(dscr(1.96, 1.4)).toMatchObject({ ok: true, value: 1.4 });           // cash available / debt service
    expect(ltv(4.0, 6.0)).toMatchObject({ ok: true, value: 0.6667 });          // loan / collateral
    expect(interestCoverage(2.0, 0.45)).toMatchObject({ ok: true, value: 4.44 });
    expect(debtYield(0.92, 4.0)).toMatchObject({ ok: true, value: 0.23 });

    // Conservative capacity test the committee actually leans on:
    const fcc = fixedChargeCoverage({ ebitda: 2.0, unfinancedCapex: 0.2, cashTaxes: 0.24, distributions: 0, interest: 0.45, scheduledPrincipal: 0.95 });
    expect(fcc).toMatchObject({ ok: true, value: 1.11 });
  });

  it("passes the DSCR >= 1.25x covenant with stated headroom", () => {
    const t = testCovenant(dscr(1.96, 1.4), 1.25, ">=");
    expect(t).toMatchObject({ ok: true, pass: true, actual: 1.4, headroom: 0.15 });
  });

  it("foots the EBITDA add-back build to the stated normalized total (tight tolerance)", () => {
    expect(foots([1.8, 0.15, 0.05], 2.0, 0.01)).toMatchObject({ ok: true, foots: true, sum: 2.0, difference: 0 });
  });
});

describe("honest gaps — a missing or invalid input is surfaced, never coerced", () => {
  it("missing debt service → insufficient_data naming the field, NOT a silent 0 or Infinity", () => {
    const empty = Number.NaN; // an empty spreadsheet cell parses to NaN
    const r = dscr(1.96, empty);
    expect(r).toMatchObject({ ok: false, reason: "insufficient_data", missing: ["totalDebtService"] });
  });

  it("zero debt service → insufficient_data, not Infinity (no-debt is a fact, not 'infinite coverage')", () => {
    expect(dscr(1.96, 0)).toMatchObject({ ok: false, reason: "insufficient_data", missing: ["totalDebtService"] });
  });

  it("a covenant on an uncomputable ratio is itself insufficient_data (no false pass)", () => {
    const t = testCovenant(dscr(1.96, Number.NaN), 1.25, ">=");
    expect(t).toMatchObject({ ok: false, reason: "insufficient_data" });
  });
});

describe("adversarial — a distressed year and a mis-keyed sheet must not produce a plausible-but-wrong memo", () => {
  it("negative EBITDA → leverage is insufficient_data (a negative multiple is nonsense), not a fabricated number", () => {
    expect(leverage(6.4, -0.3)).toMatchObject({ ok: false, reason: "insufficient_data", missing: ["ebitda"] });
  });

  it("an add-back build that does not tie to the stated total is caught by footing", () => {
    // Analyst keyed normalized EBITDA as 2.3M but the parts only sum to 2.0M.
    const f = foots([1.8, 0.15, 0.05], 2.3, 0.01);
    expect(f).toMatchObject({ ok: true, foots: false });
    if (f.ok) expect(f.difference).toBeCloseTo(-0.3, 4);
  });

  it("covenant breach reports negative headroom (breach depth), deterministically", () => {
    const stressed = dscr(1.40, 1.27); // ~1.10x
    const t = testCovenant(stressed, 1.25, ">=");
    expect(t).toMatchObject({ ok: true, pass: false });
    if (t.ok) expect(t.headroom).toBeLessThan(0);
  });
});

describe("multi-period spread — long-running accumulation across FY2022-FY2024", () => {
  it("classifies DSCR trend as improving when coverage rises year over year", () => {
    const { trend, spreads } = spreadByPeriod([
      { period: "FY2022", compute: () => dscr(1.15, 1.0) },   // 1.15x
      { period: "FY2023", compute: () => dscr(1.41, 1.10) },  // 1.28x
      { period: "FY2024", compute: () => dscr(1.96, 1.40) },  // 1.40x
    ], { higherIsBetter: true });
    expect(trend).toBe("improving");
    expect(spreads).toHaveLength(3);
  });

  it("reads leverage DOWN as improving (deleveraging) via higherIsBetter:false", () => {
    const { trend } = spreadByPeriod([
      { period: "FY2022", compute: () => leverage(7.6, 2.0) }, // 3.8x
      { period: "FY2023", compute: () => leverage(7.0, 2.0) }, // 3.5x
      { period: "FY2024", compute: () => leverage(6.4, 2.0) }, // 3.2x
    ], { higherIsBetter: false });
    expect(trend).toBe("improving");
  });

  it("carries an insufficient_data period instead of dropping it, and still trends the rest", () => {
    const { trend, spreads } = spreadByPeriod([
      { period: "FY2022", compute: () => dscr(1.15, 1.0) },
      { period: "FY2023", compute: () => dscr(1.41, Number.NaN) }, // missing debt service this year
      { period: "FY2024", compute: () => dscr(1.96, 1.40) },
    ], { higherIsBetter: true });
    expect(spreads).toHaveLength(3);                       // the gap is carried, not silently dropped
    expect(spreads[1].result.ok).toBe(false);
    expect(trend).toBe("improving");                       // trend computed on the 2 periods that resolved
  });

  it("a single computable period is indeterminate — a trend is never guessed from one point", () => {
    const { trend } = spreadByPeriod([{ period: "FY2024", compute: () => dscr(1.96, 1.4) }], { higherIsBetter: true });
    expect(trend).toBe("indeterminate");
  });
});
