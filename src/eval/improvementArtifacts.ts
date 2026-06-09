import {
  type EvalGateMode,
  type EvalTrustPolicyInput,
  evaluateEvalTrustPolicy,
} from "./evalTrustPolicy";

export type ResearchConsensusLevel = "insufficient" | "single_source" | "multi_source_consensus" | "contested";
export type ResearchPacketStatus = "needs_more_sources" | "research_validated" | "contested" | "retired";

export type WorkflowSourceSnapshot = {
  id: string;
  url: string;
  capturedAt: string;
  title: string;
};

export type WorkflowSourceClaim = {
  id: string;
  sourceSnapshotId: string;
  claim: string;
  supportsRubricItem?: string;
};

export type WorkflowResearchPacket = {
  id: string;
  domain: string;
  sourceSnapshots: WorkflowSourceSnapshot[];
  sourceClaims: WorkflowSourceClaim[];
  consensusLevel: ResearchConsensusLevel;
  contestedClaims: string[];
  rubricVariants: string[];
  assumptions: string[];
  extractedRubric: string[];
  proposedEvalCaseIds: string[];
  reviewStatus: ResearchPacketStatus;
};

export type ArchitectureFitStatus = "existing_capability" | "small_gap" | "missing_capability" | "blocked_by_safety";

export type ConvexBoundaryNeed = {
  queries: string[];
  mutations: string[];
  actions: string[];
  tools: string[];
  validators: string[];
  uiReview?: string[];
};

export type ArchitectureFit = {
  status: ArchitectureFitStatus;
  existingCapabilityNotes: string[];
  missingCapabilityNotes: string[];
  convexBoundaryNeeds: ConvexBoundaryNeed;
  smallestChange: string;
  avoidAdding: string[];
  requiredEvidence: string[];
};

export type RootCauseCategory =
  | "stale_context"
  | "wrong_tool"
  | "missing_read_before_write"
  | "bad_mutation_contract"
  | "weak_source_evidence"
  | "bad_prompt_or_context"
  | "permission_or_visibility"
  | "model_routing_or_budget"
  | "ui_review_friction"
  | "eval_measures_wrong_behavior";

export const ROOT_CAUSE_CATEGORIES: Array<{ category: RootCauseCategory; meaning: string }> = [
  { category: "stale_context", meaning: "The agent acted on old state or missing refreshed context." },
  { category: "wrong_tool", meaning: "The model chose a tool that could not satisfy the workflow contract." },
  { category: "missing_read_before_write", meaning: "A write occurred without a current source read and version." },
  { category: "bad_mutation_contract", meaning: "The server mutation allowed an unsafe or under-specified state change." },
  { category: "weak_source_evidence", meaning: "The output lacked source-backed evidence or cited the wrong evidence." },
  { category: "bad_prompt_or_context", meaning: "Instructions or context did not define the workflow sharply enough." },
  { category: "permission_or_visibility", meaning: "Scope, privacy, or role gating was wrong or underspecified." },
  { category: "model_routing_or_budget", meaning: "The chosen model, budget, or slice policy was unfit for the task." },
  { category: "ui_review_friction", meaning: "The human review or approval surface obscured the right decision." },
  { category: "eval_measures_wrong_behavior", meaning: "The eval target itself is suspect and needs research/calibration." },
];

export type EvalAssertion = {
  id: string;
  description: string;
  evidenceRefs: string[];
};

export type EvalCandidate = {
  id: string;
  title: string;
  workflowDomain: string;
  persona: string;
  goal: string;
  sourceResearchPacketIds: string[];
  architectureFit: ArchitectureFit;
  confidenceLevel: EvalTrustPolicyInput["confidenceLevel"];
  gateMode: EvalGateMode;
  contestedClaims: string[];
  assertions: EvalAssertion[];
  rootCauseCategories: RootCauseCategory[];
  forbiddenScopeRisk?: boolean;
};

export type HandoffDecision = {
  evalCandidateId: string;
  kind: "implementation" | "eval_fixture" | "more_research" | "none";
  canBlockMerge: boolean;
  reasons: string[];
};

export function evaluateEvalCandidateForHandoff(candidate: EvalCandidate): HandoffDecision {
  const policy = evaluateEvalTrustPolicy({
    confidenceLevel: candidate.confidenceLevel,
    gateMode: candidate.gateMode,
    sourceResearchPacketIds: candidate.sourceResearchPacketIds,
    contestedClaims: candidate.contestedClaims,
    touchesForbiddenScope: candidate.forbiddenScopeRisk,
  });
  const reasons = [...policy.reasons];

  if (candidate.architectureFit.status === "blocked_by_safety") {
    reasons.push("architecture fit is blocked by a safety or approval constraint");
  }

  if (candidate.sourceResearchPacketIds.length === 0 || candidate.confidenceLevel === "candidate") {
    return {
      evalCandidateId: candidate.id,
      kind: "more_research",
      canBlockMerge: false,
      reasons,
    };
  }

  if (candidate.confidenceLevel === "contested" || candidate.contestedClaims.length > 0) {
    return {
      evalCandidateId: candidate.id,
      kind: "eval_fixture",
      canBlockMerge: false,
      reasons,
    };
  }

  if (candidate.architectureFit.status === "existing_capability") {
    return {
      evalCandidateId: candidate.id,
      kind: "eval_fixture",
      canBlockMerge: policy.canBlockMerge,
      reasons,
    };
  }

  if (policy.canCreateImplementationHandoff && candidate.architectureFit.status === "small_gap") {
    return {
      evalCandidateId: candidate.id,
      kind: "implementation",
      canBlockMerge: policy.canBlockMerge,
      reasons,
    };
  }

  return {
    evalCandidateId: candidate.id,
    kind: "none",
    canBlockMerge: false,
    reasons,
  };
}
