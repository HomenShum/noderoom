export type EvalConfidenceLevel = "candidate" | "research_validated" | "contested" | "human_verified";
export type EvalGateMode = "none" | "advisory" | "blocking";

export type EvalTrustPolicyInput = {
  confidenceLevel: EvalConfidenceLevel;
  gateMode: EvalGateMode;
  sourceResearchPacketIds?: string[];
  contestedClaims?: string[];
  touchesForbiddenScope?: boolean;
};

export type EvalTrustPolicyResult = {
  canRun: boolean;
  canBlockMerge: boolean;
  canCreateImplementationHandoff: boolean;
  requiresHumanReview: boolean;
  reasons: string[];
};

export const EVAL_TRUST_LEVELS: Array<{ level: EvalConfidenceLevel; meaning: string }> = [
  {
    level: "candidate",
    meaning: "Generated from traces or research; useful for discussion and advisory runs, not a merge gate.",
  },
  {
    level: "research_validated",
    meaning: "Backed by captured sources or online consensus; can create scoped handoffs, still not blocking by default.",
  },
  {
    level: "contested",
    meaning: "Credible sources disagree; advisory only, and the eval should check that disagreement is surfaced.",
  },
  {
    level: "human_verified",
    meaning: "Reviewed or accepted for critical use; may become blocking when deterministic and safety-safe.",
  },
];

export const ARCHITECTURE_FIT_CHECKS = [
  "Can existing tools, prompts, context builders, and Convex mutations already handle the case?",
  "If not, is the missing piece a query, action, mutation, tool schema, validator, or UI review affordance?",
  "What is the smallest implementation that proves the workflow without a new subsystem?",
  "What old or proposed layer can be avoided because the existing artifact/job/lock path is enough?",
] as const;

export function evaluateEvalTrustPolicy(input: EvalTrustPolicyInput): EvalTrustPolicyResult {
  const sourceCount = input.sourceResearchPacketIds?.length ?? 0;
  const contestedCount = input.contestedClaims?.length ?? 0;
  const reasons: string[] = [];
  const canRun = true;

  if (sourceCount === 0) reasons.push("missing research packet evidence");
  if (input.confidenceLevel === "candidate") reasons.push("candidate evals are advisory only");
  if (input.confidenceLevel === "contested" || contestedCount > 0) {
    reasons.push("contested claims must stay advisory until resolved or explicitly modeled");
  }
  if (input.touchesForbiddenScope) reasons.push("forbidden-scope changes require human review");

  const canCreateImplementationHandoff =
    sourceCount > 0 &&
    !input.touchesForbiddenScope &&
    contestedCount === 0 &&
    (input.confidenceLevel === "research_validated" || input.confidenceLevel === "human_verified");

  const canBlockMerge =
    input.gateMode === "blocking" &&
    input.confidenceLevel === "human_verified" &&
    sourceCount > 0 &&
    contestedCount === 0 &&
    !input.touchesForbiddenScope;

  const requiresHumanReview =
    input.gateMode === "blocking" || input.touchesForbiddenScope === true || input.confidenceLevel === "human_verified";

  if (input.gateMode === "blocking" && !canBlockMerge) reasons.push("blocking gates require sourced, uncontested, human-verified evals");

  return {
    canRun,
    canBlockMerge,
    canCreateImplementationHandoff,
    requiresHumanReview,
    reasons,
  };
}
