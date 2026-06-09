/**
 * Deterministic middle-market credit math — the "no hallucination in the math path" layer.
 *
 * An LLM may READ a borrower's spreadsheet and PROPOSE which cells are EBITDA, debt service, etc.,
 * but the ratios a credit memo turns on (DSCR, leverage, LTV, coverage, covenant tests) are computed
 * HERE, in pure TypeScript, never by the model. Every function returns a typed result: a number with
 * its inputs, OR `insufficient_data` naming the missing/invalid field — so a gap is surfaced as DATA,
 * not silently coerced to 0 or NaN (the agentic_reliability HONEST_SCORES / no-false-belief rule).
 *
 * Domain grounding — the 5 Cs of credit (Character, Capacity, Capital, Collateral, Conditions):
 *   - Capacity   → DSCR, fixed-charge coverage, interest coverage
 *   - Capital    → leverage (debt / EBITDA)
 *   - Collateral → LTV, debt yield
 *   - Conditions → covenant tests against thresholds, multi-period trend
 * Source: Corporate Finance Institute, "5 Cs of Credit" + standard commercial-credit spreads.
 * (Researched 2026-06-08; this is the deterministic substrate the credit eval is written against.)
 */

/** A computed ratio, or an honest gap. Never NaN/Infinity leaks to a caller. */
export type RatioResult =
  | { ok: true; value: number; inputs: Record<string, number> }
  | { ok: false; reason: "insufficient_data"; missing: string[]; detail: string };

const insufficient = (missing: string[], detail: string): RatioResult => ({ ok: false, reason: "insufficient_data", missing, detail });

/** A finite, non-null number. Strings, null, undefined, NaN, Infinity all fail — no silent coercion. */
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate named numerator/denominator inputs; collect EVERY missing field (not just the first). */
function requireFinite(fields: Record<string, unknown>): { ok: true } | { ok: false; missing: string[] } {
  const missing = Object.entries(fields).filter(([, v]) => !finite(v)).map(([k]) => k);
  return missing.length ? { ok: false, missing } : { ok: true };
}

function round(value: number, dp = 4): number {
  return Number(value.toFixed(dp));
}

/**
 * Debt Service Coverage Ratio = cash available for debt service / total debt service.
 * Capacity. A zero/negative denominator is `insufficient_data` (no debt service is not "infinite
 * coverage" you can underwrite on — it's a different fact the memo must state explicitly).
 */
export function dscr(cashAvailable: number, totalDebtService: number): RatioResult {
  const check = requireFinite({ cashAvailable, totalDebtService });
  if (!check.ok) return insufficient(check.missing, "DSCR needs finite cashAvailable and totalDebtService");
  if (totalDebtService <= 0) return insufficient(["totalDebtService"], "debt service is zero or negative; DSCR is undefined");
  return { ok: true, value: round(cashAvailable / totalDebtService, 2), inputs: { cashAvailable, totalDebtService } };
}

/** Leverage = total debt / EBITDA. Capital. Non-positive EBITDA → insufficient_data (the memo must
 *  show the EBITDA gap, not a meaningless or negative multiple). */
export function leverage(totalDebt: number, ebitda: number): RatioResult {
  const check = requireFinite({ totalDebt, ebitda });
  if (!check.ok) return insufficient(check.missing, "leverage needs finite totalDebt and ebitda");
  if (ebitda <= 0) return insufficient(["ebitda"], "EBITDA is zero or negative; leverage multiple is not meaningful");
  if (totalDebt < 0) return insufficient(["totalDebt"], "total debt is negative");
  return { ok: true, value: round(totalDebt / ebitda, 2), inputs: { totalDebt, ebitda } };
}

/** Loan-to-Value = loan amount / collateral value. Collateral. */
export function ltv(loanAmount: number, collateralValue: number): RatioResult {
  const check = requireFinite({ loanAmount, collateralValue });
  if (!check.ok) return insufficient(check.missing, "LTV needs finite loanAmount and collateralValue");
  if (collateralValue <= 0) return insufficient(["collateralValue"], "collateral value is zero or negative");
  if (loanAmount < 0) return insufficient(["loanAmount"], "loan amount is negative");
  return { ok: true, value: round(loanAmount / collateralValue, 4), inputs: { loanAmount, collateralValue } };
}

/** Interest coverage = EBITDA / interest expense. Capacity. */
export function interestCoverage(ebitda: number, interestExpense: number): RatioResult {
  const check = requireFinite({ ebitda, interestExpense });
  if (!check.ok) return insufficient(check.missing, "interest coverage needs finite ebitda and interestExpense");
  if (interestExpense <= 0) return insufficient(["interestExpense"], "interest expense is zero or negative");
  return { ok: true, value: round(ebitda / interestExpense, 2), inputs: { ebitda, interestExpense } };
}

/**
 * Fixed-Charge Coverage = (EBITDA - unfinanced capex - cash taxes - distributions)
 *                         / (interest + scheduled principal).
 * The conservative capacity test a credit committee actually underwrites. Each input is required;
 * a missing one is named (you cannot quietly assume distributions = 0).
 */
export function fixedChargeCoverage(args: {
  ebitda: number; unfinancedCapex: number; cashTaxes: number; distributions: number;
  interest: number; scheduledPrincipal: number;
}): RatioResult {
  const check = requireFinite(args);
  if (!check.ok) return insufficient(check.missing, "fixed-charge coverage needs all six inputs finite");
  const fixedCharges = args.interest + args.scheduledPrincipal;
  if (fixedCharges <= 0) return insufficient(["interest", "scheduledPrincipal"], "fixed charges are zero or negative");
  const numerator = args.ebitda - args.unfinancedCapex - args.cashTaxes - args.distributions;
  return { ok: true, value: round(numerator / fixedCharges, 2), inputs: { ...args, fixedCharges, numerator } };
}

/** Debt yield = net operating income / loan amount. Collateral/return. */
export function debtYield(noi: number, loanAmount: number): RatioResult {
  const check = requireFinite({ noi, loanAmount });
  if (!check.ok) return insufficient(check.missing, "debt yield needs finite noi and loanAmount");
  if (loanAmount <= 0) return insufficient(["loanAmount"], "loan amount is zero or negative");
  return { ok: true, value: round(noi / loanAmount, 4), inputs: { noi, loanAmount } };
}

/**
 * Normalize EBITDA = reported EBITDA + sum of add-backs. Add-backs are named & itemized so the memo
 * can show its work (D&A is standard; owner-comp and one-time add-backs are where deals get aggressive).
 * A non-finite reported base or any non-finite add-back is `insufficient_data`.
 */
export function normalizeEbitda(reported: number, addBacks: Record<string, number> = {}): RatioResult {
  const check = requireFinite({ reported, ...addBacks });
  if (!check.ok) return insufficient(check.missing, "normalized EBITDA needs a finite base and finite add-backs");
  const total = Object.values(addBacks).reduce((sum, v) => sum + v, reported);
  return { ok: true, value: round(total, 2), inputs: { reported, ...addBacks, total } };
}

export type CovenantOperator = ">=" | "<=" | ">" | "<";
export type CovenantTest =
  | { ok: true; pass: boolean; actual: number; threshold: number; operator: CovenantOperator; headroom: number }
  | { ok: false; reason: "insufficient_data"; detail: string };

/**
 * Test a covenant deterministically: actual vs threshold under an operator. `headroom` is the signed
 * cushion (positive = passing with room, negative = breach depth) — the number a workout banker watches.
 * If `actual` is itself an insufficient_data RatioResult, the covenant is insufficient_data (you cannot
 * test a covenant on a ratio you could not compute).
 */
export function testCovenant(actual: number | RatioResult, threshold: number, operator: CovenantOperator): CovenantTest {
  const value = typeof actual === "number" ? actual : actual.ok ? actual.value : null;
  if (value === null || !finite(value)) return { ok: false, reason: "insufficient_data", detail: "covenant actual is not a computable number" };
  if (!finite(threshold)) return { ok: false, reason: "insufficient_data", detail: "covenant threshold is not finite" };
  const pass =
    operator === ">=" ? value >= threshold :
    operator === "<=" ? value <= threshold :
    operator === ">" ? value > threshold :
    value < threshold;
  // headroom: distance from the line in the direction that passes (>= / > → actual-threshold; <= / < → threshold-actual)
  const headroom = operator === ">=" || operator === ">" ? round(value - threshold, 4) : round(threshold - value, 4);
  return { ok: true, pass, actual: round(value, 4), threshold, operator, headroom };
}

export type FootingResult =
  | { ok: true; foots: boolean; sum: number; reported: number; difference: number }
  | { ok: false; reason: "insufficient_data"; missing: string[]; detail: string };

/**
 * Tie-out / footing: does the sum of line items equal the reported total within tolerance?
 * The deterministic check that catches an LLM mis-reading a subtotal as a line item (or vice versa)
 * before any ratio is computed on a sheet that does not internally reconcile.
 */
export function foots(lineItems: number[], reportedTotal: number, tolerance = 0.5): FootingResult {
  const missing: string[] = [];
  lineItems.forEach((v, i) => { if (!finite(v)) missing.push(`lineItems[${i}]`); });
  if (!finite(reportedTotal)) missing.push("reportedTotal");
  if (missing.length) return { ok: false, reason: "insufficient_data", missing, detail: "footing needs all line items and the total finite" };
  const sum = round(lineItems.reduce((a, b) => a + b, 0), 4);
  const difference = round(sum - reportedTotal, 4);
  return { ok: true, foots: Math.abs(difference) <= Math.abs(tolerance), sum, reported: reportedTotal, difference };
}

export type PeriodSpread<T> = { period: string; result: T };
export type TrendDirection = "improving" | "deteriorating" | "flat" | "indeterminate";

/**
 * Multi-period spread: apply a ratio across labeled periods and classify the trend across the periods
 * that actually computed (insufficient_data periods are carried, not dropped — and if too few periods
 * computed, the trend is `indeterminate`, never guessed).
 *
 * `higherIsBetter` distinguishes DSCR/coverage (up = improving) from leverage/LTV (down = improving).
 */
export function spreadByPeriod(
  periods: Array<{ period: string; compute: () => RatioResult }>,
  opts: { higherIsBetter: boolean },
): { spreads: Array<PeriodSpread<RatioResult>>; trend: TrendDirection } {
  const spreads = periods.map(({ period, compute }) => ({ period, result: compute() }));
  const values = spreads.filter((s): s is PeriodSpread<Extract<RatioResult, { ok: true }>> => s.result.ok).map((s) => s.result.value);
  if (values.length < 2) return { spreads, trend: "indeterminate" };
  const first = values[0];
  const last = values[values.length - 1];
  if (last === first) return { spreads, trend: "flat" };
  const rose = last > first;
  const better = opts.higherIsBetter ? rose : !rose;
  return { spreads, trend: better ? "improving" : "deteriorating" };
}
