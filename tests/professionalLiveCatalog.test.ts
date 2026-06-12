import { describe, expect, it } from "vitest";
import {
  gradeProfessionalLiveCatalogAnswer,
  parseProfessionalLiveCatalogAnswer,
} from "../evals/professionalLiveCatalog";
import { PROFESSIONAL_WORKFLOW_CASES } from "../evals/professionalWorkflows";

describe("professional live catalog grader", () => {
  it("passes a grounded live-provider plan for a chat intake case", () => {
    const evalCase = PROFESSIONAL_WORKFLOW_CASES.find((item) => item.id === "gtm-chat-lead-capture-enrich")!;
    const answer = parseProfessionalLiveCatalogAnswer(JSON.stringify({
      caseId: evalCase.id,
      intakeModes: ["chat_only"],
      primarySurface: "watchlist_row",
      evidencePlan: ["manual chat claim evidence", "fetched source citation before upgrade"],
      riskControls: ["private/public boundary", "needs_review for ambiguous entity", "CAS lock and receipt"],
      mutationMode: "draft_first",
      approvalRequired: true,
      privacyBoundary: "private person facts, redact public PII",
      traceMustShow: ["read existing watchlist", "lock row and CAS write", "write receipt with source provenance"],
      blockersToResolve: ["chat intake parser", "entity resolution", "clarifying question gate"],
    }));

    expect(Object.values(gradeProfessionalLiveCatalogAnswer(evalCase, answer)).every(Boolean)).toBe(true);
  });

  it("fails unsupported public write plans with no provenance", () => {
    const evalCase = PROFESSIONAL_WORKFLOW_CASES.find((item) => item.id === "gtm-chat-lead-capture-enrich")!;
    const checks = gradeProfessionalLiveCatalogAnswer(evalCase, {
      caseId: evalCase.id,
      intakeModes: ["chat_only"],
      primarySurface: "public_feed",
      evidencePlan: [],
      riskControls: [],
      mutationMode: "mutate_with_cas",
      approvalRequired: false,
      privacyBoundary: "",
      traceMustShow: ["write"],
      blockersToResolve: [],
    });

    expect(checks.outputSurfaceValid).toBe(false);
    expect(checks.provenancePlan).toBe(false);
    expect(checks.tracePlan).toBe(false);
  });
});
