export type ArchitectureBudget = {
  allowedScope: string;
  defaultAllowedAreas: string[];
  forbiddenWithoutHumanApproval: string[];
};

export type ArchitectureOwnerSurface = {
  id: string;
  description?: string;
  patterns: string[];
};

export type ArchitectureOwnershipManifest = {
  version: number;
  surfaces: ArchitectureOwnerSurface[];
};

export type ArchitectureBudgetCheckInput = {
  changedFiles: string[];
  evidenceFiles?: string[];
  humanApproved?: boolean;
  ownershipManifest?: ArchitectureOwnershipManifest;
};

export type ArchitectureBudgetCheckResult = {
  requiresHumanApproval: boolean;
  outsideEvidenceScope: string[];
  changedFilesWithoutEvidence: string[];
  invalidEvidenceFiles: string[];
  unownedFiles: string[];
  duplicateOwnedFiles: Array<{ file: string; owners: string[] }>;
  forbiddenFiles: Array<{ file: string; reason: string }>;
};

export const DEFAULT_ARCHITECTURE_BUDGET: ArchitectureBudget = {
  allowedScope: "Only files or modules named by the failing trace, failing eval, or handoff evidence.",
  defaultAllowedAreas: [
    "src/agent runtime, tools, context, and compaction",
    "Convex job/tool adapters that already participate in the failing flow",
    "eval fixtures and deterministic assertions for the affected workflow",
  ],
  forbiddenWithoutHumanApproval: [
    "new database tables",
    "new services or framework layers",
    "new UI surfaces",
    "graph/wiki/embedding expansion without a failing workflow eval",
    "weakened CAS, lock, draft, auth, privacy, or eval gates",
  ],
};

const forbiddenPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^convex\/schema\.ts$/, reason: "schema/table changes need explicit approval or a failing workflow eval" },
  { pattern: /^src\/ui\//, reason: "new or changed UI surfaces need explicit approval from the handoff evidence" },
  { pattern: /^convex\/(notebookGraph|embeddings|embeddingRunner)\.ts$/, reason: "graph/wiki/embedding expansion needs a failing workflow eval" },
  { pattern: /^docs\/qa\/production-matrix\.json$/, reason: "production guarantee changes must be backed by a recorded run" },
];

export function checkArchitectureBudget(input: ArchitectureBudgetCheckInput): ArchitectureBudgetCheckResult {
  const normalizedChanged = unique(input.changedFiles.map(normalizePath).filter(Boolean));
  const evidenceFiles = unique((input.evidenceFiles ?? []).map(normalizePath).filter(Boolean));
  const validEvidenceFiles = evidenceFiles.filter(isEvidenceFile);
  const invalidEvidenceFiles = evidenceFiles.filter((file) => normalizedChanged.includes(file) && !isEvidenceFile(file));
  const changedFilesWithoutEvidence =
    validEvidenceFiles.length === 0 ? normalizedChanged.filter((file) => !isEvidenceFile(file)) : [];
  const ownership = input.ownershipManifest ? ownershipFor(normalizedChanged, input.ownershipManifest) : new Map<string, string[]>();
  const unownedFiles = input.ownershipManifest
    ? normalizedChanged.filter((file) => (ownership.get(file) ?? []).length === 0)
    : [];
  const duplicateOwnedFiles = input.ownershipManifest
    ? normalizedChanged.flatMap((file) => {
        const owners = ownership.get(file) ?? [];
        return owners.length > 1 ? [{ file, owners }] : [];
      })
    : [];
  const forbiddenFiles = normalizedChanged.flatMap((file) =>
    forbiddenPatterns
      .filter(({ pattern }) => pattern.test(file))
      .map(({ reason }) => ({ file, reason })),
  );

  return {
    requiresHumanApproval:
      input.humanApproved !== true &&
      (
        changedFilesWithoutEvidence.length > 0 ||
        invalidEvidenceFiles.length > 0 ||
        unownedFiles.length > 0 ||
        duplicateOwnedFiles.length > 0 ||
        forbiddenFiles.length > 0
      ),
    outsideEvidenceScope: changedFilesWithoutEvidence,
    changedFilesWithoutEvidence,
    invalidEvidenceFiles,
    unownedFiles,
    duplicateOwnedFiles,
    forbiddenFiles,
  };
}

function ownershipFor(files: string[], manifest: ArchitectureOwnershipManifest): Map<string, string[]> {
  const compiled = manifest.surfaces.map((surface) => ({
    id: surface.id,
    patterns: surface.patterns.map(globToRegExp),
  }));
  const result = new Map<string, string[]>();
  for (const file of files) {
    const owners = compiled
      .filter((surface) => surface.patterns.some((pattern) => pattern.test(file)))
      .map((surface) => surface.id);
    result.set(file, owners);
  }
  return result;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function isEvidenceFile(path: string): boolean {
  return path.startsWith("tests/") || path.startsWith("evals/") || path.startsWith("docs/eval/");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  const normalized = normalizePath(glob);
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      pattern += ".*";
      index++;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}
