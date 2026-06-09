/**
 * Append-only eval trace+score store — the NECESSARY HALO eval substrate.
 *
 * NOT describe()-only (a Vitest file is pass/fail at HEAD; it discards the trace and cannot say
 * "which case degraded since the last commit, by how much, and which check broke") and NOT the
 * 6-table Convex relational model (premature for a single founder). The judged-research verdict:
 * the cheapest thing that addresses the root cause — regression attribution + trace retention +
 * failure-mode clustering — is an append-only JSONL keyed by (commitSha, caseId, ts) + a diff.
 *
 * Production pattern (web-verified convergence): OpenAI agent_improvement_loop, LangSmith, Braintrust,
 * Anthropic evals, W&B Weave all persist traces + versioned rows + cross-version diffs. This is the
 * single-founder JSONL version of that — graduate to a table only past ~30-50 cases or >1 change/week.
 *
 * Pure diff (diffByCase) so it is fully testable; the fs wrappers are thin.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type EvalRunRecord = {
  ts: number;
  commitSha: string;
  /** Hash of the dirty worktree content/status when the run was recorded. Clean runs may omit it. */
  worktreeHash?: string;
  gitDirty?: boolean;
  /** "ladder" | "workflow" | "credit" | ... */
  suite: string;
  /** Stable id so the same case is comparable across commits, e.g. "ladder:L6:gpt-5.4-mini". */
  caseId: string;
  model?: string;
  status: "pass" | "fail" | "skip";
  /** 0..1 (e.g. checksPassed / checksTotal). The magnitude a pass/fail test cannot express. */
  score?: number;
  /** Per-check booleans → lets the diff name the failure MODE (which check went true→false), not just "score dropped". */
  checks?: Record<string, boolean>;
  failureSummary?: string;
  /** Path to the retained raw trace (run log / agentSteps export) — so a failure can be replayed later. */
  traceRef?: string;
  harnessVersion?: string;
};

export const DEFAULT_STORE = "docs/eval/eval-runs.jsonl";

export function appendEvalRuns(records: EvalRunRecord[], file: string = DEFAULT_STORE): void {
  if (!records.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

export function readEvalRuns(file: string = DEFAULT_STORE): EvalRunRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EvalRunRecord);
}

export type CaseDelta = {
  caseId: string;
  suite: string;
  beforeCommit?: string;
  afterCommit: string;
  beforeRunKey?: string;
  afterRunKey: string;
  before?: EvalRunRecord;
  after: EvalRunRecord;
  verdict: "improved" | "degraded" | "same" | "new";
  /** after.score - before.score (the magnitude). */
  scoreDelta?: number;
  /** Checks that went true → false: the named failure mode the diff surfaces. */
  newlyFailingChecks?: string[];
};

/**
 * Per-case regression attribution: for each case, compare its latest record at two commits
 * (default = the two most-recent distinct commits in the store). This is the exact capability a
 * `describe()` file structurally cannot provide.
 */
export function diffByCase(records: EvalRunRecord[], opts: { from?: string; to?: string } = {}): CaseDelta[] {
  const runKeys = distinctRunKeysNewestFirst(records);
  const to = opts.to ?? runKeys[0];
  const from = opts.from ?? runKeys[1];
  if (!to) return [];
  const latestAt = (runKey?: string) => {
    const m = new Map<string, EvalRunRecord>();
    if (!runKey) return m;
    for (const r of records.filter((x) => matchesRunKey(x, runKey)).sort((a, b) => a.ts - b.ts)) m.set(r.caseId, r);
    return m;
  };
  const toMap = latestAt(to);
  const fromMap = latestAt(from);
  const out: CaseDelta[] = [];
  for (const [caseId, after] of toMap) {
    const before = fromMap.get(caseId);
    const verdict: CaseDelta["verdict"] = !before
      ? "new"
      : statusRank(after.status) > statusRank(before.status) ? "improved"
      : statusRank(after.status) < statusRank(before.status) ? "degraded"
      : (after.score ?? 0) > (before.score ?? 0) ? "improved"
      : (after.score ?? 0) < (before.score ?? 0) ? "degraded"
      : "same";
    out.push({
      caseId,
      suite: after.suite,
      beforeCommit: before?.commitSha,
      afterCommit: after.commitSha,
      beforeRunKey: from,
      afterRunKey: to,
      before,
      after,
      verdict,
      scoreDelta: before ? Number(((after.score ?? 0) - (before.score ?? 0)).toFixed(4)) : undefined,
      newlyFailingChecks: before ? failedChecksDelta(before, after) : undefined,
    });
  }
  // degraded first (what a human / coding-agent must look at), then new, improved, same.
  return out.sort((a, b) => verdictOrder(a.verdict) - verdictOrder(b.verdict) || a.caseId.localeCompare(b.caseId));
}

export function summarizeDiff(diffs: CaseDelta[]): { improved: number; degraded: number; same: number; new: number } {
  const c = { improved: 0, degraded: 0, same: 0, new: 0 };
  for (const d of diffs) c[d.verdict]++;
  return c;
}

function statusRank(s: EvalRunRecord["status"]): number { return s === "pass" ? 2 : s === "skip" ? 1 : 0; }
function verdictOrder(v: CaseDelta["verdict"]): number { return { degraded: 0, new: 1, improved: 2, same: 3 }[v]; }

export function runKey(record: EvalRunRecord): string {
  return record.gitDirty || record.worktreeHash ? `${record.commitSha}+dirty.${record.worktreeHash ?? "unknown"}` : record.commitSha;
}

function matchesRunKey(record: EvalRunRecord, key: string): boolean {
  return runKey(record) === key || record.commitSha === key;
}

function distinctRunKeysNewestFirst(records: EvalRunRecord[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...records].sort((a, b) => b.ts - a.ts)) {
    const key = runKey(r);
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

function failedChecksDelta(before: EvalRunRecord, after: EvalRunRecord): string[] {
  if (!before.checks || !after.checks) return [];
  return Object.keys(after.checks).filter((k) => before.checks![k] === true && after.checks![k] === false);
}
