export type BankerToolBenchOfficialContractStatus = "blocked_external_requirements" | "official_contract_ready";

export type BankerToolBenchOfficialContract = {
  schema: 1;
  generatedAt?: string;
  verifier: "bankertoolbench_official_execution_contract";
  status: BankerToolBenchOfficialContractStatus;
  pass: boolean;
  bundleProvenance: {
    required: true;
    dataset: "handshake-ai-research/bankertoolbench";
    sourceUrls: string[];
    requiredFields: string[];
    revision?: string;
    manifestLockfile?: string;
    recorded: boolean;
  };
  dockerRunPlan: {
    required: true;
    runtime: "Harbor/Docker";
    networkPolicy: "benchmark_defined_tools_only";
    mounts: {
      agentWorkspace: "read_write";
      evaluatorWorkspace: "not_mounted_until_verifier";
      providerSecrets: "env_only";
    };
    requiredEvidence: string[];
    proven: boolean;
  };
  mcpTools: {
    required: true;
    requiredToolNames: string[];
    adaptedToolNames: string[];
    complete: boolean;
  };
  gandalfScoreImport: {
    required: true;
    schemaFields: string[];
    source: "official_gandalf_verifier";
    imported: boolean;
  };
  contaminationScope: {
    required: true;
    scanner: "benchmark_contamination_v2";
    checks: string[];
    excludes: string[];
    completeForLocalArtifacts: boolean;
  };
  blockers: string[];
};

export type BankerToolBenchOfficialContractOptions = {
  generatedAt?: string;
  datasetRevision?: string;
  manifestLockfile?: string;
  adaptedToolNames?: string[];
  dockerIsolationProven?: boolean;
  gandalfImported?: boolean;
};

const requiredMcpTools = [
  "sec_filings",
  "market_data",
  "company_logo",
  "document_search",
  "web_research",
];

const gandalfSchemaFields = [
  "taskId",
  "harborTaskId",
  "verifierRunId",
  "weightedScore",
  "pass",
  "criterionResults[]",
  "deliverables[]",
  "trajectory[]",
  "costLatencyRetries",
];

export function buildBankerToolBenchOfficialContract(
  options: BankerToolBenchOfficialContractOptions = {},
): BankerToolBenchOfficialContract {
  const adaptedToolNames = [...new Set(options.adaptedToolNames ?? [])].sort();
  const missingTools = requiredMcpTools.filter((tool) => !adaptedToolNames.includes(tool));
  const provenanceRecorded = Boolean(options.datasetRevision && options.manifestLockfile);
  const dockerIsolationProven = options.dockerIsolationProven === true;
  const gandalfImported = options.gandalfImported === true;
  const blockers = [
    ...(provenanceRecorded ? [] : ["Record BankerToolBench dataset revision plus a manifest lockfile with per-file hashes."]),
    ...(dockerIsolationProven ? [] : ["Run each official task in Harbor/Docker with agent-only workspace mounts before verifier access."]),
    ...(missingTools.length === 0 ? [] : [`Adapt required MCP financial tools: ${missingTools.join(", ")}.`]),
    ...(gandalfImported ? [] : ["Import official Gandalf verifier scores instead of using the local smoke verifier."]),
  ];
  const pass = blockers.length === 0;

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    verifier: "bankertoolbench_official_execution_contract",
    status: pass ? "official_contract_ready" : "blocked_external_requirements",
    pass,
    bundleProvenance: {
      required: true,
      dataset: "handshake-ai-research/bankertoolbench",
      sourceUrls: [
        "https://github.com/Handshake-AI-Research/bankertoolbench",
        "https://huggingface.co/datasets/handshake-ai-research/bankertoolbench",
      ],
      requiredFields: ["datasetRevision", "tasksJsonlSha256", "taskDataManifestSha256", "goldenOutputsManifestSha256"],
      ...(options.datasetRevision ? { revision: options.datasetRevision } : {}),
      ...(options.manifestLockfile ? { manifestLockfile: options.manifestLockfile } : {}),
      recorded: provenanceRecorded,
    },
    dockerRunPlan: {
      required: true,
      runtime: "Harbor/Docker",
      networkPolicy: "benchmark_defined_tools_only",
      mounts: {
        agentWorkspace: "read_write",
        evaluatorWorkspace: "not_mounted_until_verifier",
        providerSecrets: "env_only",
      },
      requiredEvidence: [
        "container image or Harbor environment id",
        "no evaluator mount during candidate generation",
        "network/tool policy",
        "stdout/stderr logs",
        "exit code",
        "candidate manifest hash",
      ],
      proven: dockerIsolationProven,
    },
    mcpTools: {
      required: true,
      requiredToolNames: requiredMcpTools,
      adaptedToolNames,
      complete: missingTools.length === 0,
    },
    gandalfScoreImport: {
      required: true,
      schemaFields: gandalfSchemaFields,
      source: "official_gandalf_verifier",
      imported: gandalfImported,
    },
    contaminationScope: {
      required: true,
      scanner: "benchmark_contamination_v2",
      checks: [
        "agent task manifests",
        "agent workspace manifests",
        "candidate manifests",
        "agent output manifests",
        "model edit plans",
        "raw model output text",
        "agent-visible text/csv/md/xml sidecars",
        "agent-facing file paths",
      ],
      excludes: [
        "evaluator directories before candidate emission",
        "binary workbook/PDF/image contents until dedicated parsers are wired",
      ],
      completeForLocalArtifacts: true,
    },
    blockers,
  };
}
