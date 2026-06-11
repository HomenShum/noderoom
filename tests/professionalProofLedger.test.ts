import { describe, expect, it } from "vitest";
import {
  buildProfessionalProofLedger,
  summarizeProfessionalProofs,
} from "../evals/professionalProofLedger";

describe("professional proof ledger", () => {
  it("does not label contract-shape cases as live-proven", () => {
    const rows = buildProfessionalProofLedger();
    const summary = summarizeProfessionalProofs(rows);

    expect(summary.total).toBeGreaterThan(10);
    expect(summary.allLiveProven).toBe(false);
    expect(summary.allCatalogsProofed).toBe(true);
    expect(summary.partialLiveProvider).toBeGreaterThan(0);
    expect(summary.deterministicCatalog).toBeGreaterThan(0);
    expect(summary.contractShape).toBe(0);
    expect(summary.unproofedCaseIds).toEqual([]);
    expect(rows.find((row) => row.caseId === "gtm-chat-lead-capture-enrich")?.proofLevel).toBe(
      "deterministic_runtime",
    );
    expect(rows.find((row) => row.caseId === "finance-three-statement-modeling-private-gold")?.proofLevel).toBe(
      "partial_live_provider",
    );
    expect(rows.find((row) => row.caseId === "finance-three-statement-modeling-private-gold")?.blockers).toEqual(
      expect.arrayContaining(["guide_mode_no_write", "section_collaboration_locks"]),
    );
  });
});
