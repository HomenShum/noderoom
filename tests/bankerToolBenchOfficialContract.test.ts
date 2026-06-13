import { describe, expect, it } from "vitest";
import { buildBankerToolBenchOfficialContract } from "../src/eval/bankerToolBenchOfficialContract";

describe("BankerToolBench official execution contract", () => {
  it("fails closed when official external prerequisites are missing", () => {
    const report = buildBankerToolBenchOfficialContract({ generatedAt: "2026-06-13T00:00:00.000Z" });

    expect(report.status).toBe("blocked_external_requirements");
    expect(report.pass).toBe(false);
    expect(report.bundleProvenance.recorded).toBe(false);
    expect(report.dockerRunPlan.proven).toBe(false);
    expect(report.mcpTools.complete).toBe(false);
    expect(report.gandalfScoreImport.imported).toBe(false);
    expect(report.contaminationScope.checks).toEqual(expect.arrayContaining([
      "raw model output text",
      "agent-visible text/csv/md/xml sidecars",
      "agent-facing file paths",
    ]));
    expect(report.blockers.join(" ")).toContain("dataset revision");
    expect(report.blockers.join(" ")).toContain("Harbor/Docker");
    expect(report.blockers.join(" ")).toContain("MCP financial tools");
    expect(report.blockers.join(" ")).toContain("Gandalf");
  });

  it("can mark the contract ready only when every external proof is supplied", () => {
    const report = buildBankerToolBenchOfficialContract({
      datasetRevision: "abc123",
      manifestLockfile: "docs/eval/bankertoolbench-manifest-lock.json",
      adaptedToolNames: ["company_logo", "document_search", "market_data", "sec_filings", "web_research"],
      dockerIsolationProven: true,
      gandalfImported: true,
    });

    expect(report.status).toBe("official_contract_ready");
    expect(report.pass).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.bundleProvenance.recorded).toBe(true);
    expect(report.mcpTools.complete).toBe(true);
  });
});
