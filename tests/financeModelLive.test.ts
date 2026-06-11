import { describe, expect, it } from "vitest";
import {
  aggregateFinanceLiveReports,
  classifyRunFailure,
  type LiveReport,
} from "../evals/financeModelLive";

function report(overrides: Partial<LiveReport> = {}): LiveReport {
  const checks = {
    stoppedCleanly: true,
    lockedBeforeWrite: true,
    writesOnlyForecastCells: true,
    allTargetsWritten: true,
    everyFormulaLinked: true,
    valueTieOutComputable: true,
    releasedLock: true,
    noAnswerKeyLeakage: true,
    withinCostBudget: true,
    withinTimeBudget: true,
    ...overrides.checks,
  };
  const status = Object.values(checks).every(Boolean) ? "passed" : "failed";
  return {
    caseId: "finance-model-private-v1-full",
    mode: "live",
    requestedModelName: "deepseek/deepseek-v4-flash",
    modelName: "deepseek/deepseek-v4-flash",
    roomVariant: "base",
    status,
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    cellResults: [],
    costUsd: 0.01,
    ms: 1000,
    toolCalls: 10,
    ...overrides,
  };
}

describe("finance model live eval reliability substrate", () => {
  it("attributes malformed tool-call JSON to the model and transport status to the provider", () => {
    expect(classifyRunFailure(new Error("Invalid JSON in tool call arguments"))).toBe("model");

    const providerError = Object.assign(new Error("OpenRouter rate limit"), { statusCode: 429 });
    expect(classifyRunFailure(providerError)).toBe("provider");
  });

  it("aggregates attempts into a pass-rate proof instead of keeping only the best run", () => {
    const aggregate = aggregateFinanceLiveReports({
      reports: [
        report(),
        report(),
        report(),
        report(),
        report({
          checks: { everyFormulaLinked: false },
          failureOwner: "model",
          failureReason: "failed checks: everyFormulaLinked",
        }),
      ],
      runsRequested: 5,
      level: "full",
      targetCells: ["F7", "G7"],
      cells: [],
    });

    expect(aggregate.passRate).toBe(0.8);
    expect(aggregate.requiredPasses).toBe(4);
    expect(aggregate.status).toBe("passed");
    expect(aggregate.perCheckPassCounts.everyFormulaLinked).toBe(4);
    expect(aggregate.aggregateChecks["check:everyFormulaLinked"]).toBe(true);
    expect(aggregate.attempts).toHaveLength(5);
  });

  it("fails aggregate promotion when reliability drops below the required pass count", () => {
    const aggregate = aggregateFinanceLiveReports({
      reports: [
        report(),
        report(),
        report({ checks: { withinTimeBudget: false }, failureOwner: "model" }),
        report({ checks: { everyFormulaLinked: false }, failureOwner: "model" }),
        report({ checks: { everyFormulaLinked: false }, failureOwner: "model" }),
      ],
      runsRequested: 5,
      level: "full",
      targetCells: ["F7", "G7"],
      cells: [],
    });

    expect(aggregate.passCount).toBe(2);
    expect(aggregate.aggregateChecks.passThresholdMet).toBe(false);
    expect(aggregate.status).toBe("failed");
  });
});
