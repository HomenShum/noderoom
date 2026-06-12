import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_PROOF_REGISTRY,
  buildProfessionalCatalogProofs,
  summarizeProfessionalCatalogProofs,
} from "../evals/professionalCatalogProofs";
import {
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalHarnessRequirement,
} from "../evals/professionalWorkflows";

describe("professional catalog proofs", () => {
  it("fully proofs every professional catalog case at the deterministic catalog layer", () => {
    const rows = buildProfessionalCatalogProofs();
    const summary = summarizeProfessionalCatalogProofs(rows);
    const failed = rows
      .map((row) => ({
        caseId: row.caseId,
        failedChecks: row.checks.filter((check) => !check.pass).map((check) => check.id),
      }))
      .filter((row) => row.failedChecks.length > 0);

    expect(rows).toHaveLength(PROFESSIONAL_WORKFLOW_CASES.length);
    expect(summary.total).toBe(PROFESSIONAL_WORKFLOW_CASES.length);
    expect(summary.fullyProofed).toBe(true);
    expect(summary.failedCaseIds).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("has named evidence and a method for every harness requirement used by the catalog", () => {
    const usedRequirements = new Set(PROFESSIONAL_WORKFLOW_CASES.flatMap((evalCase) => evalCase.requiredHarness));

    for (const requirement of usedRequirements) {
      const proof = REQUIREMENT_PROOF_REGISTRY[requirement as ProfessionalHarnessRequirement];
      expect(proof, requirement).toBeDefined();
      expect(proof.requirement).toBe(requirement);
      expect(proof.kind).toMatch(/runtime_test|deterministic_catalog_judge|private_redacted_runner/);
      expect(proof.method.trim().length).toBeGreaterThan(20);
      expect(proof.evidence.length).toBeGreaterThan(0);
    }
  });

  it("keeps chat, long-running, and private gold contracts explicit", () => {
    const rows = new Map(buildProfessionalCatalogProofs().map((row) => [row.caseId, row]));

    expect(checkPass(rows, "gtm-chat-lead-capture-enrich", "intake_surface_contract")).toBe(true);
    expect(checkPass(rows, "gtm-chat-lead-capture-enrich", "provenance_contract")).toBe(true);
    expect(checkPass(rows, "gtm-chat-to-background-diligence-job", "long_running_contract")).toBe(true);
    expect(checkPass(rows, "finance-three-statement-modeling-private-gold", "private_gold_contract")).toBe(true);
  });
});

function checkPass(
  rows: Map<string, ReturnType<typeof buildProfessionalCatalogProofs>[number]>,
  caseId: string,
  checkId: string,
) {
  return rows.get(caseId)?.checks.find((check) => check.id === checkId)?.pass;
}
