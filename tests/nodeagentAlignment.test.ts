import { describe, expect, it } from "vitest";
import { chooseAdaptiveRoute } from "@nodeagent/core/adaptiveRouter";
import { compactMessages } from "@nodeagent/core/contextCompactor";
import { evaluateFormula } from "@nodeagent/core/formulaEngine";
import { splitBulkDiligence } from "@nodeagent/core/orchestrator";
import { toConvexSafeLifecycleEvent } from "@nodeagent/core/stateBridge";
import { parseBulkCompanyIngest, splitBulkCompanyRecords } from "@nodeagent/skills/finance/bulkIngest";
import { computeRunway, runwayChartSvg } from "@nodeagent/skills/finance/runwayForecaster";
import { createDiligenceDownstreamDrafts, type DownstreamArtifact } from "@nodeagent/skills/integration/downstreamPublish";
import { searchLinkup } from "@nodeagent/skills/search/linkupClient";

describe("src/nodeagent review-alignment surface", () => {
  it("routes high-risk semantic work to the governed lane", () => {
    const route = chooseAdaptiveRoute({
      taskType: "semantic_rebase",
      risk: "high",
      preferredModel: "claude-haiku-4-5",
    });
    expect(route.lane).toBe("governed");
    expect(route.modelId).toBeTruthy();
  });

  it("keeps compaction and formula engine imports wired to real implementations", async () => {
    const formula = evaluateFormula("=SUM(A1:A2)", {
      getCell: (ref) => ref === "A1" ? 2 : 3,
    });
    expect(formula).toEqual({ value: 5 });

    const compacted = await compactMessages([
      { role: "user", content: "short" },
      { role: "assistant", content: "ok" },
    ], { maxChars: 10_000 });
    expect(compacted.compacted).toBe(false);
  });

  it("parses and batches startup diligence rows", () => {
    const rows = parseBulkCompanyIngest([
      "Company, Website, Tier, Intent, Owner, CRM Status",
      "Mercury, https://mercury.com, A, startup banking, Maya, Diligence",
      "Ramp, https://ramp.com, A, finance automation, Dev, Diligence",
    ].join("\n"));
    expect(rows.map((row) => row.company)).toEqual(["Mercury", "Ramp"]);
    expect(splitBulkCompanyRecords(rows, 1)).toHaveLength(2);
  });

  it("uses deterministic runway math and chart output from the nodeagent namespace", () => {
    const result = computeRunway({ company: "Mercury", cashUsd: 1_400_000, monthlyBurnUsd: 100_000 });
    expect(result.runwayMonths).toBe(14);
    expect(runwayChartSvg(result)).toContain("Mercury");
  });

  it("splits bulk orchestration batches without running a model", () => {
    const batches = splitBulkDiligence(["Mercury", "Ramp", "Brex"], { batchSize: 2 });
    expect(batches.map((batch) => batch.items)).toEqual([["Mercury", "Ramp"], ["Brex"]]);
  });

  it("converts lifecycle events into Convex-safe payloads", () => {
    const event = toConvexSafeLifecycleEvent({ type: "text_delta", runId: "run_1", delta: "streaming" });
    expect(event.kind).toBe("text_delta");
    expect(event.payload.delta).toBe("streaming");
  });

  it("creates approval-gated downstream publish drafts", () => {
    const artifact: DownstreamArtifact = {
      id: "report_1",
      title: "Finance diligence packet",
      kind: "diligence_report",
      body: "Source-backed findings",
      sourceArtifactIds: ["sheet_1"],
      sourceUrls: ["https://example.com"],
      createdAt: 1_714_000_000_000,
    };
    const drafts = createDiligenceDownstreamDrafts(artifact, ["gmail", "notion", "crm_csv"]);
    expect(drafts.map((draft) => draft.destination)).toEqual(["gmail", "notion", "crm_csv"]);
    expect(drafts.find((draft) => draft.destination === "gmail")?.approvalRequired).toBe(true);
    expect(drafts.find((draft) => draft.destination === "crm_csv")?.status).toBe("ready");
  });

  it("keeps Linkup search bounded and can fall back to explicit source URLs", async () => {
    const previous = process.env.LINKUP_API_KEY;
    delete process.env.LINKUP_API_KEY;
    try {
      const results = await searchLinkup({ query: "Mercury banking", urls: [], limit: 2 });
      expect(results).toEqual([]);
    } finally {
      if (previous) process.env.LINKUP_API_KEY = previous;
    }
  });
});

