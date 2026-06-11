import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_FILE_PROFILE_SUMMARY,
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalHarnessRequirement,
  type ProfessionalWorkflowCategory,
  type ProfessionalWorkflowIntake,
} from "../evals/professionalWorkflows";
import {
  PROFESSIONAL_HARNESS_STATUS,
  contractOnlyRequirements,
  professionalCaseReadiness,
} from "../evals/harnessStatus";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  FINANCE_MODEL_MODE_CONTRACTS,
  FINANCE_MODEL_REQUIRED_SHEETS,
  PRIVATE_FINANCE_MODEL_GOLD_ENV,
  formulaMentionsAllRefs,
  normalizeExcelFormula,
} from "../evals/financeModelGold";

const categories: ProfessionalWorkflowCategory[] = [
  "gtm_company_research",
  "finance_ops",
  "eval_harness",
  "analytics_optimization",
  "legacy_agent_outputs",
];

const intakeModes: ProfessionalWorkflowIntake[] = [
  "chat_only",
  "pasted_content",
  "upload",
  "selected_artifact",
  "mixed_room_state",
  "external_retrieval",
];

const harnessRequirements: ProfessionalHarnessRequirement[] = [
  "artifact_refs",
  "cell_payload_evidence",
  "schema_detection",
  "chat_intake_parser",
  "entity_resolution",
  "clarifying_question_gate",
  "spreadsheet_semantic_index",
  "formula_dependency_locks",
  "cross_file_context",
  "privacy_redaction",
  "provider_parser_adapter",
  "liteparse_layout_fallback",
  "long_running_free_auto",
  "workflow_checkpoint_resume",
  "resolved_model_audit",
  "private_gold_pack",
  "answer_key_formula_oracle",
  "formula_structure_equivalence",
  "guide_mode_no_write",
  "section_collaboration_locks",
  "wiki_grounded_update",
  "human_review",
];

describe("professional workflow eval catalog — typed contracts; proof tiers live in the proof ledger", () => {
  it("records the redacted shape of the reviewed workbook set", () => {
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.manifestFiles).toBe(70);
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.csvFiles).toBe(23);
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.xlsxFiles).toBe(47);
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.piiHeaderSignals).toBeGreaterThan(40);
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.formulaSampleFiles).toBeGreaterThan(10);
    expect(PROFESSIONAL_FILE_PROFILE_SUMMARY.mergedCellFiles).toBeGreaterThan(10);
  });

  it("covers every professional workflow category from the file profile", () => {
    for (const category of categories) {
      expect(PROFESSIONAL_WORKFLOW_CASES.some((c) => c.category === category), category).toBe(true);
    }
  });

  it("keeps cases concrete enough to convert into runnable fixtures", () => {
    for (const c of PROFESSIONAL_WORKFLOW_CASES) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.sourcePatterns.length, c.id).toBeGreaterThan(0);
      expect(c.agentGoal.length, c.id).toBeGreaterThan(40);
      expect(c.fixtureStrategy.length, c.id).toBeGreaterThan(30);
      expect(c.evalSteps.length, c.id).toBeGreaterThanOrEqual(4);
      expect(c.assertions.length, c.id).toBeGreaterThanOrEqual(4);
      expect(c.requiredHarness.length, c.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("requires evidence-bearing writes for spreadsheet mutation workflows", () => {
    const mutationCases = PROFESSIONAL_WORKFLOW_CASES.filter((c) =>
      /write|correct|classify|match|rank|reconcile|validate|update/i.test(c.agentGoal),
    );

    expect(mutationCases.length).toBeGreaterThan(5);
    for (const c of mutationCases) {
      expect(
        c.requiredHarness.includes("cell_payload_evidence") ||
          c.requiredHarness.includes("wiki_grounded_update"),
        c.id,
      ).toBe(true);
      expect(c.assertions.some((a) => /evidence|cites|source artifact|artifact id/i.test(a)), c.id).toBe(true);
    }
  });

  it("treats chat-only intake as a first-class workflow source, not an upload fallback", () => {
    const chatCases = PROFESSIONAL_WORKFLOW_CASES.filter((c) => c.intakeModes?.includes("chat_only"));

    expect(chatCases.length).toBeGreaterThanOrEqual(2);
    expect(chatCases.some((c) => c.id === "gtm-chat-lead-capture-enrich")).toBe(true);
    expect(chatCases.some((c) => c.id === "gtm-chat-to-background-diligence-job")).toBe(true);

    for (const c of chatCases) {
      expect(c.intakeModes?.some((mode) => intakeModes.includes(mode)), c.id).toBe(true);
      expect(c.requiredHarness).toEqual(expect.arrayContaining([
        "chat_intake_parser",
        "entity_resolution",
        "clarifying_question_gate",
      ]));
      expect(c.evalSteps.join(" "), c.id).toMatch(/no uploaded file|chat-only|no files attached/i);
      expect(c.assertions.join(" "), c.id).toMatch(/upload|chat|manual evidence|sourceKind|duplicate/i);
    }
  });

  it("keeps declared harness contracts separate from implemented behavioral graders", () => {
    expect(Object.keys(PROFESSIONAL_HARNESS_STATUS).sort()).toEqual([...harnessRequirements].sort());
    // Flipped contract -> implemented 2026-06-11 in the same change as the implementation:
    // evals/chatIntakeRuntime.ts grades capture-first, question budget, dedupe, and
    // ambiguity-without-guessing through the real room runtime (tests/chatIntakeRuntime.test.ts).
    expect(PROFESSIONAL_HARNESS_STATUS.chat_intake_parser.status).toBe("implemented");
    expect(PROFESSIONAL_HARNESS_STATUS.entity_resolution.status).toBe("implemented");
    expect(PROFESSIONAL_HARNESS_STATUS.clarifying_question_gate.status).toBe("implemented");
    // Range locks on target cells are graded; locking formula CHILDREN on parent edits is not.
    expect(PROFESSIONAL_HARNESS_STATUS.formula_dependency_locks.status).toBe("contract");
    expect(PROFESSIONAL_HARNESS_STATUS.guide_mode_no_write.status).toBe("contract");
    expect(PROFESSIONAL_HARNESS_STATUS.section_collaboration_locks.status).toBe("contract");

    for (const [requirement, status] of Object.entries(PROFESSIONAL_HARNESS_STATUS)) {
      if (status.status === "implemented") {
        expect(status.entryPoint, requirement).toBeTruthy();
        expect(status.evidence, requirement).toBeTruthy();
      }
    }
  });

  it("backs every implemented harness entry with an entry point that exists on disk", () => {
    for (const [requirement, status] of Object.entries(PROFESSIONAL_HARNESS_STATUS)) {
      if (status.status !== "implemented") continue;
      expect(status.entryPoint && existsSync(status.entryPoint), `${requirement}: ${status.entryPoint}`).toBe(true);
      // evidence may be a command (e.g. "npm run liteparse:smoke"); only path-shaped evidence must exist.
      if (status.evidence && /[/\\]/.test(status.evidence) && !status.evidence.startsWith("npm ")) {
        expect(existsSync(status.evidence), `${requirement}: ${status.evidence}`).toBe(true);
      }
    }
  });

  it("declares every intake mode on at least one case so the vocabulary cannot silently rot", () => {
    for (const mode of intakeModes) {
      expect(PROFESSIONAL_WORKFLOW_CASES.some((c) => c.intakeModes?.includes(mode)), mode).toBe(true);
    }
  });

  it("gives every chat-started case an output contract — results land on a declared surface", () => {
    const chatStarted = PROFESSIONAL_WORKFLOW_CASES.filter((c) =>
      c.intakeModes?.some((mode) => mode === "chat_only" || mode === "pasted_content"),
    );
    expect(chatStarted.length).toBeGreaterThanOrEqual(3);
    for (const c of chatStarted) {
      expect(c.outputContract, c.id).toBeTruthy();
      expect(c.outputContract!.allowedSurfaces, c.id).toContain(c.outputContract!.defaultSurface);
      expect(`${c.outputContract!.escalationRule} ${c.assertions.join(" ")}`, c.id).toMatch(/unrequested public/i);
      const mentionsPerson = /person|spoke with/i.test(`${c.workflow} ${c.sourcePatterns.join(" ")}`);
      if (mentionsPerson) {
        expect(c.assertions.join(" "), c.id).toMatch(/private[- ]by[- ]default|stay private|private visibility/i);
      }
    }
  });

  it("treats pasted third-party content as quoted evidence, never as the user's own words", () => {
    const pastedCases = PROFESSIONAL_WORKFLOW_CASES.filter((c) => c.intakeModes?.includes("pasted_content"));
    expect(pastedCases.length).toBeGreaterThanOrEqual(1);
    for (const c of pastedCases) {
      expect(c.requiredHarness).toEqual(expect.arrayContaining([
        "chat_intake_parser",
        "entity_resolution",
        "privacy_redaction",
      ]));
      expect(c.assertions.join(" "), c.id).toMatch(/quoted_third_party/);
      expect(c.assertions.join(" "), c.id).toMatch(/attribut/i);
      expect(c.assertions.join(" "), c.id).toMatch(/redact/i);
      expect(c.evalSteps.join(" "), c.id).toMatch(/paste/i);
    }
  });

  it("does not call a professional case runnable while it still depends on contract-only harnesses", () => {
    for (const c of PROFESSIONAL_WORKFLOW_CASES) {
      if (professionalCaseReadiness(c) === "runnable") {
        expect(contractOnlyRequirements(c), c.id).toEqual([]);
      } else {
        expect(contractOnlyRequirements(c).length, c.id).toBeGreaterThan(0);
      }
    }
  });

  it("keeps privacy as a first-class requirement for contact-heavy workflows", () => {
    const sensitiveCases = PROFESSIONAL_WORKFLOW_CASES.filter((c) =>
      /pii|contact|private|email|phone|time|transaction|card/i.test(
        `${c.id} ${c.workflow} ${c.sourcePatterns.join(" ")}`,
      ),
    );

    expect(sensitiveCases.length).toBeGreaterThanOrEqual(3);
    for (const c of sensitiveCases) {
      expect(c.requiredHarness.includes("privacy_redaction"), c.id).toBe(true);
      expect(c.assertions.some((a) => /mask|private|sensitive|raw|leak/i.test(a)), c.id).toBe(true);
    }
  });

  it("distinguishes long-running free-auto bulk work from fast interactive collaboration", () => {
    const longRunningCases = PROFESSIONAL_WORKFLOW_CASES.filter((c) =>
      c.requiredHarness.includes("long_running_free_auto"),
    );

    expect(longRunningCases.length).toBeGreaterThanOrEqual(2);
    for (const c of longRunningCases) {
      expect(c.requiredHarness.includes("workflow_checkpoint_resume"), c.id).toBe(true);
      expect(c.requiredHarness.includes("resolved_model_audit"), c.id).toBe(true);
      expect(c.assertions.some((a) => /checkpoint|resolvedModel|duplicate|route|\/free/i.test(a)), c.id).toBe(true);
    }
  });

  it("does not commit private absolute file paths or raw local values into the catalog", () => {
    const json = JSON.stringify(PROFESSIONAL_WORKFLOW_CASES);
    expect(json).not.toMatch(/C:[/\\]Users/i);
    expect(json).not.toMatch(/Downloads[/\\]/i);
  });

  it("tracks the private 3-statement modeling gold pack without committing the workbook", () => {
    const modeling = PROFESSIONAL_WORKFLOW_CASES.find((c) => c.id === "finance-three-statement-modeling-private-gold");
    expect(modeling).toBeTruthy();
    expect(modeling?.requiredHarness).toEqual(expect.arrayContaining([
      "private_gold_pack",
      "answer_key_formula_oracle",
      "formula_structure_equivalence",
      "guide_mode_no_write",
      "section_collaboration_locks",
    ]));
    expect(modeling?.evalSteps.join(" ")).toMatch(/Solve mode/i);
    expect(modeling?.evalSteps.join(" ")).toMatch(/Guide mode/i);
    expect(modeling?.evalSteps.join(" ")).toMatch(/Collaborate mode/i);
    expect(modeling?.fixtureStrategy).toContain("outside the public repo");
    expect(modeling?.productionNotes.join(" ")).toContain("beginning debt balances");
  });

  it("defines a finance-model oracle around required sheets and formula structure, not pasted values", () => {
    expect(FINANCE_MODEL_REQUIRED_SHEETS).toEqual([
      "Test Prompt",
      "Historical Data",
      "Your Model",
      "Answer Key",
    ]);
    expect(PRIVATE_FINANCE_MODEL_GOLD_ENV).toBe("NODEAGENT_FINANCE_MODEL_GOLD_XLSX");
    expect(FINANCE_MODEL_MODE_CONTRACTS.map((contract) => contract.mode)).toEqual([
      "solve",
      "guide",
      "collaborate",
    ]);
    expect(FINANCE_MODEL_CRITICAL_FORMULAS.length).toBeGreaterThanOrEqual(12);
    expect(FINANCE_MODEL_CRITICAL_FORMULAS.some((check) => check.cell === "F85" && check.label === "Balance check")).toBe(true);
    expect(normalizeExcelFormula(" = e7 * ( 1 + 'Historical Data'!$D$98 ) ")).toBe("E7*(1+'HISTORICALDATA'!D98)");
    expect(formulaMentionsAllRefs("=E7*(1+'Historical Data'!D98)", ["E7", "'Historical Data'!D98"])).toBe(true);
  });
});
