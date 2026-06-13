import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { verifySpreadsheetBenchStageProof } from "../src/eval/spreadsheetBenchStageProof";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench stage proof", () => {
  it("accepts a staged report with matching task directories and clean isolation counters", () => {
    const root = tempRoot();
    const stageRoot = join(root, "stage");
    mkdirSync(join(stageRoot, "tasks", "13-1", "agent"), { recursive: true });
    mkdirSync(join(stageRoot, "tasks", "13-1", "evaluator"), { recursive: true });
    writeFileSync(join(stageRoot, "tasks", "13-1", "agent", "manifest.json"), "{}\n");
    writeFileSync(join(stageRoot, "tasks", "13-1", "evaluator", "manifest.json"), "{}\n");
    const reportPath = join(root, "stage-report.json");
    writeJson(reportPath, {
      schema: 1,
      track: "spreadsheetbench-v1",
      scannedTaskCount: 1,
      stagedTaskCount: 1,
      agentFileCount: 1,
      evaluatorGoldFileCount: 1,
      isolation: {
        agentDirectoryGoldFileCount: 0,
        agentManifestGoldPathLeaks: 0,
        agentManifestScorerMetadataLeaks: 0,
        agentEvaluatorPathOverlap: false,
      },
      tasks: [
        {
          agentManifest: "tasks/13-1/agent/manifest.json",
          evaluatorManifest: "tasks/13-1/evaluator/manifest.json",
        },
      ],
    });

    const proof = verifySpreadsheetBenchStageProof({
      reportPath,
      stageRoot,
      track: "spreadsheetbench-v1",
      minTasks: 1,
    });

    expect(proof).toMatchObject({
      ok: true,
      stagedTaskCount: 1,
      checkedTaskDirectories: 1,
      failures: [],
    });
  });

  it("rejects under-sized or leaking stage reports", () => {
    const root = tempRoot();
    const reportPath = join(root, "stage-report.json");
    writeJson(reportPath, {
      schema: 1,
      track: "spreadsheetbench-v1",
      scannedTaskCount: 1,
      stagedTaskCount: 1,
      agentFileCount: 1,
      evaluatorGoldFileCount: 1,
      isolation: {
        agentDirectoryGoldFileCount: 1,
        agentManifestGoldPathLeaks: 0,
        agentManifestScorerMetadataLeaks: 0,
        agentEvaluatorPathOverlap: false,
      },
      tasks: [],
    });

    const proof = verifySpreadsheetBenchStageProof({
      reportPath,
      track: "spreadsheetbench-v1",
      minTasks: 400,
    });

    expect(proof.ok).toBe(false);
    expect(proof.failures).toEqual(expect.arrayContaining([
      "stagedTaskCount must be at least 400",
      "agent directory must not contain gold files",
    ]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-stage-proof-"));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
