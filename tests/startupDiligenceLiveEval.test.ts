// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { runStartupDiligenceConvexContractEval } from "../scripts/startup-diligence-live-eval";

const requiredChecks = [
  "account_upsert",
  "cited_cellpayloads",
  "human_edit_preserved",
  "concurrent_lanes",
  "private_boundary",
  "runway_milestone_chart",
  "downstream_draft_only",
  "route_trace_cost_runtime",
];

const modules = import.meta.glob("../convex/**/*.ts");

describe("startup diligence live eval contract", () => {
  it("proves every manifest check against the Convex contract without claiming provider-produced content", async () => {
    const report = await runStartupDiligenceConvexContractEval(modules);

    expect(report.pass).toBe(true);
    expect(report.mode).toBe("convex-test-contract");
    expect(report.summary.providerProducedContent).toBe(false);
    expect(report.summary.convexContractProven).toBe(true);
    expect(report.checks.map((check) => check.id).sort()).toEqual([...requiredChecks].sort());
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);

    const payload = report.checks.find((check) => check.id === "cited_cellpayloads");
    expect(JSON.stringify(payload?.evidence ?? {})).toContain("CellPayload");

    const route = report.checks.find((check) => check.id === "route_trace_cost_runtime");
    expect(JSON.stringify(route?.evidence ?? {})).toContain("startup-contract-eval");
  });
});
