/**
 * Scenario tests for the finance live eval's reliability layer (Harness Hardening #1-3,
 * docs/eval/FEATURE_EVAL_BACKLOG.md): a route is promoted by MEASURED model-owned pass rate,
 * never by a lucky single pass — and failures are attributed by structure (status codes, error
 * classes), never laundered by message text. Each scenario is a real failure mode this repo has
 * already paid for once: the 0/3-after-passing-once bug, the OpenRouter invalid-JSON run, and
 * the best-of-six-manual-reruns champion claim.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateFinanceLiveReports,
  classifyRunFailure,
  runFinanceModelLiveSolve,
  PROVIDER_INCONCLUSIVE_SHARE,
  type FinanceRoomVariant,
  type LiveReport,
} from "../evals/financeModelLive";
import { financeModelSolvePlan, makeSyntheticFinanceModelGold } from "../evals/financeModelRuntime";
import { scriptedModel } from "../src/agent/scripted";

const PASS_CHECKS = { stoppedCleanly: true, allTargetsWritten: true };
const FAIL_CHECKS = { stoppedCleanly: true, allTargetsWritten: false };
const DEAD_CHECKS = { stoppedCleanly: false, allTargetsWritten: false };

function liveReport(partial: Partial<LiveReport>): LiveReport {
  return {
    caseId: "finance-model-private-v1-full",
    mode: "live",
    modelName: "test-route",
    roomVariant: "base" as FinanceRoomVariant,
    status: "passed",
    score: 1,
    checks: { ...PASS_CHECKS },
    cellResults: [],
    costUsd: 0.05,
    ms: 120_000,
    toolCalls: 10,
    ...partial,
  };
}

function aggregate(reports: LiveReport[], runsRequested = reports.length) {
  return aggregateFinanceLiveReports({
    reports,
    runsRequested,
    level: "full",
    targetCells: ["F7"],
    cells: [],
  });
}

describe("finance live reliability — measured pass rate, not max-statistic", () => {
  it("promotes a route only at >= 4/5 model-owned passes", () => {
    const four = aggregate([
      liveReport({}), liveReport({}), liveReport({}), liveReport({}),
      liveReport({ status: "failed", score: 0.5, checks: { ...FAIL_CHECKS }, failureOwner: "model" }),
    ]);
    expect(four.verdict).toBe("passed");
    expect(four.modelOwnedRuns).toBe(5);
    expect(four.requiredPasses).toBe(4);

    const three = aggregate([
      liveReport({}), liveReport({}), liveReport({}),
      liveReport({ status: "failed", score: 0.5, checks: { ...FAIL_CHECKS }, failureOwner: "model" }),
      liveReport({ status: "failed", score: 0.5, checks: { ...FAIL_CHECKS }, failureOwner: "model" }),
    ]);
    expect(three.verdict).toBe("failed");
  });

  it("does not count a provider 500 against the model — 3/3 clean passes with 40% provider noise still promotes", () => {
    // The unfair-fail door: under requested-runs math, 3 passes of 5 requested would fail even
    // though the model went 3-for-3 and the other two runs died in the transport layer.
    const result = aggregate([
      liveReport({}), liveReport({}), liveReport({}),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider", failureReason: "HTTP 503" }),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider", failureReason: "HTTP 429" }),
    ]);
    expect(result.modelOwnedRuns).toBe(3);
    expect(result.providerOwnedRuns).toBe(2);
    expect(result.modelOwnedPassRate).toBe(1);
    expect(result.providerFailureShare).toBeLessThanOrEqual(PROVIDER_INCONCLUSIVE_SHARE);
    expect(result.verdict).toBe("passed");
  });

  it("declares a provider-noise-dominated batch inconclusive — never passed", () => {
    // The grind-to-promotion door: 2 clean passes hiding behind 3 provider failures is not a
    // 100% pass rate, it is an unmeasurable batch.
    const noisy = aggregate([
      liveReport({}), liveReport({}),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider" }),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider" }),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider" }),
    ]);
    expect(noisy.providerFailureShare).toBeGreaterThan(PROVIDER_INCONCLUSIVE_SHARE);
    expect(noisy.verdict).toBe("inconclusive");
    expect(noisy.status).toBe("failed");

    const allProvider = aggregate([
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider" }),
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "environment" }),
    ]);
    expect(allProvider.modelOwnedRuns).toBe(0);
    expect(allProvider.verdict).toBe("inconclusive");
  });

  it("treats a single clean pass as passed-but-unmeasured, and a single provider failure as inconclusive", () => {
    const single = aggregate([liveReport({})]);
    expect(single.verdict).toBe("passed");
    expect(single.runsCompleted).toBe(1);

    const singleProvider = aggregate([
      liveReport({ status: "failed", score: 0, checks: { ...DEAD_CHECKS }, failureOwner: "provider" }),
    ]);
    expect(singleProvider.verdict).toBe("inconclusive");
  });
});

describe("finance live failure attribution — structure over message text", () => {
  it("does not launder a model's malformed tool-call JSON as a provider failure", () => {
    // The exact laundering case: the message contains "Invalid JSON", which the old regex
    // classifier sent to 'provider' — excusing the flakiest models from promotion math.
    expect(classifyRunFailure(new Error("Invalid JSON in tool arguments for edit_cell"))).toBe("model");
  });

  it("attributes transport-layer failures to the provider via status codes and socket errors", () => {
    expect(classifyRunFailure(Object.assign(new Error("Too Many Requests"), { statusCode: 429 }))).toBe("provider");
    expect(classifyRunFailure(Object.assign(new Error("Service Unavailable"), { statusCode: 503 }))).toBe("provider");
    expect(classifyRunFailure(new Error("fetch failed: connect ECONNRESET 104.18.2.115:443"))).toBe("provider");
    expect(classifyRunFailure(new Error("Unexpected token < — OpenRouter returned a non-JSON response body"))).toBe("provider");
  });

  it("attributes deadline aborts to the model and unknown shapes to the harness", () => {
    expect(classifyRunFailure(new Error("AbortError: This operation was aborted"))).toBe("model");
    expect(classifyRunFailure(new TypeError("Cannot read properties of undefined (reading 'rows')"))).toBe("harness");
  });
});

describe("finance live room variants — the passed-once-then-0/3 class", () => {
  it("solves cleanly in a room full of distractor artifacts that reuse the target cell ids", async () => {
    const gold = makeSyntheticFinanceModelGold();
    const report = await runFinanceModelLiveSolve({
      gold,
      pack: null,
      agent: scriptedModel(financeModelSolvePlan(gold), "scripted-finance-solver"),
      modelName: "scripted",
      roomVariant: "distractors",
    });
    expect(report.status).toBe("passed");
    expect(report.roomVariant).toBe("distractors");
    expect(report.checks.distractorsUntouched).toBe(true);
  });

  it("survives a human committing mid-run and blocks the human's write into the locked range", async () => {
    const gold = makeSyntheticFinanceModelGold();
    const report = await runFinanceModelLiveSolve({
      gold,
      pack: null,
      agent: scriptedModel(financeModelSolvePlan(gold), "scripted-finance-solver"),
      modelName: "scripted",
      roomVariant: "concurrent_edit",
    });
    expect(report.status).toBe("passed");
    expect(report.checks.humanEditSurvived).toBe(true);
    expect(report.checks.lockHeldAgainstMidRunWrite).toBe(true);
  });

  it("fails the batch when a measured variant goes 0-for, even with enough total passes", () => {
    const result = aggregateFinanceLiveReports({
      reports: [
        liveReport({}), liveReport({}), liveReport({}), liveReport({}),
        liveReport({ roomVariant: "distractors", status: "failed", score: 0.5, checks: { ...FAIL_CHECKS }, failureOwner: "model" }),
      ],
      runsRequested: 5,
      level: "full",
      targetCells: ["F7"],
      cells: [],
    });
    expect(result.passCount).toBe(4);
    expect(result.aggregateChecks["variant:distractors"]).toBe(false);
    expect(result.verdict).toBe("failed");
  });
});

describe("finance live budget gates — cost and time are checks, not recordings", () => {
  it("passes the scripted solve WITH budget gates participating in the check vector", async () => {
    const gold = makeSyntheticFinanceModelGold();
    const report = await runFinanceModelLiveSolve({
      gold,
      pack: null,
      agent: scriptedModel(financeModelSolvePlan(gold), "scripted-finance-solver"),
      modelName: "scripted",
      maxCostUsd: 0.15,
      maxMs: 420_000,
    });
    expect(report.status).toBe("passed");
    expect(report.checks.withinCostBudget).toBe(true);
    expect(report.checks.withinTimeBudget).toBe(true);
  });

  it("fails a run that blows the time budget even when every protocol check passes", async () => {
    const gold = makeSyntheticFinanceModelGold();
    const report = await runFinanceModelLiveSolve({
      gold,
      pack: null,
      agent: scriptedModel(financeModelSolvePlan(gold), "scripted-finance-solver"),
      modelName: "scripted",
      maxMs: 0,
    });
    expect(report.checks.withinTimeBudget).toBe(false);
    expect(report.status).toBe("failed");
  });
});
