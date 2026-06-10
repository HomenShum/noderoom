/**
 * The eval store proves the ONE capability the judged-research said describe()-only lacks:
 * cross-commit regression attribution (which case degraded, by how much, which check broke) +
 * trace retention. Pure diff → fully testable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { appendEvalRuns, readEvalRuns, diffByCase, runKey, summarizeDiff, type EvalRunRecord } from "../evals/evalStore";

const A = "aaaaaaa"; // older commit
const B = "bbbbbbb"; // newer commit
const rec = (over: Partial<EvalRunRecord>): EvalRunRecord => ({ ts: 0, commitSha: A, suite: "ladder", caseId: "x", status: "pass", ...over });

describe("eval store — cross-commit regression attribution (what describe() cannot do)", () => {
  it("names the degraded case, its magnitude, and the exact check that broke", () => {
    const records: EvalRunRecord[] = [
      // commit A (older)
      rec({ ts: 100, commitSha: A, caseId: "ladder:L2", status: "pass", score: 1 }),
      rec({ ts: 101, commitSha: A, caseId: "ladder:L6", status: "pass", score: 1, checks: { readBeforeEdit: true, noClobber: true } }),
      // commit B (newer): L6 regressed, L2 held, L3 is new
      rec({ ts: 200, commitSha: B, caseId: "ladder:L2", status: "pass", score: 1 }),
      rec({ ts: 201, commitSha: B, caseId: "ladder:L6", status: "fail", score: 0.5, checks: { readBeforeEdit: false, noClobber: true } }),
      rec({ ts: 202, commitSha: B, caseId: "ladder:L3", status: "fail", score: 0 }),
    ];

    const diffs = diffByCase(records); // defaults to the two most-recent distinct commits (B vs A)
    const byCase = Object.fromEntries(diffs.map((d) => [d.caseId, d]));

    // L6 degraded — with magnitude AND the named failure mode (a pass/fail test gives none of this).
    expect(byCase["ladder:L6"].verdict).toBe("degraded");
    expect(byCase["ladder:L6"].scoreDelta).toBe(-0.5);
    expect(byCase["ladder:L6"].newlyFailingChecks).toEqual(["readBeforeEdit"]);
    // L2 unchanged; L3 is new (no prior baseline).
    expect(byCase["ladder:L2"].verdict).toBe("same");
    expect(byCase["ladder:L3"].verdict).toBe("new");
    // Degraded sorts first — what a human / coding agent must look at.
    expect(diffs[0].caseId).toBe("ladder:L6");
    expect(summarizeDiff(diffs)).toEqual({ improved: 0, degraded: 1, same: 1, new: 1, removed: 0 });
  });

  it("reports improved when a previously-failing case now passes", () => {
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, caseId: "ladder:L4", status: "fail", score: 0 }),
      rec({ ts: 200, commitSha: B, caseId: "ladder:L4", status: "pass", score: 1 }),
    ];
    const d = diffByCase(records)[0];
    expect(d.verdict).toBe("improved");
    expect(d.scoreDelta).toBe(1);
  });

  it("P0-1: a case deleted from the suite surfaces as REMOVED — never silently vanishes", () => {
    // The canonical gamed-loop move: a failing case is deleted instead of fixed. Before P0-1,
    // diffByCase iterated only the after-run's cases, so the deletion looked like a clean diff.
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, caseId: "ladder:L2", status: "pass", score: 1 }),
      rec({ ts: 101, commitSha: A, caseId: "ladder:L6", status: "fail", score: 0.4 }), // failing...
      rec({ ts: 200, commitSha: B, caseId: "ladder:L2", status: "pass", score: 1 }),   // ...and gone at B
    ];
    const diffs = diffByCase(records);
    const removed = diffs.find((d) => d.verdict === "removed");
    expect(removed?.caseId).toBe("ladder:L6");
    expect(removed?.before?.status).toBe("fail"); // the evidence of what was being hidden
    expect(summarizeDiff(diffs).removed).toBe(1);
    // removed sorts right after degraded — ahead of new/improved/same.
    expect(diffs.findIndex((d) => d.verdict === "removed")).toBeLessThan(diffs.findIndex((d) => d.verdict === "same"));
  });

  it("P0-1: a suite that did not run at all is 'not measured', NOT a wall of removed cases", () => {
    // Real incident from this repo's store: a credit-only --record after a ladder run produced
    // 6 false 'REMOVED' ladder cases. Removal is judged within suites measured on BOTH sides.
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, suite: "ladder", caseId: "ladder:L2", status: "pass", score: 1 }),
      rec({ ts: 101, commitSha: A, suite: "credit", caseId: "credit:cascade", status: "pass", score: 1 }),
      rec({ ts: 200, commitSha: B, suite: "credit", caseId: "credit:cascade", status: "pass", score: 1 }), // credit-only run at B
    ];
    const diffs = diffByCase(records);
    expect(summarizeDiff(diffs).removed).toBe(0);            // ladder wasn't measured at B — not "removed"
    expect(diffs.find((d) => d.caseId === "ladder:L2")).toBeUndefined();
  });

  it("P0-1: a model swap is annotated modelChanged — the delta is not attributed to code alone", () => {
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, caseId: "ladder:L3", status: "pass", score: 1, model: "gemini-3.5-flash" }),
      rec({ ts: 200, commitSha: B, caseId: "ladder:L3", status: "fail", score: 0.5, model: "qwen3-coder:free" }),
    ];
    const d = diffByCase(records)[0];
    expect(d.verdict).toBe("degraded");
    expect(d.modelChanged).toBe(true); // fallback-route swap, not necessarily a code regression
  });

  it("P0-1: a check-set redefinition is annotated checksRedefined", () => {
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, caseId: "ladder:L2", status: "pass", score: 1, checks: { targetValue: true } }),
      rec({ ts: 200, commitSha: B, caseId: "ladder:L2", status: "fail", score: 0.5, checks: { targetValue: true, readBeforeWrite: false } }),
    ];
    const d = diffByCase(records)[0];
    expect(d.checksRedefined).toBe(true); // the bar moved — check tightening, not a pure code regression
  });

  it("distinguishes dirty worktree runs even when HEAD commit is unchanged", () => {
    const records: EvalRunRecord[] = [
      rec({ ts: 100, commitSha: A, worktreeHash: "dirty-old", gitDirty: true, caseId: "ladder:L6", status: "pass", score: 1 }),
      rec({ ts: 200, commitSha: A, worktreeHash: "dirty-new", gitDirty: true, caseId: "ladder:L6", status: "fail", score: 0.25 }),
    ];

    const diffs = diffByCase(records);
    expect(diffs[0].verdict).toBe("degraded");
    expect(diffs[0].beforeRunKey).toBe(`${A}+dirty.dirty-old`);
    expect(diffs[0].afterRunKey).toBe(`${A}+dirty.dirty-new`);
    expect(runKey(records[1])).toBe(`${A}+dirty.dirty-new`);
  });

  const file = join(tmpdir(), `evalstore-${process.pid}.jsonl`);
  afterAll(() => { if (existsSync(file)) rmSync(file); });
  it("append-only roundtrip retains every record (the trace-retention requirement)", () => {
    appendEvalRuns([rec({ ts: 1, commitSha: A, caseId: "c1", traceRef: "docs/eval/run-1.json" })], file);
    appendEvalRuns([rec({ ts: 2, commitSha: B, caseId: "c1", status: "fail" })], file);
    const back = readEvalRuns(file);
    expect(back).toHaveLength(2);
    expect(back[0].traceRef).toBe("docs/eval/run-1.json"); // the retained trace survives
    expect(back[1].status).toBe("fail");
  });
});
