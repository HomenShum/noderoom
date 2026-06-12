import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalEvalCase,
  type ProfessionalHarnessRequirement,
} from "./professionalWorkflows";

export type RequirementProofKind =
  | "runtime_test"
  | "deterministic_catalog_judge"
  | "private_redacted_runner";

export type RequirementProof = {
  requirement: ProfessionalHarnessRequirement;
  kind: RequirementProofKind;
  evidence: string[];
  method: string;
};

export type CatalogProofCheckId =
  | "case_shape"
  | "requirement_registry"
  | "outcome_assertions"
  | "trajectory_assertions"
  | "intake_surface_contract"
  | "provenance_contract"
  | "privacy_contract"
  | "long_running_contract"
  | "private_gold_contract";

export type CatalogProofCheck = {
  id: CatalogProofCheckId;
  pass: boolean;
  note: string;
};

export type ProfessionalCatalogProof = {
  caseId: string;
  category: ProfessionalEvalCase["category"];
  proofLevel: "deterministic_catalog";
  checks: CatalogProofCheck[];
  requirementProofs: RequirementProof[];
  evidence: string[];
};

export const REQUIREMENT_PROOF_REGISTRY = {
  artifact_refs: {
    requirement: "artifact_refs",
    kind: "runtime_test",
    evidence: ["tests/agentRuntime.test.ts", "tests/artifactRefs.test.ts", "src/agent/roomTools.ts"],
    method: "Artifact ids and selected-room references must be canonical, clickable, and carried into tool context.",
  },
  cell_payload_evidence: {
    requirement: "cell_payload_evidence",
    kind: "runtime_test",
    evidence: ["tests/researchHarness.test.ts", "tests/researchToolContract.test.ts", "src/engine/types.ts"],
    method: "Mutating spreadsheet outputs must carry value, source/evidence, confidence, and status metadata.",
  },
  schema_detection: {
    requirement: "schema_detection",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalCatalogProofs.test.ts", "tests/spreadsheetParser.test.ts"],
    method: "Catalog cases must declare schema/layout failure modes before they can be promoted to runtime fixtures.",
  },
  chat_intake_parser: {
    requirement: "chat_intake_parser",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalWorkflows.test.ts"],
    method: "Chat-started cases must declare intake modes, output surfaces, provenance strength, and ambiguity handling.",
  },
  entity_resolution: {
    requirement: "entity_resolution",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalCatalogProofs.test.ts"],
    method: "Entity cases must include ambiguity/duplicate/conflict assertions rather than single-name guessing.",
  },
  clarifying_question_gate: {
    requirement: "clarifying_question_gate",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalCatalogProofs.test.ts"],
    method: "Ambiguous chat-only cases must prove ask-or-review behavior before writes are considered complete.",
  },
  spreadsheet_semantic_index: {
    requirement: "spreadsheet_semantic_index",
    kind: "runtime_test",
    evidence: ["tests/spreadsheetIndex.test.ts", "convex/spreadsheetIndexLib.ts", "evals/professionalCatalogProofs.ts"],
    method: "Large, sparse, or multi-sheet catalog cases must declare retrieval/chunking semantics and not whole-file prompting.",
  },
  formula_dependency_locks: {
    requirement: "formula_dependency_locks",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/financeModelReliability.test.ts", "tests/financeModelRuntime.test.ts"],
    method: "Formula-sensitive cases must declare dependency locks, formula preservation, or derived-cell review behavior.",
  },
  cross_file_context: {
    requirement: "cross_file_context",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/workflowEvals.test.ts"],
    method: "Cross-file cases must cite source artifact/sheet/row and declare non-conflation or conflict behavior.",
  },
  privacy_redaction: {
    requirement: "privacy_redaction",
    kind: "runtime_test",
    evidence: ["tests/agentRuntime.test.ts", "tests/promptInjection.test.ts", "src/agent/context.ts"],
    method: "Public/private boundaries and prompt-injection fencing are runtime tested; catalog cases must state masking rules.",
  },
  provider_parser_adapter: {
    requirement: "provider_parser_adapter",
    kind: "runtime_test",
    evidence: ["tests/providerParserAdapter.test.ts", "scripts/provider-parser-smoke.ts", "src/app/providerParserAdapter.ts"],
    method: "Provider parse adapters have unit and smoke coverage; catalog rows state which layout failure they depend on.",
  },
  liteparse_layout_fallback: {
    requirement: "liteparse_layout_fallback",
    kind: "runtime_test",
    evidence: ["npm run liteparse:smoke", "src/app/liteparseAdapter.ts"],
    method: "Fallback parse smoke covers local parser availability for layout-heavy files.",
  },
  long_running_free_auto: {
    requirement: "long_running_free_auto",
    kind: "runtime_test",
    evidence: ["tests/agentJobsRuntime.test.ts", "tests/modelEvalMatrix.test.ts", "convex/agentJobs.ts"],
    method: "Long-running work must use agentJobs, checkpoints, route audit, and duplicate-write prevention.",
  },
  workflow_checkpoint_resume: {
    requirement: "workflow_checkpoint_resume",
    kind: "runtime_test",
    evidence: ["tests/agentRuntime.test.ts", "tests/agentJobsRuntime.test.ts", "src/agent/runtime.ts"],
    method: "Workflow state must be resumable and preserve unexecuted tool calls and receipts.",
  },
  resolved_model_audit: {
    requirement: "resolved_model_audit",
    kind: "runtime_test",
    evidence: ["tests/modelEvalMatrix.test.ts", "src/agent/modelCatalog.ts", "docs/eval/model-eval-matrix-plan.json"],
    method: "Every route proof records the resolved provider model instead of only the requested alias.",
  },
  private_gold_pack: {
    requirement: "private_gold_pack",
    kind: "private_redacted_runner",
    evidence: ["scripts/private-finance-model-gold.ts", "docs/eval/FINANCE_MODEL_EVAL.md"],
    method: "Private gold workbooks run locally by content hash; committed evidence is redacted summaries only.",
  },
  answer_key_formula_oracle: {
    requirement: "answer_key_formula_oracle",
    kind: "private_redacted_runner",
    evidence: ["evals/financeModelLive.ts", "docs/eval/finance-model-live.json", "tests/financeModelLive.test.ts"],
    method: "The answer key is grader-only and never included in model-visible prompt or public traces.",
  },
  formula_structure_equivalence: {
    requirement: "formula_structure_equivalence",
    kind: "runtime_test",
    evidence: ["evals/financeModelGold.ts", "tests/financeModelReliability.test.ts"],
    method: "Formula judging checks structure, references, and tie-outs rather than exact pasted answer strings.",
  },
  guide_mode_no_write: {
    requirement: "guide_mode_no_write",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalCatalogProofs.test.ts", "evals/financeModelGold.ts"],
    method: "Guide-mode catalogs must explicitly assert zero answer-cell writes and hint-first behavior.",
  },
  section_collaboration_locks: {
    requirement: "section_collaboration_locks",
    kind: "deterministic_catalog_judge",
    evidence: ["evals/professionalCatalogProofs.ts", "tests/professionalCatalogProofs.test.ts", "tests/lockFencing.test.ts"],
    method: "Collaborate-mode catalogs must assert section leases, drafts when blocked, CAS on shared linkage rows, and human-edit preservation.",
  },
  wiki_grounded_update: {
    requirement: "wiki_grounded_update",
    kind: "runtime_test",
    evidence: ["tests/wikiSkill.test.ts", "docs/skills/self-updating-wiki/SKILL.md"],
    method: "Wiki updates must be source-linked, idempotent, and respect public/private boundaries.",
  },
  human_review: {
    requirement: "human_review",
    kind: "runtime_test",
    evidence: ["tests/agentRuntime.test.ts", "tests/roomEngine.test.ts", "src/engine/roomEngine.ts"],
    method: "Review-mode proposals and human approval paths are runtime tested; catalogs must state review conditions.",
  },
} satisfies Record<ProfessionalHarnessRequirement, RequirementProof>;

const PROVENANCE_WORDS = /evidence|cite|source|artifact|row|line|reference|claim|provenance/i;
const TRAJECTORY_WORDS = /trace|lock|CAS|draft|checkpoint|resume|version|no duplicate|resolvedModel|approval|review/i;
const PRIVATE_GOLD_WORDS = /private|answer key|guide mode|collaborate mode|zero writes|leased section|balance check/i;
const PRIVACY_WORDS = /mask|private|redact|public|sensitive|raw|leak|PII|account|email|phone/i;
const LONG_RUNNING_WORDS = /checkpoint|resume|resolvedModel|duplicate|\/free|route|job/i;

export function buildProfessionalCatalogProofs(cases = PROFESSIONAL_WORKFLOW_CASES): ProfessionalCatalogProof[] {
  return cases.map((evalCase) => {
    const text = caseText(evalCase);
    const requirementProofs = evalCase.requiredHarness.map((requirement) => REQUIREMENT_PROOF_REGISTRY[requirement]);
    const evidence = unique([
      "evals/professionalWorkflows.ts",
      "evals/professionalCatalogProofs.ts",
      "tests/professionalCatalogProofs.test.ts",
      ...requirementProofs.flatMap((proof) => proof.evidence),
    ]);
    return {
      caseId: evalCase.id,
      category: evalCase.category,
      proofLevel: "deterministic_catalog",
      checks: [
        check("case_shape", evalCase.evalSteps.length >= 4 && evalCase.assertions.length >= 4 && evalCase.requiredHarness.length >= 3, "case has concrete steps, assertions, and harness requirements"),
        check("requirement_registry", requirementProofs.every(Boolean), "every required harness has a named proof method and evidence"),
        check("outcome_assertions", evalCase.assertions.some((assertion) => PROVENANCE_WORDS.test(assertion) || /accuracy|F1|tie|total|score|unchanged|unknown/i.test(assertion)), "assertions include observable artifact/output outcomes"),
        check("trajectory_assertions", TRAJECTORY_WORDS.test(text), "case declares trace, locking, versioning, checkpoint, or review behavior"),
        check("intake_surface_contract", !evalCase.intakeModes?.some((mode) => mode === "chat_only" || mode === "pasted_content") || Boolean(evalCase.outputContract), "chat/paste cases declare where results may land"),
        check("provenance_contract", PROVENANCE_WORDS.test(text), "case keeps source provenance instead of relying on unsupported memory"),
        check("privacy_contract", !evalCase.requiredHarness.includes("privacy_redaction") || PRIVACY_WORDS.test(text), "privacy-sensitive case states masking or boundary behavior"),
        check("long_running_contract", !evalCase.requiredHarness.includes("long_running_free_auto") || LONG_RUNNING_WORDS.test(text), "long-running case states checkpoint/resume/route audit behavior"),
        check("private_gold_contract", !evalCase.requiredHarness.includes("private_gold_pack") || PRIVATE_GOLD_WORDS.test(text), "private gold case keeps answer material outside public artifacts and grades modes separately"),
      ],
      requirementProofs,
      evidence,
    };
  });
}

export function summarizeProfessionalCatalogProofs(rows = buildProfessionalCatalogProofs()) {
  const failed = rows.filter((row) => row.checks.some((check) => !check.pass));
  return {
    total: rows.length,
    deterministicCatalog: rows.filter((row) => row.proofLevel === "deterministic_catalog").length,
    fullyProofed: failed.length === 0,
    failedCaseIds: failed.map((row) => row.caseId),
  };
}

function check(id: CatalogProofCheckId, pass: boolean, note: string): CatalogProofCheck {
  return { id, pass, note };
}

function caseText(evalCase: ProfessionalEvalCase): string {
  return [
    evalCase.id,
    evalCase.workflow,
    evalCase.agentGoal,
    evalCase.fixtureStrategy,
    ...(evalCase.intakeModes ?? []),
    ...(evalCase.sourcePatterns ?? []),
    ...(evalCase.evalSteps ?? []),
    ...(evalCase.assertions ?? []),
    ...(evalCase.productionNotes ?? []),
    evalCase.outputContract?.escalationRule ?? "",
  ].join("\n");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function main() {
  const rows = buildProfessionalCatalogProofs();
  const summary = summarizeProfessionalCatalogProofs(rows);
  const out = join("docs", "eval", "professional-catalog-proofs.json");
  mkdirSync(join("docs", "eval"), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${out}`);
  if (process.argv.includes("--require-full") && !summary.fullyProofed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
