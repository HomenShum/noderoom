import { describe, expect, it } from "vitest";
import { buildOpenRouterConvexBenchmarkReport } from "../src/eval/openRouterConvexBenchmark";
import { SUPPORTED_MODEL_ROUTES } from "../scripts/benchmark/modelEvalConfig";

describe("OpenRouter-on-Convex benchmark contract", () => {
  it("separates harness readiness from official benchmark promotion", () => {
    const report = buildOpenRouterConvexBenchmarkReport({
      routes: SUPPORTED_MODEL_ROUTES,
      generatedAt: "test",
    });

    expect(report.summary.openRouterRouteCount).toBeGreaterThan(10);
    expect(report.summary.harnessCases).toBeGreaterThan(5);
    expect(report.summary.harnessReady).toBe(true);
    expect(report.summary.officialPromotionReady).toBe(false);
    expect(report.cases.find((item) => item.id === "bankertoolbench_official_verifier_path")).toMatchObject({
      scope: "official_promotion",
      status: "blocked",
    });
  });

  it("keeps OpenRouter models behind Convex jobs instead of browser/provider shortcuts", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const route = report.routePlans.find((item) => item.route === "deepseek/deepseek-v4-flash");

    expect(route).toMatchObject({
      provider: "openrouter",
      adapter: "convexModel.openrouter_chat_completions",
      eligibleForConvexHarness: true,
      mustRunThroughAgentJobs: true,
    });
    expect(route?.requiredContract).toEqual(expect.arrayContaining([
      expect.stringContaining("agentJobs"),
      expect.stringContaining("Convex actions call providers"),
      expect.stringContaining("mutationReceipts"),
    ]));
  });

  it("keeps free-auto in the long-running lane until p95 ladder evidence promotes it", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const freeAuto = report.routePlans.find((item) => item.route === "openrouter/free-auto");

    expect(freeAuto).toMatchObject({
      provider: "internal_alias",
      adapter: "convexModel.openrouter_free_auto",
      role: "background_long_running_only",
      eligibleForConvexHarness: true,
    });
    expect(freeAuto?.blockers).toContain("route needs N>=5 p95 ladder evidence before interactive promotion");
  });

  it("maps benchmark-shaped cases to concrete Convex runtime evidence", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const cases = Object.fromEntries(report.cases.map((item) => [item.id, item]));

    expect(cases.convex_job_journal_and_replay.requiredConvexContract).toContain("model-step hash journal");
    expect(cases.convex_l1_l7_collaboration_ladder.requiredConvexContract).toContain("cold resume after slice death");
    expect(cases.spreadsheetbench_route_contract.requiredConvexContract).toContain("formula edit plans with deterministic formula-result cache");
    expect(cases.spreadsheetbench_chart_visual_grade.requiredConvexContract).toContain("candidate/gold PNG hashes are recorded before visual acceptance");
    expect(cases.docker_agent_workspace_isolation.requiredConvexContract).toContain("evaluator gold is denied until scoring phase");
  });
});
