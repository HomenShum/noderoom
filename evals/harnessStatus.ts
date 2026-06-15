import type { ProfessionalEvalCase, ProfessionalHarnessRequirement } from "./professionalWorkflows";

export type HarnessImplementationState = "implemented" | "contract";

export type HarnessRequirementStatus = {
  status: HarnessImplementationState;
  entryPoint?: string;
  evidence?: string;
  notes: string;
};

export type ProfessionalCaseReadiness = "runnable" | "contract";

export const PROFESSIONAL_HARNESS_STATUS = {
  artifact_refs: {
    status: "implemented",
    entryPoint: "src/ui/LeftRail.tsx",
    evidence: "tests/agentRuntime.test.ts",
    notes: "Files can be referenced from chat and resolved into artifact context.",
  },
  cell_payload_evidence: {
    status: "implemented",
    entryPoint: "src/engine/types.ts",
    evidence: "tests/researchHarness.test.ts",
    notes: "Spreadsheet writes can carry structured value, confidence, and evidence metadata.",
  },
  schema_detection: {
    status: "contract",
    notes: "Cataloged for professional fixtures, but no behavioral grader proves inferred schemas yet.",
  },
  chat_intake_parser: {
    status: "implemented",
    entryPoint: "evals/chatIntakeRuntime.ts",
    evidence: "tests/chatIntakeRuntime.test.ts",
    notes: "Outcome-graded through the real room runtime: a chat note must land as the right rows/cells with manual-evidence payloads (the model is the parser; the rung is the gate). No standalone parser module — extraction is graded by final artifact state, with a naive saboteur proving the grader can fail.",
  },
  entity_resolution: {
    status: "implemented",
    entryPoint: "evals/chatIntakeRuntime.ts",
    evidence: "tests/chatIntakeRuntime.test.ts",
    notes: "Behaviorally graded against a fixture with a known row (must CAS-update, not duplicate) and a deliberately ambiguous pair (must needs_review/clarify, never guess). Live registry-backed resolution remains the later live-canary rung.",
  },
  clarifying_question_gate: {
    status: "implemented",
    entryPoint: "evals/chatIntakeRuntime.ts",
    evidence: "tests/chatIntakeRuntime.test.ts",
    notes: "The capture-first budget is graded from the trace: provisional writes must precede any question, at most ONE clarifying question per intake, and upload demands fail outright.",
  },
  spreadsheet_semantic_index: {
    status: "contract",
    notes: "Needed for large professional sheets; current tests do not prove semantic row/column retrieval.",
  },
  formula_dependency_locks: {
    status: "contract",
    notes: "The finance solve grades range locks on TARGET cells and formula linkage (financeModelLive.ts), but nothing locks or flags formula CHILDREN when a parent input cell is edited — which is what the reconciliation cases require. Declared, not built.",
  },
  cross_file_context: {
    status: "implemented",
    entryPoint: "evals/crossFileJoinGrader.ts",
    evidence: "tests/crossFileJoinGrader.test.ts",
    notes: "Deterministic cross-file join/reconciliation grader: a value reconciled into artifact B must tie out to its source row in artifact A on a shared key; catches an invented-value saboteur and a join on a missing key. The full agent-runtime cross-file rung (driving runAgent across two artifacts, like chatIntakeRuntime) is a follow-up.",
  },
  privacy_redaction: {
    status: "implemented",
    entryPoint: "src/nodeagent/core/worldModel.ts",
    evidence: "tests/agentRuntime.test.ts",
    notes: "Runtime tests cover private/public context boundaries and redaction-oriented contracts.",
  },
  provider_parser_adapter: {
    status: "implemented",
    entryPoint: "src/app/providerParserAdapter.ts",
    evidence: "tests/providerParserAdapter.test.ts",
    notes: "Provider parsing has adapter tests and smoke scripts; workflow-specific accuracy remains separate.",
  },
  liteparse_layout_fallback: {
    status: "implemented",
    entryPoint: "src/app/liteparseAdapter.ts",
    evidence: "npm run liteparse:smoke",
    notes: "Local parser fallback exists for document/spreadsheet extraction smoke coverage.",
  },
  long_running_free_auto: {
    status: "implemented",
    entryPoint: "convex/agentJobs.ts",
    evidence: "tests/agentJobsRuntime.test.ts",
    notes: "Durable jobs and resolved-route auditing are covered separately from each domain eval.",
  },
  workflow_checkpoint_resume: {
    status: "implemented",
    entryPoint: "src/nodeagent/core/runtime.ts",
    evidence: "tests/agentRuntime.test.ts",
    notes: "Runtime preserves handoff state and unexecuted tool calls for resumed long jobs.",
  },
  resolved_model_audit: {
    status: "implemented",
    entryPoint: "src/nodeagent/models/adapter.ts",
    evidence: "tests/modelEvalMatrix.test.ts",
    notes: "Resolved model names are tracked for free-auto and model-matrix reporting.",
  },
  private_gold_pack: {
    status: "implemented",
    entryPoint: "scripts/private-finance-model-gold.ts",
    evidence: "docs/eval/FINANCE_MODEL_EVAL.md",
    notes: "Private workbook validation runs locally while keeping copyrighted gold data out of the repo.",
  },
  answer_key_formula_oracle: {
    status: "implemented",
    entryPoint: "evals/financeModelLive.ts",
    evidence: "docs/eval/finance-model-live.json",
    notes: "The answer key is grader-only and never included in candidate-visible context.",
  },
  formula_structure_equivalence: {
    status: "implemented",
    entryPoint: "evals/financeModelGold.ts",
    evidence: "tests/professionalWorkflows.test.ts",
    notes: "Formula grading checks required references and tokens rather than exact answer-string paste.",
  },
  guide_mode_no_write: {
    status: "contract",
    notes: "Guide mode is designed, but no runtime eval proves zero-write coaching yet.",
  },
  section_collaboration_locks: {
    status: "contract",
    notes: "Collaboration mode is designed, but no section-leased finance eval is executable yet.",
  },
  wiki_grounded_update: {
    status: "implemented",
    entryPoint: "docs/skills/self-updating-wiki/SKILL.md",
    evidence: "tests/wikiSkill.test.ts",
    notes: "Wiki skill contract and source-link invariants are tested; domain-specific wiki updates still need lanes.",
  },
  human_review: {
    status: "implemented",
    entryPoint: "src/engine/roomEngine.ts",
    evidence: "tests/agentRuntime.test.ts",
    notes: "Proposal/review flows are part of the room engine and runtime tests.",
  },
} satisfies Record<ProfessionalHarnessRequirement, HarnessRequirementStatus>;

export function contractOnlyRequirements(evalCase: Pick<ProfessionalEvalCase, "requiredHarness">): ProfessionalHarnessRequirement[] {
  return evalCase.requiredHarness.filter((requirement) => PROFESSIONAL_HARNESS_STATUS[requirement].status !== "implemented");
}

export function professionalCaseReadiness(evalCase: Pick<ProfessionalEvalCase, "requiredHarness">): ProfessionalCaseReadiness {
  return contractOnlyRequirements(evalCase).length ? "contract" : "runnable";
}
