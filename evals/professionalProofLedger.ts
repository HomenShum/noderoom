import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { readProfessionalLiveCatalog } from "./professionalLiveCatalog";
import { readProfessionalRuntimeLive } from "./professionalRuntimeLive";

export type ProfessionalProofLevel =
  | "live_provider"
  | "partial_live_provider"
  | "live_provider_catalog"
  | "deterministic_runtime"
  | "deterministic_catalog"
  | "contract_shape";

export type RuntimeLockMode =
  | "runtime_managed_lock"
  | "explicit_agent_lock"
  | "catalog_only"
  | "not_applicable";

export type ProfessionalProof = {
  caseId: string;
  category: ProfessionalEvalCase["category"];
  proofLevel: ProfessionalProofLevel;
  runtimeLockMode: RuntimeLockMode;
  readiness: ReturnType<typeof professionalCaseReadiness>;
  evidence: string[];
  blockers: string[];
  note: string;
};

const LIVE_PROVIDER_PROOFS: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> = {
  "finance-three-statement-modeling-private-gold": {
    evidence: [
      "docs/eval/finance-model-live.json",
      "docs/eval/FINANCE_MODEL_EVAL.md",
      "docs/eval/eval-runs.jsonl",
    ],
    note:
      "Solve mode is live-proven by a 5/5 model-owned DeepSeek v4 Flash batch. Guide and Collaborate remain blockers on this catalog case.",
    runtimeLockMode: "explicit_agent_lock",
  },
};

const CHAT_INTAKE_LIVE_PATH = "docs/eval/chat-intake-live.json";
const CHAT_INTAKE_MANAGED_LIVE_PATH = "docs/eval/chat-intake-live-managed.json";
const PROFESSIONAL_LIVE_CATALOG_PATH = "docs/eval/professional-live-catalog.json";
const PROFESSIONAL_LIVE_RUNTIME_PATH = "docs/eval/professional-live-runtime.json";

const DETERMINISTIC_RUNTIME_PROOFS: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> = {
  "gtm-chat-lead-capture-enrich": {
    evidence: ["evals/chatIntakeRuntime.ts", "tests/chatIntakeRuntime.test.ts"],
    runtimeLockMode: "runtime_managed_lock",
    note:
      "Capture-first contract graded through the real room runtime: provisional rows before the single clarifying question, manual-only evidence for chat claims, CAS update over duplicate, ambiguous entity held at needs_review, private channel only — with a naive-saboteur negative control. Live route + recorded-HTTP canary remains the next rung.",
  },
  "eval-template-to-harness-run": {
    evidence: ["tests/professionalWorkflows.test.ts", "tests/evalStore.test.ts", "evals/evalStore.ts"],
    runtimeLockMode: "not_applicable",
    note: "Harness/eval-store shape is executable and regression-diffed locally.",
  },
  "eval-ui-action-execution-map": {
    evidence: ["tests/workflowEvals.test.ts", "tests/agentRuntime.test.ts", "docs/WORKFLOW_PREVIEWS.md"],
    runtimeLockMode: "not_applicable",
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
  const liveCatalogByCase = new Map(
    (readProfessionalLiveCatalog(PROFESSIONAL_LIVE_CATALOG_PATH)?.rows ?? [])
      .filter((row) => row.status === "passed")
      .map((row) => [row.caseId, row]),
  );
  const runtimeLiveProofs = liveProfessionalRuntimeProofs();
  const dynamicLiveProofs = {
    ...runtimeLiveProofs,
    ...combineLiveProofMaps(runtimeLiveProofs, LIVE_PROVIDER_PROOFS),
    ...combineLiveProofMaps(runtimeLiveProofs, liveChatIntakeProof()),
  };

  return PROFESSIONAL_WORKFLOW_CASES.map((evalCase) => {
    const readiness = professionalCaseReadiness(evalCase);
    const blockers = contractOnlyRequirements(evalCase);
    const live = dynamicLiveProofs[evalCase.id];
    const catalogProof = catalogProofsByCase.get(evalCase.id);
    const liveCatalog = liveCatalogByCase.get(evalCase.id);
    const liveCatalogEvidence = liveCatalog
      ? [PROFESSIONAL_LIVE_CATALOG_PATH, "evals/professionalLiveCatalog.ts", "tests/professionalLiveCatalog.test.ts"]
      : [];

    if (live && blockers.length === 0) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "live_provider",
        runtimeLockMode: live.runtimeLockMode,
        readiness,
        evidence: [...live.evidence, ...liveCatalogEvidence],
        blockers,
        note: live.note,
      };
    }
    if (live) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "partial_live_provider",
        runtimeLockMode: live.runtimeLockMode,
        readiness,
        evidence: [...live.evidence, ...liveCatalogEvidence, ...(catalogProof?.evidence ?? []), ...SHARED_PROFESSIONAL_EVIDENCE],
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
        runtimeLockMode: deterministic.runtimeLockMode,
        readiness,
        evidence: [...deterministic.evidence, ...liveCatalogEvidence],
        blockers,
        note: deterministic.note,
      };
    }
    if (liveCatalog && catalogProof) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "live_provider_catalog",
        runtimeLockMode: "catalog_only",
        readiness,
        evidence: [...liveCatalogEvidence, ...(catalogProof?.evidence ?? [])],
        blockers,
        note: `A real provider route (${liveCatalog.model}) produced a passing workflow plan contract for this catalog case. This proves route comprehension of intake/output/provenance/mutation/privacy requirements, not full runtime execution.`,
      };
    }
    if (catalogProof) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        proofLevel: "deterministic_catalog",
        runtimeLockMode: "catalog_only",
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
      runtimeLockMode: "not_applicable",
      readiness,
      evidence: SHARED_PROFESSIONAL_EVIDENCE,
      blockers,
      note: "Cataloged workflow; not live-proven until blockers have a behavioral runner and route proof.",
    };
  });
}

export function summarizeProfessionalProofs(rows = buildProfessionalProofLedger()) {
  const liveCatalog = readProfessionalLiveCatalog(PROFESSIONAL_LIVE_CATALOG_PATH);
  const liveCatalogPassed = liveCatalog?.rows.filter((row) => row.status === "passed").length ?? 0;
  const liveRuntime = readProfessionalRuntimeLive(PROFESSIONAL_LIVE_RUNTIME_PATH);
  const liveRuntimePassed = liveRuntime?.rows.filter((row) => row.status === "passed").length ?? 0;
  return {
    total: rows.length,
    liveProvider: rows.filter((row) => row.proofLevel === "live_provider").length,
    partialLiveProvider: rows.filter((row) => row.proofLevel === "partial_live_provider").length,
    liveProviderCatalog: rows.filter((row) => row.proofLevel === "live_provider_catalog").length,
    liveProviderCatalogPassed: liveCatalogPassed,
    liveProviderRuntimePassed: liveRuntimePassed,
    deterministicRuntime: rows.filter((row) => row.proofLevel === "deterministic_runtime").length,
    deterministicCatalog: rows.filter((row) => row.proofLevel === "deterministic_catalog").length,
    contractShape: rows.filter((row) => row.proofLevel === "contract_shape").length,
    runtimeManagedLock: rows.filter((row) => row.runtimeLockMode === "runtime_managed_lock").length,
    explicitAgentLock: rows.filter((row) => row.runtimeLockMode === "explicit_agent_lock").length,
    catalogOnlyLockMode: rows.filter((row) => row.runtimeLockMode === "catalog_only").length,
    allCatalogsProofed: rows.every((row) => row.proofLevel !== "contract_shape"),
    allLiveCatalogProven: liveCatalogPassed === rows.length && rows.length > 0,
    allLiveRuntimeExecuted: liveRuntimePassed === rows.length && rows.length > 0,
    allLiveProven: rows.every((row) => row.proofLevel === "live_provider"),
    blockedCaseIds: rows.filter((row) => row.proofLevel !== "live_provider").map((row) => row.caseId),
    runtimeBlockedCaseIds: rows.filter((row) => row.blockers.length > 0).map((row) => row.caseId),
    unproofedCaseIds: rows.filter((row) => row.proofLevel === "contract_shape").map((row) => row.caseId),
  };
}

function liveChatIntakeProof(): Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> {
  const managed = readChatIntakeLiveReport(CHAT_INTAKE_MANAGED_LIVE_PATH);
  const explicit = readChatIntakeLiveReport(CHAT_INTAKE_LIVE_PATH);
  const chosen = managed ?? explicit;
  if (!chosen) return {};
  const { path, report } = chosen;
  const runtimeLockMode = report.lockMode === "runtime_managed_lock" ? "runtime_managed_lock" : "explicit_agent_lock";
  return {
    "gtm-chat-lead-capture-enrich": {
      evidence: [
        path,
        "docs/eval/eval-runs.jsonl",
        "evals/chatIntakeRuntime.ts",
        "tests/chatIntakeRuntime.test.ts",
      ],
      runtimeLockMode,
      note:
        `Live provider runtime passed with ${report.modelName ?? "the recorded route"} using ${runtimeLockMode}: capture-first private GTM intake through real room tools, evidenced CellPayload writes, CAS duplicate prevention, ambiguous Caldera held at needs_review, one clarifying question, and no public PII leak.`,
    },
  };
}

function readChatIntakeLiveReport(path: string): { path: string; report: {
    status?: string;
    modelName?: string;
    lockMode?: RuntimeLockMode;
    score?: number;
    checks?: Record<string, boolean>;
  } } | undefined {
  if (!existsSync(path)) return undefined;
  const report = JSON.parse(readFileSync(path, "utf8")) as {
    status?: string;
    modelName?: string;
    lockMode?: RuntimeLockMode;
    score?: number;
    checks?: Record<string, boolean>;
  };
  if (report.status !== "passed" || !report.checks || !Object.values(report.checks).every(Boolean)) return undefined;
  return { path, report };
}

function liveProfessionalRuntimeProofs(): Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> {
  const aggregate = readProfessionalRuntimeLive(PROFESSIONAL_LIVE_RUNTIME_PATH);
  if (!aggregate) return {};
  const out: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> = {};
  for (const row of aggregate.rows) {
    if (row.status !== "passed" || !Object.values(row.checks).every(Boolean)) continue;
    out[row.caseId] = {
      evidence: [
        PROFESSIONAL_LIVE_RUNTIME_PATH,
        "evals/professionalRuntimeLive.ts",
        "docs/eval/eval-runs.jsonl",
      ],
      runtimeLockMode: "runtime_managed_lock",
      note:
        `Live provider runtime smoke passed with ${row.model}: real room execution through PRODUCTION_ROOM_TOOLS, managed write coordination, evidence payloads, no model-visible lock/unlock tools, no active lock leaks, and output surface ${row.surface}. Domain-specific gold checks remain governed by this case's blockers, if any.`,
    };
  }
  return out;
}

function combineLiveProofMaps(
  base: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }>,
  override: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }>,
): Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> {
  const out: Record<string, { evidence: string[]; note: string; runtimeLockMode: RuntimeLockMode }> = {};
  for (const [caseId, proof] of Object.entries(override)) {
    const baseProof = base[caseId];
    out[caseId] = baseProof
      ? {
        evidence: [...new Set([...proof.evidence, ...baseProof.evidence])],
        runtimeLockMode: baseProof.runtimeLockMode,
        note: `${proof.note} ${baseProof.note}`,
      }
      : proof;
  }
  return out;
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
