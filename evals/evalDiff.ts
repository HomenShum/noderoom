/**
 * `npm run eval:diff` — per-case regression attribution between the two most-recent commits in the
 * eval store (or `--from <sha> --to <sha>`). The diff a describe() test cannot produce; exits 1 on a
 * degradation so it can gate a merge (the production pattern: Braintrust/LangSmith block on regress).
 */
import { readEvalRuns, diffByCase, summarizeDiff, DEFAULT_STORE } from "./evalStore";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const store = arg("store") ?? DEFAULT_STORE;
const records = readEvalRuns(store);
if (!records.length) {
  console.log(`No eval runs in ${store}. Run a suite that appends to the store first (e.g. evals/ladder.ts --record).`);
  process.exit(0);
}

const diffs = diffByCase(records, { from: arg("from"), to: arg("to") });
const sum = summarizeDiff(diffs);
const to = diffs[0]?.afterRunKey ?? "(latest)";
const from = diffs[0]?.beforeRunKey ?? "(no baseline)";
console.log(`Eval diff  ${from} -> ${to}   ${sum.degraded} degraded · ${sum.improved} improved · ${sum.new} new · ${sum.same} same\n`);

const label: Record<string, string> = { degraded: "x DEGRADED", improved: "+ improved", new: "  new" };
for (const d of diffs) {
  if (d.verdict === "same") continue; // show only what changed
  const mag = d.scoreDelta !== undefined ? ` (${d.scoreDelta > 0 ? "+" : ""}${d.scoreDelta})` : "";
  const broke = d.newlyFailingChecks?.length ? `  broke: ${d.newlyFailingChecks.join(", ")}` : "";
  console.log(`  ${(label[d.verdict] ?? d.verdict).padEnd(11)} ${d.caseId.padEnd(30)}${mag}${broke}`);
  if (d.verdict === "degraded" && d.after.traceRef) console.log(`              trace: ${d.after.traceRef}`);
}

if (sum.degraded > 0) process.exit(1); // gate: a degradation fails the diff
