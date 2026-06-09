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
} from "../src/agent/creditRatios";
import { appendEvalRuns, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
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

const record = process.argv.includes("--record");
const results = BORROWERS.map((b) => {
  const { checks, detail } = evaluate(b);
  const pass = Object.values(checks).every(Boolean);
  return { borrower: b, checks, detail, pass, score: scoreChecks(checks) };
});

for (const r of results) {
  const flags = Object.entries(r.checks).map(([k, v]) => `${v ? "+" : "x"}${k}`).join(" ");
  console.log(`${r.pass ? "PASS" : "FAIL"} credit:${r.borrower.id.padEnd(18)} expect=${r.borrower.expect.padEnd(17)} ${flags}`);
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
    const file = join(traceDir, `${r.borrower.id}.json`);
    writeFileSync(file, JSON.stringify({ schema: 1, generatedAt: new Date(ts).toISOString(), borrower: r.borrower, checks: r.checks, detail: r.detail }, null, 2));
    return {
      ts, commitSha: identity.commitSha, worktreeHash: identity.worktreeHash, gitDirty: identity.gitDirty,
      suite: "credit", caseId: `credit:${r.borrower.id}`, model: "deterministic",
      status: r.pass ? "pass" : "fail", score: r.score, checks: r.checks,
      failureSummary: r.pass ? undefined : `expected ${r.borrower.expect}; checks ${JSON.stringify(r.checks)}`,
      traceRef: relative(process.cwd(), file).replace(/\\/g, "/"), harnessVersion: "credit-v1",
    };
  });
  appendEvalRuns(records, store);
  console.log(`\nrecorded ${records.length} credit case(s) to ${store} (${runKey(records[0])}). Diff: npm run eval:diff`);
}

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) { console.error(`\n${failed} credit case(s) failed`); process.exitCode = 1; }
