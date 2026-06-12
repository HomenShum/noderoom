import { describe, expect, it } from "vitest";
import { PROFESSIONAL_WORKFLOW_CASES } from "../evals/professionalWorkflows";
import { runProfessionalRuntimeLive } from "../evals/professionalRuntimeLive";

describe("professional live runtime harness", () => {
  it("executes every professional catalog case through managed runtime tools in scripted mode", async () => {
    const aggregate = await runProfessionalRuntimeLive({ cases: PROFESSIONAL_WORKFLOW_CASES });

    expect(aggregate.total).toBe(PROFESSIONAL_WORKFLOW_CASES.length);
    expect(aggregate.allPassed).toBe(true);
    for (const row of aggregate.rows) {
      expect(row.runtimeLockMode).toBe("runtime_managed_lock");
      expect(row.checks.usedProductionManagedWrite).toBe(true);
      expect(row.checks.noModelVisibleLockTools).toBe(true);
      expect(row.checks.lockHeldDuringWrite).toBe(true);
      expect(row.checks.releaseOrTtlFallback).toBe(true);
      expect(row.checks.resultPayloadsWritten).toBe(true);
      expect(row.trace.some((event) => event.tool === "write_locked_cell_results")).toBe(true);
      expect(row.trace.some((event) => event.tool === "propose_lock" || event.tool === "release_lock" || event.tool === "edit_cell")).toBe(false);
    }
  });
});
