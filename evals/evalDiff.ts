/**
 * `npm run eval:diff` — per-case regression attribution between the two most-recent commits in the
 * eval store (or `--from <sha> --to <sha>`). The diff a describe() test cannot produce; exits 1 on a
 * degradation so it can gate a merge (the production pattern: Braintrust/LangSmith block on regress).
 */
import { readEvalRuns, diffByCase, summarizeDiff, DEFAULT_STORE } from "./evalStore";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * P0-2 tamper guard. A self-improvement loop's canonical proxy-hack is editing the store, the
 * goldens, or the gate itself (47-74% of unguarded "wins" in the literature are proxy hacks).
 *  - Append-only store invariant: ALWAYS on — rewriting committed eval history is unambiguous
 *    tampering even mid-development (arms itself once the store is first committed).
 *  - Harness/golden edits: behind --tamper-strict — attended dev legitimately edits the harness;
 *    the unattended loop passes the flag so a loop-originated gate patch fails red.
 */
function tamperIssues(storePath: string): string[] {
  const issues: string[] = [];
  try {
    const headCopy = execSync(`git show HEAD:"${storePath.replace(/\\/g, "/")}"`, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString();
    const working = existsSync(storePath) ? readFileSync(storePath, "utf8") : "";
    const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n");
    if (!normalizeNewlines(working).startsWith(normalizeNewlines(headCopy))) issues.push(`${storePath} is not append-only vs HEAD — committed eval history was rewritten or deleted`);
  } catch { /* store not tracked at HEAD yet — nothing to guard */ }
  if (process.argv.includes("--tamper-strict")) {
    const guarded = ["evals/evalDiff.ts", "evals/evalStore.ts", "evals/cases.ts"];
    try {
      const dirty = execSync("git diff --name-only HEAD --", { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n").map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean);
      for (const g of guarded) if (dirty.includes(g)) issues.push(`${g} modified in the working tree — the gate/goldens changed; human review required`);
    } catch { /* not a git repo */ }
  }
  return issues;
}

const store = arg("store") ?? DEFAULT_STORE;
const tampered = tamperIssues(store);
if (tampered.length) {
  for (const t of tampered) console.error(`TAMPER: ${t}`);
  process.exit(1);
}
const records = readEvalRuns(store);
if (!records.length) {
  console.log(`No eval runs in ${store}. Run a suite that appends to the store first (e.g. evals/ladder.ts --record).`);
  process.exit(0);
}

const diffs = diffByCase(records, { from: arg("from"), to: arg("to") });
const sum = summarizeDiff(diffs);
const to = diffs[0]?.afterRunKey ?? "(latest)";
const from = diffs[0]?.beforeRunKey ?? "(no baseline)";
console.log(`Eval diff  ${from} -> ${to}   ${sum.degraded} degraded · ${sum.removed} removed · ${sum.improved} improved · ${sum.new} new · ${sum.same} same\n`);

const label: Record<string, string> = { degraded: "x DEGRADED", removed: "x REMOVED", improved: "+ improved", new: "  new" };
for (const d of diffs) {
  if (d.verdict === "same") continue; // show only what changed
  const mag = d.scoreDelta !== undefined ? ` (${d.scoreDelta > 0 ? "+" : ""}${d.scoreDelta})` : "";
  const broke = d.newlyFailingChecks?.length ? `  broke: ${d.newlyFailingChecks.join(", ")}` : "";
  const comparability = [d.modelChanged ? "model-changed" : "", d.checksRedefined ? "checks-redefined" : ""].filter(Boolean).join(", ");
  const note = comparability ? `  [${comparability} — delta not attributable to code alone]` : "";
  console.log(`  ${(label[d.verdict] ?? d.verdict).padEnd(11)} ${d.caseId.padEnd(30)}${mag}${broke}${note}`);
  if (d.verdict === "degraded" && d.after?.traceRef) console.log(`              trace: ${d.after.traceRef}`);
}

// Gate: a degradation OR a silently-removed case fails the diff (case removal is the canonical
// way a gamed loop hides a regression — P0-1).
if (sum.degraded > 0 || sum.removed > 0) process.exit(1);
