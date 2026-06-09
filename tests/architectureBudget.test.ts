import { describe, expect, it } from "vitest";
import { checkArchitectureBudget, type ArchitectureOwnershipManifest } from "../src/eval/architectureBudget";

const manifest: ArchitectureOwnershipManifest = {
  version: 1,
  surfaces: [
    { id: "agent-runtime", patterns: ["src/agent/**"] },
    { id: "nodeagent-jobs", patterns: ["convex/agentJobs.ts"] },
    { id: "graph-wiki-embedding-experimental", patterns: ["convex/schema.ts", "convex/notebookGraph.ts"] },
    { id: "qa-improvement-loop", patterns: ["tests/**", "docs/eval/**"] },
  ],
};

describe("architecture budget", () => {
  it("allows owned changes backed by behavior evidence", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["src/agent/tools.ts", "tests/workflowEvals.test.ts"],
      evidenceFiles: ["tests/workflowEvals.test.ts"],
      ownershipManifest: manifest,
    });

    expect(result.changedFilesWithoutEvidence).toEqual([]);
    expect(result.unownedFiles).toEqual([]);
    expect(result.requiresHumanApproval).toBe(false);
  });

  it("flags schema changes without behavior evidence", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["convex/schema.ts"],
      ownershipManifest: manifest,
    });

    expect(result.requiresHumanApproval).toBe(true);
    expect(result.changedFilesWithoutEvidence).toEqual(["convex/schema.ts"]);
    expect(result.forbiddenFiles[0]?.reason).toContain("schema");
  });

  it("does not allow the changed source file to count as its own evidence", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["convex/schema.ts"],
      evidenceFiles: ["convex/schema.ts"],
      ownershipManifest: manifest,
    });

    expect(result.requiresHumanApproval).toBe(true);
    expect(result.invalidEvidenceFiles).toEqual(["convex/schema.ts"]);
    expect(result.changedFilesWithoutEvidence).toEqual(["convex/schema.ts"]);
  });

  it("flags files that are not mapped to one owner surface", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["convex/newTool.ts"],
      evidenceFiles: ["tests/newTool.test.ts"],
      ownershipManifest: manifest,
    });

    expect(result.unownedFiles).toEqual(["convex/newTool.ts"]);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it("flags duplicate owner mappings", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["convex/agentJobs.ts"],
      evidenceFiles: ["tests/agentJobsRuntime.test.ts"],
      ownershipManifest: {
        version: 1,
        surfaces: [
          { id: "nodeagent-jobs", patterns: ["convex/agentJobs.ts"] },
          { id: "qa-improvement-loop", patterns: ["convex/*.ts", "tests/**"] },
        ],
      },
    });

    expect(result.duplicateOwnedFiles).toEqual([{ file: "convex/agentJobs.ts", owners: ["nodeagent-jobs", "qa-improvement-loop"] }]);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it("lets explicit human approval pass while still reporting forbidden files", () => {
    const result = checkArchitectureBudget({
      changedFiles: ["convex/schema.ts"],
      evidenceFiles: ["tests/schemaRuntime.test.ts"],
      humanApproved: true,
      ownershipManifest: manifest,
    });

    expect(result.requiresHumanApproval).toBe(false);
    expect(result.forbiddenFiles).toHaveLength(1);
  });
});
