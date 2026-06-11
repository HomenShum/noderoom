import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalEvalCase,
} from "./professionalWorkflows";
import {
  contractOnlyRequirements,
  professionalCaseReadiness,
} from "./harnessStatus";
import { buildProfessionalCatalogProofs } from "./professionalCatalogProofs";

export type ProfessionalProofLevel =
  | "live_provider"
  | "partial_live_provider"
  | "deterministic_runtime"
  | "deterministic_catalog"
  | "contract_shape";

export type ProfessionalProof = {
  caseId: string;
  category: ProfessionalEvalCase["category"];
  proofLevel: ProfessionalProofLevel;
  readiness: ReturnType<typeof professionalCaseReadiness>;
  evidence: string[];
  blockers: string[];
  note: string;
};

const LIVE_PROVIDER_PROOFS: Record<string, { evidence: string[]; note: string }> = {
  "finance-three-statement-modeling-private-gold": {
    evidence: [
      "docs/eval/finance-model-live.json",
      "docs/eval/FINANCE_MODEL_EVAL.md",
      "docs/eval/eval-runs.jsonl",
    ],
    note:
      "Solve mode is live-proven by a 5/5 model-owned DeepSeek v4 Flash batch. Guide and Collaborate remain blockers on this catalog case.",
  },
};

const DETERMINISTIC_RUNTIME_PROOFS: Record<string, { evidence: string[]; note: string }> = {
  "gtm-chat-lead-capture-enrich": {
    evidence: ["evals/chatIntakeRuntime.ts", "tests/chatIntakeRuntime.test.ts"],
    note:
      "Capture-first contract graded through the real room runtime: provisional rows before the single clarifying question, manual-only evidence for chat claims, CAS update over duplicate, ambiguous entity held at needs_review, private channel only — with a naive-saboteur negative control. Live route + recorded-HTTP canary remains the next rung.",
  },
  "eval-template-to-harness-run": {
    evidence: ["tests/professionalWorkflows.test.ts", "tests/evalStore.test.ts", "evals/evalStore.ts"],
    note: "Harness/eval-store shape is executable and regression-diffed locally.",
  },
  "eval-ui-action-execution-map": {
    evidence: ["tests/workflowEvals.test.ts", "tests/agentRuntime.test.ts", "docs/WORKFLOW_PREVIEWS.md"],
    note: "UI action map is covered by runtime traces and generated workflow previews, not a live provider lane.",
  },
};

const SHARED_PROFESSIONAL_EVIDENCE = [
  "tests/workflowEvals.test.ts",
  "tests/researchHarness.test.ts",
  "tests/researchToolContract.test.ts",
  "evals/professionalCatalogProofs.ts",
  "tests/professionalCatalogProofs.test.ts",
  "docs/eval/professional-catalog-proofs.json",
  "docs/eval/results.json",
  "docs/eval/MEDIA_JUDGE.md",
];

export function buildProfessionalProofLedger(): ProfessionalProof[] {
  const catalogProofsByCase = new Map(
    buildProfessionalCatalogProofs()
      .filter((proof) => proof.checks.every((check) => check.pass))
      .map((proof) => [proof.caseId, proof]),
  );
  return PROFESSIONAL_WORKFLOW_CASES.map((evalCase) => {
    const readiness = professionalCaseReadiness(evalCase);
    const blockers = contractOnlyRequirements(evalCase);
    const live = LIVE_PROVIDER_PROOFS[evalCase.id];
    const catalogProof = catalogProofsByCase.get(evalCase.id);
    if (live && blockers.length === 0) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "live_provider",
        readiness,
        evidence: live.evidence,
        blockers,
        note: live.note,
      };
    }
    if (live) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "partial_live_provider",
        readiness,
        evidence: [...live.evidence, ...(catalogProof?.evidence ?? []), ...SHARED_PROFESSIONAL_EVIDENCE],
        blockers,
        note: live.note,
      };
    }
    const deterministic = DETERMINISTIC_RUNTIME_PROOFS[evalCase.id];
    if (deterministic && blockers.length === 0) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "deterministic_runtime",
        readiness,
        evidence: deterministic.evidence,
        blockers,
        note: deterministic.note,
      };
    }
    if (catalogProof) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "deterministic_catalog",
        readiness,
        evidence: catalogProof.evidence,
        blockers,
        note: "Full deterministic catalog proof exists: intake, output surface, provenance, trajectory, privacy/long-running/private-gold contracts, and requirement-proof registry all pass. Runtime/live provider promotion remains separate.",
      };
    }
    return {
      caseId: evalCase.id,
      category: evalCase.category,
      proofLevel: readiness === "runnable" ? "deterministic_runtime" : "contract_shape",
      readiness,
      evidence: SHARED_PROFESSIONAL_EVIDENCE,
      blockers,
      note: "Cataloged workflow; not live-proven until blockers have a behavioral runner and route proof.",
    };
  });
}

export function summarizeProfessionalProofs(rows = buildProfessionalProofLedger()) {
  return {
    total: rows.length,
    liveProvider: rows.filter((row) => row.proofLevel === "live_provider").length,
    partialLiveProvider: rows.filter((row) => row.proofLevel === "partial_live_provider").length,
    deterministicRuntime: rows.filter((row) => row.proofLevel === "deterministic_runtime").length,
    deterministicCatalog: rows.filter((row) => row.proofLevel === "deterministic_catalog").length,
    contractShape: rows.filter((row) => row.proofLevel === "contract_shape").length,
    allCatalogsProofed: rows.every((row) => row.proofLevel !== "contract_shape"),
    allLiveProven: rows.every((row) => row.proofLevel === "live_provider"),
    blockedCaseIds: rows.filter((row) => row.proofLevel !== "live_provider").map((row) => row.caseId),
    runtimeBlockedCaseIds: rows.filter((row) => row.blockers.length > 0).map((row) => row.caseId),
    unproofedCaseIds: rows.filter((row) => row.proofLevel === "contract_shape").map((row) => row.caseId),
  };
}

function main() {
  const rows = buildProfessionalProofLedger();
  const summary = summarizeProfessionalProofs(rows);
  const out = join("docs", "eval", "professional-proof-ledger.json");
  mkdirSync(join("docs", "eval"), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${out}`);
  if (process.argv.includes("--require-all-live") && !summary.allLiveProven) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
