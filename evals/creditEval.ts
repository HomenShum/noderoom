/**
 * Credit decision eval — wires the deterministic creditRatios math into the HALO loop.
 *
 * Each borrower fixture is a spread an analyst would receive. The eval asks: does the deterministic
 * math produce the RIGHT credit decision and surface gaps honestly? A healthy borrower must clear
 * covenants; a stressed borrower's breach must be DETECTED; an incomplete spread must surface
 * insufficient_data (never a fabricated pass). Each fixture's checks are recorded to the SAME eval
 * store as the ladder (suite "credit") so `npm run eval:diff` tracks credit regressions across runs.
 *
 *   npm run eval:credit            # run + print
 *   npm run eval:credit -- --record  # also append to the eval store (used by agent:improve)
 */
import "../scripts/benchmark/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  dscr, leverage, ltv, normalizeEbitda, foots, testCovenant, type RatioResult,
} from "../src/nodeagent/skills/finance/creditRatios";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";

type Borrower = {
  id: string;
  name: string;
  reportedEbitda: number;
  addBacks: Record<string, number>;
  ebitdaBuildLineItems: number[];
  statedNormalizedEbitda: number;
  totalDebt: number;
  cashAvailable: number;
  debtService: number;
  loan: number;
  collateral: number;
  policy: { minDscr: number; maxLeverage: number; maxLtv: number };
  expect: "approve" | "breach" | "insufficient_data";
};

const POLICY = { minDscr: 1.25, maxLeverage: 4.0, maxLtv: 0.75 };

const BORROWERS: Borrower[] = [
  {
    id: "cascade-healthy", name: "Cascade Components LLC",
    reportedEbitda: 1.8, addBacks: { ownerComp: 0.15, oneTimeLegal: 0.05 },
    ebitdaBuildLineItems: [1.8, 0.15, 0.05], statedNormalizedEbitda: 2.0,
    totalDebt: 6.4, cashAvailable: 1.96, debtService: 1.4, loan: 4.0, collateral: 6.0,
    policy: POLICY, expect: "approve",
  },
  {
    id: "summit-stressed", name: "Summit Fabrication Inc",
    reportedEbitda: 1.2, addBacks: { oneTime: 0.1 },
    ebitdaBuildLineItems: [1.2, 0.1], statedNormalizedEbitda: 1.3,
    totalDebt: 6.8, cashAvailable: 1.35, debtService: 1.25, loan: 4.5, collateral: 6.0,
    policy: POLICY, expect: "breach",
  },
  {
    id: "delta-incomplete", name: "Delta Machining Co",
    reportedEbitda: 1.5, addBacks: {},
    ebitdaBuildLineItems: [1.5], statedNormalizedEbitda: 1.5,
    totalDebt: 5.0, cashAvailable: 1.6, debtService: Number.NaN, loan: 3.5, collateral: 5.0,
    policy: POLICY, expect: "insufficient_data",
  },
];

type Evaluated = { checks: Record<string, boolean>; detail: Record<string, RatioResult | unknown> };

function evaluate(b: Borrower): Evaluated {
  const ebitda = normalizeEbitda(b.reportedEbitda, b.addBacks);
  const ebitdaValue = ebitda.ok ? ebitda.value : Number.NaN;
  const lev = leverage(b.totalDebt, ebitdaValue);
  const d = dscr(b.cashAvailable, b.debtService);
  const l = ltv(b.loan, b.collateral);
  const foot = foots(b.ebitdaBuildLineItems, b.statedNormalizedEbitda, 0.01);
  const dscrCov = testCovenant(d, b.policy.minDscr, ">=");
  const levCov = testCovenant(lev, b.policy.maxLeverage, "<=");
  const ltvCov = testCovenant(l, b.policy.maxLtv, "<=");
  const detail = { ebitda, lev, dscr: d, ltv: l, foot, dscrCov, levCov, ltvCov };

  let checks: Record<string, boolean>;
  if (b.expect === "approve") {
    checks = {
      footsTieOut: foot.ok && foot.foots,
      dscrPass: dscrCov.ok && dscrCov.pass,
      leveragePass: levCov.ok && levCov.pass,
      ltvPass: ltvCov.ok && ltvCov.pass,
    };
  } else if (b.expect === "breach") {
    checks = {
      ratiosComputed: d.ok && lev.ok,
      breachDetected: (dscrCov.ok && !dscrCov.pass) || (levCov.ok && !levCov.pass),
    };
  } else {
    checks = {
      // A missing/invalid input must surface as insufficient_data, NOT a computed number.
      gapSurfaced: !d.ok || !lev.ok,
    };
  }
  return { checks, detail };
}

function scoreChecks(checks: Record<string, boolean>): number {
  const values = Object.values(checks);
  if (values.length === 0) return 0;
  return Number((values.filter(Boolean).length / values.length).toFixed(4));
}

// ── P1-7: the cell-mapping seam — where production spreading ACTUALLY fails ──────────────────────
// A mapper (LLM in the live lane; scripted here) proposes cell→argument BINDINGS over a borrower
// sheet; a deterministic validator scores the mapping as its OWN checks; the math only computes
// from validated bindings and carries {cellRef, version} provenance — the mapper never authors
// evidence, and a mis-binding surfaces as data (mapping_rejected), never a silently-wrong ratio.
type SheetCell = { ref: string; label: string; value: number; version: number };
type Bindings = Record<string, string>; // ratio argument -> cell ref

const BORROWER_SHEET: SheetCell[] = [
  { ref: "B2", label: "Total revenue (TTM)", value: 18.2, version: 4 },
  { ref: "B4", label: "Adjusted EBITDA (TTM)", value: 2.0, version: 3 },
  { ref: "B7", label: "Total funded debt", value: 6.4, version: 2 },
  { ref: "B9", label: "Total debt service (P+I)", value: 1.4, version: 5 },
  { ref: "B11", label: "Cash available for debt service", value: 1.96, version: 1 },
];

/** Deterministic binding sanity: the bound cell's LABEL must match the argument's required keywords
 *  (and totalDebt must not grab a "service" or "revenue" line). Keyword rules, not an LLM judge. */
function validateBindings(sheet: SheetCell[], bindings: Bindings): { ok: boolean; wrong: string[] } {
  const cell = (ref: string) => sheet.find((c) => c.ref === ref);
  const rules: Record<string, (label: string) => boolean> = {
    ebitda: (l) => /ebitda/i.test(l),
    totalDebt: (l) => /debt/i.test(l) && !/service/i.test(l),
    cashAvailable: (l) => /cash available/i.test(l),
    totalDebtService: (l) => /debt service/i.test(l) && !/cash/i.test(l),
  };
  const wrong = Object.entries(rules).filter(([arg, rule]) => {
    const c = cell(bindings[arg] ?? "");
    return !c || !rule(c.label);
  }).map(([arg]) => arg);
  return { ok: wrong.length === 0, wrong };
}

/** Compute DSCR + leverage FROM the bound cells, attaching per-argument provenance. Refuses to
 *  compute when the mapping fails validation — mapping_rejected as data. */
function computeFromBindings(sheet: SheetCell[], bindings: Bindings) {
  const validation = validateBindings(sheet, bindings);
  if (!validation.ok) return { ok: false as const, reason: "mapping_rejected" as const, wrong: validation.wrong };
  const cell = (ref: string) => sheet.find((c) => c.ref === ref)!;
  const provenance = Object.fromEntries(Object.entries(bindings).map(([arg, ref]) => [arg, { cellRef: ref, version: cell(ref).version }]));
  return {
    ok: true as const,
    dscr: dscr(cell(bindings.cashAvailable).value, cell(bindings.totalDebtService).value),
    lev: leverage(cell(bindings.totalDebt).value, cell(bindings.ebitda).value),
    provenance,
  };
}

const CORRECT_BINDINGS: Bindings = { ebitda: "B4", totalDebt: "B7", cashAvailable: "B11", totalDebtService: "B9" };
const MISBOUND_BINDINGS: Bindings = { ebitda: "B2" /* revenue! the classic spreading error */, totalDebt: "B7", cashAvailable: "B11", totalDebtService: "B9" };

function evaluateMappingCases(): Array<{ id: string; expect: string; checks: Record<string, boolean>; detail: unknown; pass: boolean; score: number }> {
  const good = computeFromBindings(BORROWER_SHEET, CORRECT_BINDINGS);
  const goodChecks = {
    bindingsValid: good.ok,
    dscrCorrect: good.ok && good.dscr.ok && good.dscr.value === 1.4,
    leverageCorrect: good.ok && good.lev.ok && good.lev.value === 3.2,
    provenanceCarried: good.ok && Object.values(good.provenance).every((p) => !!p.cellRef && typeof p.version === "number"),
  };
  const bad = computeFromBindings(BORROWER_SHEET, MISBOUND_BINDINGS);
  const badChecks = {
    misbindDetected: !bad.ok && bad.reason === "mapping_rejected" && bad.wrong.includes("ebitda"),
    notSilentlyComputed: !bad.ok, // a revenue-as-EBITDA leverage of 0.35x must never exist
  };
  return [
    { id: "mapping-correct", expect: "compute+provenance", checks: goodChecks, detail: good, pass: Object.values(goodChecks).every(Boolean), score: scoreChecks(goodChecks) },
    { id: "mapping-misbind", expect: "mapping_rejected", checks: badChecks, detail: bad, pass: Object.values(badChecks).every(Boolean), score: scoreChecks(badChecks) },
  ];
}

const record = process.argv.includes("--record");
const borrowerResults = BORROWERS.map((b) => {
  const { checks, detail } = evaluate(b);
  const pass = Object.values(checks).every(Boolean);
  return { id: b.id, expect: b.expect as string, checks, detail: { borrower: b, ...((detail as object) ?? {}) }, pass, score: scoreChecks(checks) };
});
const results = [...borrowerResults, ...evaluateMappingCases()];

for (const r of results) {
  const flags = Object.entries(r.checks).map(([k, v]) => `${v ? "+" : "x"}${k}`).join(" ");
  console.log(`${r.pass ? "PASS" : "FAIL"} credit:${r.id.padEnd(18)} expect=${r.expect.padEnd(18)} ${flags}`);
}

if (record) {
  const identity = readGitIdentity();
  const ts = Date.now();
  const store = DEFAULT_STORE;
  const keyRecord: EvalRunRecord = { ts, commitSha: identity.commitSha, worktreeHash: identity.worktreeHash, gitDirty: identity.gitDirty, suite: "credit", caseId: "identity", status: "skip" };
  const stamp = `${new Date(ts).toISOString().replace(/[-:.]/g, "")}-${runKey(keyRecord).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60)}`;
  const traceDir = join("docs", "eval", "traces", "credit", stamp);
  mkdirSync(traceDir, { recursive: true });
  const records: EvalRunRecord[] = results.map((r) => {
    const file = join(traceDir, `${r.id}.json`);
    writeFileSync(file, JSON.stringify({ schema: 1, generatedAt: new Date(ts).toISOString(), checks: r.checks, detail: r.detail }, null, 2));
    return {
      ts, commitSha: identity.commitSha, worktreeHash: identity.worktreeHash, gitDirty: identity.gitDirty,
      caseSetHash: computeCaseSetHash(results.map((x) => `credit:${x.id}`)), // P0-1
      suite: "credit", caseId: `credit:${r.id}`, model: "deterministic",
      status: r.pass ? "pass" : "fail", score: r.score, checks: r.checks,
      failureSummary: r.pass ? undefined : `expected ${r.expect}; checks ${JSON.stringify(r.checks)}`,
      traceRef: relative(process.cwd(), file).replace(/\\/g, "/"), harnessVersion: "credit-v2",
    };
  });
  appendEvalRuns(records, store);
  console.log(`\nrecorded ${records.length} credit case(s) to ${store} (${runKey(records[0])}). Diff: npm run eval:diff`);
}

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) { console.error(`\n${failed} credit case(s) failed`); process.exitCode = 1; }
