/**
 * runway.ts — deterministic runway & milestone math for the diligence agent.
 *
 * "Learn like AI, run like code": the agent GATHERS the inputs (cash, burn,
 * growth) from sourced company rows, but the runway number itself is computed
 * here, deterministically, with the assumptions made explicit and attributable.
 * Nothing in this file calls a model — so the headline number is never an LLM
 * hallucination. The agent then commits the result through the managed CAS write
 * path (write_locked_cell_results) as an evidence-bearing patch.
 *
 * This is the honest replacement for the previously-hardcoded "/ask runway" note
 * string in scripts/walkthroughs/capture-finance-diligence.ts.
 */

export interface RunwayInputs {
  company: string;
  /** Cash on hand, USD. */
  cashUsd: number;
  /** Net monthly burn, USD (>0 = burning cash; <=0 = cash-flow positive). */
  monthlyBurnUsd: number;
  /** Optional monthly revenue growth rate, e.g. 0.08 for 8% MoM (decays burn toward a fixed-cost floor, never to breakeven). */
  momGrowthRate?: number;
  /** Source label for the inputs (e.g. "NetSuite export", "data room / deck p.12"). */
  source?: string;
}

export type RunwayStatus = "healthy" | "watch" | "critical" | "cash_flow_positive";

export interface RunwayMilestone {
  /** Whole months from today. */
  month: number;
  label: string;
}

export interface RunwayAssumption {
  label: string;
  value: string;
  source: string;
}

export interface RunwayResult {
  company: string;
  /** Months of runway (rounded to 1 decimal). Infinity → cash-flow positive. */
  runwayMonths: number;
  status: RunwayStatus;
  /** One-line, IC-ready summary (the string the agent commits to the cell). */
  headline: string;
  milestones: RunwayMilestone[];
  assumptions: RunwayAssumption[];
  /** True when inputs were insufficient to compute (agent must gather more). */
  needsInput: boolean;
}

// Banking thresholds (months). Below 9 is a financing-risk flag for MM/startup DD.
const CRITICAL_MONTHS = 9;
const WATCH_MONTHS = 18;
const MAX_PROJECTION_MONTHS = 120; // bound the projection so growth math can't run away

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Fixed costs don't vanish as revenue grows, so net burn cannot decay to zero from
// growth alone. Floor the monthly gap at this fraction of the initial burn — without it,
// geometric decay fabricates an effectively-infinite runway (and a false "cash-flow
// positive") for a company that is, in fact, still burning cash every single month.
const BURN_FLOOR_FRACTION = 0.2;
const MAX_GROWTH_RATE = 0.5; // clamp absurd MoM inputs so the decay model stays sane

/**
 * Months until cash hits zero. With a growth rate, the monthly funding gap shrinks as
 * revenue grows — but only down to a fixed-cost floor, so a burning company never reaches
 * breakeven from growth alone. Without growth it's the simple cash / burn. A company that
 * outlasts the projection horizon returns a finite, capped value (NOT Infinity); only
 * genuinely non-burning input (monthlyBurnUsd <= 0) is reported as cash-flow positive.
 */
function projectRunwayMonths(cashUsd: number, monthlyBurnUsd: number, momGrowthRate: number): number {
  if (monthlyBurnUsd <= 0) return Infinity; // genuinely not burning → cash-flow positive
  if (cashUsd <= 0) return 0;
  if (!momGrowthRate || momGrowthRate <= 0) return cashUsd / monthlyBurnUsd;

  const growth = Math.min(momGrowthRate, MAX_GROWTH_RATE);
  const floor = monthlyBurnUsd * BURN_FLOOR_FRACTION;
  let cash = cashUsd;
  let months = 0;
  let gap = monthlyBurnUsd;
  while (cash > 0 && months < MAX_PROJECTION_MONTHS) {
    const next = cash - gap;
    if (next <= 0) return months + cash / gap; // fractional last month
    cash = next;
    months += 1;
    gap = Math.max(floor, gap * (1 - growth)); // decay toward the fixed-cost floor, never below
  }
  // Still burning at the horizon: a very long but FINITE, honest runway — never "cash-flow positive".
  return MAX_PROJECTION_MONTHS;
}

function statusFor(runwayMonths: number): RunwayStatus {
  if (!Number.isFinite(runwayMonths)) return "cash_flow_positive";
  if (runwayMonths < CRITICAL_MONTHS) return "critical";
  if (runwayMonths < WATCH_MONTHS) return "watch";
  return "healthy";
}

/** Deterministic milestone schedule derived from the runway length. */
function milestonesFor(runwayMonths: number): RunwayMilestone[] {
  if (!Number.isFinite(runwayMonths)) {
    return [{ month: 0, label: "Cash-flow positive — milestone: sustain margin, optional growth raise" }];
  }
  const r = Math.floor(runwayMonths);
  const ms: RunwayMilestone[] = [];
  // Treasury / IC pack is an early, always-present banking milestone.
  ms.push({ month: 1, label: "Treasury diligence pack ready for IC" });
  if (r >= 4) ms.push({ month: Math.max(2, Math.floor(runwayMonths * 0.5)), label: "Mid-runway checkpoint — default-alive review" });
  // Fundraise window opens ~6 months before zero (standard raise lead time).
  const raiseAt = Math.max(2, r - 6);
  if (raiseAt < r) ms.push({ month: raiseAt, label: "Fundraise window opens (raise or cut before zero)" });
  ms.push({ month: r, label: "Projected cash-zero — must close raise or reach breakeven" });
  // De-dup by month, keep order.
  const seen = new Set<number>();
  return ms.filter((m) => (seen.has(m.month) ? false : (seen.add(m.month), true))).sort((a, b) => a.month - b.month);
}

export function computeRunway(input: RunwayInputs): RunwayResult {
  const { company } = input;
  const cashUsd = Number(input.cashUsd);
  const monthlyBurnUsd = Number(input.monthlyBurnUsd);
  const source = input.source?.trim() || "company data room";

  const needsInput = !company || !Number.isFinite(cashUsd) || !Number.isFinite(monthlyBurnUsd);
  if (needsInput) {
    return {
      company: company || "(unknown)",
      runwayMonths: 0,
      status: "critical",
      headline: `${company || "Company"}: runway not computable — gather cash on hand and monthly burn first.`,
      milestones: [],
      assumptions: [],
      needsInput: true,
    };
  }

  const growth = input.momGrowthRate && input.momGrowthRate > 0 ? input.momGrowthRate : 0;
  const raw = projectRunwayMonths(cashUsd, monthlyBurnUsd, growth);
  const runwayMonths = Number.isFinite(raw) ? round1(raw) : Infinity;
  const status = statusFor(runwayMonths);
  const milestones = milestonesFor(runwayMonths);

  const assumptions: RunwayAssumption[] = [
    { label: "Cash on hand", value: usd(cashUsd), source },
    { label: "Net monthly burn", value: usd(monthlyBurnUsd), source },
  ];
  if (growth) assumptions.push({ label: "MoM growth (burn decay)", value: `${round1(growth * 100)}%`, source });

  const headline =
    status === "cash_flow_positive"
      ? `${company} is cash-flow positive — milestone: sustain margin; optional growth raise.`
      : `${company} runway: ${runwayMonths} months at ${usd(monthlyBurnUsd)}/mo burn; milestone: ${milestones[0]?.label ?? "treasury diligence pack ready for IC"}.`;

  return { company, runwayMonths, status, headline, milestones, assumptions, needsInput: false };
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${round1(n / 1_000_000)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

// ── Deterministic SVG chart (no chart lib, no new artifact kind needed) ────────
// Renders a runway bar with milestone ticks. Embeddable in an HTML note artifact
// (which already renders HTML) or exported as-is. Colors are inline (standalone).
const STATUS_COLOR: Record<RunwayStatus, string> = {
  healthy: "#1F8A5B",
  watch: "#B45309",
  critical: "#B3261E",
  cash_flow_positive: "#1F8A5B",
};

export function runwayChartSvg(r: RunwayResult): string {
  const W = 600, H = 132, padL = 16, padR = 16, barY = 64, barH = 26;
  const trackW = W - padL - padR;
  const color = STATUS_COLOR[r.status];
  const maxMonths = Number.isFinite(r.runwayMonths) ? Math.max(12, Math.ceil(r.runwayMonths * 1.15)) : 24;
  const fillW = Number.isFinite(r.runwayMonths) ? Math.min(trackW, (r.runwayMonths / maxMonths) * trackW) : trackW;
  const monthsLabel = Number.isFinite(r.runwayMonths) ? `${r.runwayMonths} mo` : "cash-flow positive";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const ticks = r.milestones
    .filter((m) => m.month > 0 && m.month <= maxMonths)
    .map((m) => {
      const x = padL + (m.month / maxMonths) * trackW;
      return `<line x1="${x.toFixed(1)}" y1="${barY - 8}" x2="${x.toFixed(1)}" y2="${barY + barH + 8}" stroke="#6b7280" stroke-width="1" stroke-dasharray="2 2"/>` +
        `<text x="${x.toFixed(1)}" y="${barY + barH + 22}" font-size="9" fill="#6b7280" font-family="monospace" text-anchor="middle">m${m.month}</text>`;
    })
    .join("");

  return [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(r.company)} runway ${monthsLabel}">`,
    `<text x="${padL}" y="26" font-size="15" font-weight="700" fill="#111827" font-family="system-ui,sans-serif">${esc(r.company)} · runway</text>`,
    `<text x="${W - padR}" y="26" font-size="14" font-weight="700" fill="${color}" font-family="monospace" text-anchor="end">${esc(monthsLabel)} · ${r.status}</text>`,
    `<rect x="${padL}" y="${barY}" width="${trackW}" height="${barH}" rx="6" fill="#eef0f3"/>`,
    `<rect x="${padL}" y="${barY}" width="${fillW.toFixed(1)}" height="${barH}" rx="6" fill="${color}" opacity="0.85"/>`,
    ticks,
    `<text x="${padL}" y="${H - 6}" font-size="10" fill="#6b7280" font-family="system-ui,sans-serif">${esc(r.assumptions.map((a) => `${a.label} ${a.value}`).join(" · ") || "assumptions pending")}</text>`,
    `</svg>`,
  ].join("");
}
