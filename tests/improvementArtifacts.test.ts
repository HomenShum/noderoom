import { describe, expect, it } from "vitest";
import { evaluateEvalCandidateForHandoff, type EvalCandidate } from "../src/eval/improvementArtifacts";

const baseCandidate: EvalCandidate = {
  id: "case_1",
  title: "Finance variance fixture",
  workflowDomain: "finance_ops",
  persona: "Finance analyst",
  goal: "Reconcile variance cells",
  sourceResearchPacketIds: ["packet_1"],
  confidenceLevel: "research_validated",
  gateMode: "advisory",
  contestedClaims: [],
  assertions: [{ id: "a1", description: "Preserves formula cells", evidenceRefs: ["packet_1"] }],
  rootCauseCategories: ["bad_mutation_contract"],
  architectureFit: {
    status: "small_gap",
    existingCapabilityNotes: ["CAS edit path exists"],
    missingCapabilityNotes: ["Needs a deterministic fixture"],
    convexBoundaryNeeds: {
      queries: ["read range"],
      mutations: ["write variance note"],
      actions: [],
      tools: [],
      validators: ["formula preservation"],
    },
    smallestChange: "Add one fixture and validator.",
    avoidAdding: ["new finance service"],
    requiredEvidence: ["formula source rows"],
  },
};

describe("improvement artifacts", () => {
  it("allows implementation handoff only for sourced, uncontested small gaps", () => {
    const decision = evaluateEvalCandidateForHandoff(baseCandidate);

    expect(decision.kind).toBe("implementation");
    expect(decision.canBlockMerge).toBe(false);
  });

  it("keeps existing-capability cases as eval fixture work instead of implementation work", () => {
    const decision = evaluateEvalCandidateForHandoff({
      ...baseCandidate,
      architectureFit: { ...baseCandidate.architectureFit, status: "existing_capability" },
    });

    expect(decision.kind).toBe("eval_fixture");
  });

  it("routes contested candidates away from implementation handoffs", () => {
    const decision = evaluateEvalCandidateForHandoff({
      ...baseCandidate,
      confidenceLevel: "contested",
      contestedClaims: ["Source A and Source B disagree"],
    });

    expect(decision.kind).toBe("eval_fixture");
    expect(decision.canBlockMerge).toBe(false);
  });
});
