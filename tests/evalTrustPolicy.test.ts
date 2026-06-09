import { describe, expect, it } from "vitest";
import { evaluateEvalTrustPolicy } from "../src/eval/evalTrustPolicy";

describe("eval trust policy", () => {
  it("lets candidate evals run but prevents blocking and implementation handoffs", () => {
    const result = evaluateEvalTrustPolicy({
      confidenceLevel: "candidate",
      gateMode: "advisory",
      sourceResearchPacketIds: ["packet_1"],
    });

    expect(result.canRun).toBe(true);
    expect(result.canBlockMerge).toBe(false);
    expect(result.canCreateImplementationHandoff).toBe(false);
  });

  it("prevents blocking evals without research packet evidence", () => {
    const result = evaluateEvalTrustPolicy({
      confidenceLevel: "human_verified",
      gateMode: "blocking",
    });

    expect(result.canBlockMerge).toBe(false);
    expect(result.reasons).toContain("missing research packet evidence");
  });

  it("keeps contested evals advisory even when they have sources", () => {
    const result = evaluateEvalTrustPolicy({
      confidenceLevel: "contested",
      gateMode: "blocking",
      sourceResearchPacketIds: ["packet_1", "packet_2"],
      contestedClaims: ["DCF weighting differs by source"],
    });

    expect(result.canRun).toBe(true);
    expect(result.canBlockMerge).toBe(false);
    expect(result.canCreateImplementationHandoff).toBe(false);
  });

  it("requires human review for forbidden-scope changes", () => {
    const result = evaluateEvalTrustPolicy({
      confidenceLevel: "research_validated",
      gateMode: "advisory",
      sourceResearchPacketIds: ["packet_1"],
      touchesForbiddenScope: true,
    });

    expect(result.requiresHumanReview).toBe(true);
    expect(result.canCreateImplementationHandoff).toBe(false);
    expect(result.reasons).toContain("forbidden-scope changes require human review");
  });

  it("allows blocking only for sourced, uncontested, human-verified evals", () => {
    const result = evaluateEvalTrustPolicy({
      confidenceLevel: "human_verified",
      gateMode: "blocking",
      sourceResearchPacketIds: ["packet_1"],
    });

    expect(result.canRun).toBe(true);
    expect(result.canBlockMerge).toBe(true);
    expect(result.canCreateImplementationHandoff).toBe(true);
  });
});
