import type { Actor, Artifact, CellEvidence, ChangeOp, Draft, MergeResolution } from "./types";

export type SemanticTargetKind = "cell" | "memo_block" | "chart" | "task";
export type SemanticConflictTrigger = "stale_patch_bundle" | "draft_conflict" | "proposal_cas_conflict" | "manual_review";
export type SemanticConflictKind = "cell_value" | "formula" | "memo_text" | "note_block" | "chart_annotation" | "formatting" | "evaluator_artifact";
export type SemanticConflictOverlap = "none" | "same_element" | "dependency";

export type SemanticDecision =
  | "accept_current"
  | "accept_proposed"
  | "synthesize"
  | "split_outputs"
  | "needs_human_review"
  | "reject";

export type SemanticReviewTier =
  | "deterministic_auto_merge"
  | "llm_assisted_validator_approved"
  | "human_review_required"
  | "forbidden";

export type SemanticResolutionAction =
  | "commit_after_final_cas"
  | "llm_resolve_then_validate"
  | "create_review_proposal"
  | "reject";

export interface SemanticConflictPacket {
  conflictId: string;
  roomId: string;
  artifactId: string;
  artifactKind: Artifact["kind"];
  draftId?: string;
  trigger: SemanticConflictTrigger;
  conflictKind: SemanticConflictKind;
  overlap: SemanticConflictOverlap;
  actor?: Actor;
  targetRefs: Array<{ kind: SemanticTargetKind; ref: string }>;
  base: {
    values: Record<string, unknown>;
    versions: Record<string, number>;
  };
  current: {
    values: Record<string, unknown>;
    versions: Record<string, number>;
    changedBy: Record<string, Actor | undefined>;
    evidence?: Record<string, CellEvidence[]>;
  };
  proposed: {
    values: Record<string, unknown>;
    ops: ChangeOp[];
    evidence?: Record<string, CellEvidence[]>;
  };
  context: {
    userIntent: string;
    mergeNote: string;
    deterministicConflicts: MergeResolution["conflicts"];
    openQuestions: string[];
    dependencyElementIds?: string[];
  };
  policy: {
    humanWinsByDefault: boolean;
    formulaOverwriteAllowed: boolean;
    publicPrivateBoundary: "public_only" | "private_allowed" | "mixed_requires_redaction";
    autoCommitAllowed: boolean;
    evaluatorArtifact?: boolean;
    deletesHumanComments?: boolean;
    marksManualClaimVerified?: boolean;
  };
  businessImpact?: "none" | "forecast" | "ebitda_adjustment" | "debt_schedule" | "client_facing";
  status: "open" | "resolved" | "needs_review" | "rejected";
  createdAt: number;
}

export interface SemanticClassification {
  tier: SemanticReviewTier;
  action: SemanticResolutionAction;
  canAutoCommit: boolean;
  reasons: string[];
  requiredValidators: string[];
}

export interface SemanticResolutionOp {
  targetRef: string;
  kind: "create_proposal" | "reject" | "accept_current";
  value?: unknown;
  baseVersion?: number;
  comment: string;
  status: "verified" | "needs_review" | "manual_claim" | "draft" | "rejected";
}

export interface SemanticResolution {
  decision: SemanticDecision;
  reason: string;
  resolvedOps: SemanticResolutionOp[];
  reviewerNote: string;
  openQuestions: string[];
  confidence: number;
  classification: SemanticClassification;
}

const requiredBaseValidators = ["fresh_final_cas", "policy_check"];

export function buildSemanticConflictPacket(args: {
  conflictId: string;
  draft: Draft;
  artifact: Artifact;
  conflicts: MergeResolution["conflicts"];
  createdAt: number;
}): SemanticConflictPacket {
  const targetRefs = args.conflicts.map((conflict) => ({
    kind: targetKind(args.artifact, conflict.elementId),
    ref: conflict.elementId,
  }));
  const conflictIds = new Set(args.conflicts.map((conflict) => conflict.elementId));
  const proposedOps = args.draft.ops.filter((op) => conflictIds.has(op.elementId));
  const baseValues: Record<string, unknown> = {};
  const baseVersions: Record<string, number> = {};
  const currentValues: Record<string, unknown> = {};
  const currentVersions: Record<string, number> = {};
  const changedBy: Record<string, Actor | undefined> = {};
  const proposedValues: Record<string, unknown> = {};

  for (const op of proposedOps) {
    const base = args.draft.base?.[op.elementId];
    const current = args.artifact.elements[op.elementId];
    baseValues[op.elementId] = base?.value;
    baseVersions[op.elementId] = base?.version ?? op.baseVersion;
    currentValues[op.elementId] = current?.value;
    currentVersions[op.elementId] = current?.version ?? 0;
    changedBy[op.elementId] = current?.updatedBy;
    proposedValues[op.elementId] = op.value;
  }

  return {
    conflictId: args.conflictId,
    roomId: args.draft.roomId,
    artifactId: args.artifact.id,
    artifactKind: args.artifact.kind,
    draftId: args.draft.id,
    trigger: "draft_conflict",
    conflictKind: args.artifact.kind === "note" ? "memo_text" : "cell_value",
    overlap: "same_element",
    actor: args.draft.author,
    targetRefs,
    base: { values: baseValues, versions: baseVersions },
    current: { values: currentValues, versions: currentVersions, changedBy },
    proposed: { values: proposedValues, ops: proposedOps },
    context: {
      userIntent: args.draft.note,
      mergeNote: args.draft.resolution?.note ?? "",
      deterministicConflicts: args.conflicts,
      openQuestions: [],
    },
    policy: {
      humanWinsByDefault: true,
      formulaOverwriteAllowed: false,
      publicPrivateBoundary: "public_only",
      autoCommitAllowed: false,
    },
    status: "needs_review",
    createdAt: args.createdAt,
  };
}

export function classifySemanticConflictPacket(packet: SemanticConflictPacket): SemanticClassification {
  const requiredValidators = [...requiredBaseValidators];

  if (packet.policy.evaluatorArtifact || packet.conflictKind === "evaluator_artifact") {
    return {
      tier: "forbidden",
      action: "reject",
      canAutoCommit: false,
      reasons: ["evaluator artifacts and gold files are immutable product inputs"],
      requiredValidators,
    };
  }

  if (packet.policy.deletesHumanComments) {
    return {
      tier: "forbidden",
      action: "reject",
      canAutoCommit: false,
      reasons: ["semantic rebase cannot delete human comments without explicit manual review"],
      requiredValidators,
    };
  }

  if (packet.policy.marksManualClaimVerified) {
    return {
      tier: "forbidden",
      action: "reject",
      canAutoCommit: false,
      reasons: ["manual claims cannot be marked verified by a merge resolver"],
      requiredValidators,
    };
  }

  if (overwritesFormulaWithScalar(packet)) {
    return {
      tier: "forbidden",
      action: "reject",
      canAutoCommit: false,
      reasons: ["formula-to-scalar overwrite is blocked before any LLM resolver"],
      requiredValidators: [...requiredValidators, "formula_preservation"],
    };
  }

  if (hasPrivateEvidenceInPublicOutput(packet)) {
    return {
      tier: "forbidden",
      action: "reject",
      canAutoCommit: false,
      reasons: ["private uploaded evidence cannot be promoted into a public output by semantic rebase"],
      requiredValidators: [...requiredValidators, "privacy_boundary"],
    };
  }

  if (isBusinessAssumption(packet)) {
    return {
      tier: "human_review_required",
      action: "create_review_proposal",
      canAutoCommit: false,
      reasons: [`business assumption impact requires human approval: ${packet.businessImpact}`],
      requiredValidators: [...requiredValidators, "evidence_check", "review_tier"],
    };
  }

  if (packet.conflictKind === "formatting" || packet.overlap === "none") {
    const canAutoCommit = packet.policy.autoCommitAllowed;
    return {
      tier: "deterministic_auto_merge",
      action: canAutoCommit ? "commit_after_final_cas" : "create_review_proposal",
      canAutoCommit,
      reasons: [
        packet.conflictKind === "formatting"
          ? "formatting-only change can be merged deterministically"
          : "proposed changes have no element or dependency overlap",
      ],
      requiredValidators,
    };
  }

  if (isTextMergeCandidate(packet)) {
    return {
      tier: "llm_assisted_validator_approved",
      action: "llm_resolve_then_validate",
      canAutoCommit: packet.policy.autoCommitAllowed,
      reasons: ["textual conflict can be synthesized, but model output must pass validators and final CAS"],
      requiredValidators: [...requiredValidators, "evidence_check", "diff_scope_check"],
    };
  }

  if (packet.policy.humanWinsByDefault) {
    return {
      tier: "human_review_required",
      action: "create_review_proposal",
      canAutoCommit: false,
      reasons: ["human-authored state wins by default"],
      requiredValidators: [...requiredValidators, "evidence_check", "review_tier"],
    };
  }

  return {
    tier: "human_review_required",
    action: "create_review_proposal",
    canAutoCommit: false,
    reasons: ["same-element or dependency conflict is not safe for deterministic auto-merge"],
    requiredValidators: [...requiredValidators, "evidence_check", "dependency_check", "review_tier"],
  };
}

export function resolveSemanticConflictPacket(packet: SemanticConflictPacket): SemanticResolution {
  const classification = classifySemanticConflictPacket(packet);
  const resolvedOps: SemanticResolutionOp[] = [];
  const openQuestions: string[] = [...packet.context.openQuestions];

  for (const op of packet.proposed.ops) {
    const ref = op.elementId;
    const proposedValue = op.value;

    if (classification.action === "reject") {
      resolvedOps.push({
        targetRef: ref,
        kind: "reject",
        comment: classification.reasons[0] ?? "Semantic conflict rejected by policy.",
        status: "rejected",
      });
      continue;
    }

    if (classification.action === "commit_after_final_cas") {
      resolvedOps.push({
        targetRef: ref,
        kind: "create_proposal",
        value: proposedValue,
        baseVersion: packet.current.versions[ref] ?? 0,
        comment: "Safe deterministic semantic merge; still requires a fresh final CAS at apply time.",
        status: "verified",
      });
      continue;
    }

    resolvedOps.push({
      targetRef: ref,
      kind: "create_proposal",
      value: proposedValue,
      baseVersion: packet.current.versions[ref] ?? 0,
      comment:
        classification.action === "llm_resolve_then_validate"
          ? "Semantic text conflict should be synthesized and validator-checked before apply."
          : "Business-value conflict requires human review before changing the current value.",
      status: classification.action === "llm_resolve_then_validate" ? "draft" : "needs_review",
    });
  }

  if (classification.tier === "forbidden") openQuestions.push(...classification.reasons);

  return {
    decision: decisionFor(classification),
    reason: classification.reasons.join("; "),
    resolvedOps,
    reviewerNote:
      "CRS compared base/current/proposed state. It did not bypass managed writes; every accepted op still needs final CAS.",
    openQuestions,
    confidence: confidenceFor(classification),
    classification,
  };
}

export function formulaOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.formula === "string" && record.formula.trim()) return record.formula.trim();
  return null;
}

function hasPrivateEvidenceInPublicOutput(packet: SemanticConflictPacket): boolean {
  if (packet.policy.publicPrivateBoundary !== "public_only") return false;
  return Object.values(packet.proposed.evidence ?? {}).some((items) =>
    items.some((ev) => ev.kind === "upload" || ev.source?.startsWith("private:")),
  );
}

function overwritesFormulaWithScalar(packet: SemanticConflictPacket): boolean {
  if (packet.policy.formulaOverwriteAllowed) return false;
  return Object.entries(packet.current.values).some(([ref, currentValue]) => {
    const proposedValue = packet.proposed.values[ref];
    return Boolean(formulaOf(currentValue) && proposedValue !== undefined && !formulaOf(proposedValue));
  });
}

function isBusinessAssumption(packet: SemanticConflictPacket): boolean {
  return packet.businessImpact !== undefined && packet.businessImpact !== "none";
}

function isTextMergeCandidate(packet: SemanticConflictPacket): boolean {
  return packet.conflictKind === "memo_text" || packet.conflictKind === "note_block" || packet.conflictKind === "chart_annotation";
}

function targetKind(artifact: Artifact, elementId: string): SemanticTargetKind {
  if (artifact.kind === "note" || elementId === "doc") return "memo_block";
  return "cell";
}

function decisionFor(classification: SemanticClassification): SemanticDecision {
  if (classification.tier === "forbidden") return "reject";
  if (classification.tier === "deterministic_auto_merge") return classification.canAutoCommit ? "accept_proposed" : "needs_human_review";
  if (classification.tier === "llm_assisted_validator_approved") return "synthesize";
  return "needs_human_review";
}

function confidenceFor(classification: SemanticClassification): number {
  if (classification.tier === "forbidden") return 0.95;
  if (classification.tier === "deterministic_auto_merge") return 0.86;
  if (classification.tier === "llm_assisted_validator_approved") return 0.68;
  return 0.62;
}
