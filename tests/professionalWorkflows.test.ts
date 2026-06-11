import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_FILE_PROFILE_SUMMARY,
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalWorkflowCategory,
} from "../evals/professionalWorkflows";
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

describe("professional workflow eval catalog", () => {
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
