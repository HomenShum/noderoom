import { describe, expect, it } from "vitest";
import {
  makeSyntheticFinanceModelGold,
  runFinanceModelSolveEval,
} from "../evals/financeModelRuntime";

describe("finance model NodeAgent runtime eval", () => {
  it("solves the critical three-statement cells through locks, reads, CAS writes, and trace receipts", async () => {
    const report = await runFinanceModelSolveEval(makeSyntheticFinanceModelGold());

    expect(report.status).toBe("passed");
    expect(report.score).toBe(1);
    expect(report.checks).toMatchObject({
      stoppedCleanly: true,
      lockedBeforeWrite: true,
      readBeforeEdit: true,
      writesOnlyForecastCells: true,
      everyFormulaLinked: true,
      valueTieOut: true,
      releasedLock: true,
    });
    expect(report.cellResults).toHaveLength(16);
    expect(report.trace.map((event) => event.tool)).toEqual(
      expect.arrayContaining(["propose_lock", "read_range", "edit_cell", "release_lock"]),
    );
  });
});
