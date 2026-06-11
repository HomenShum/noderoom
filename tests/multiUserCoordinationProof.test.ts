import { describe, expect, it } from "vitest";
import { runMultiUserCoordinationProof } from "../evals/multiUserCoordinationProof";

describe("multi-user coordination proof", () => {
  it("proves managed locks, CAS, drafts, and release cleanup across multiple actors", async () => {
    const proof = await runMultiUserCoordinationProof();

    expect(proof.summary.passed).toBe(true);
    expect(proof.summary.scenarios).toBe(5);
    expect(proof.summary.failedScenarios).toEqual([]);
    for (const scenario of proof.scenarios) {
      expect(scenario.passed, scenario.id).toBe(true);
      expect(scenario.checks.noLockLeak, scenario.id).toBe(true);
    }
  });
});
