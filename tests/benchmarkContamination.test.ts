import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanBenchmarkContamination } from "../src/eval/benchmarkContamination";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("benchmark contamination checker", () => {
  it("accepts agent-facing staged manifests and candidate metadata without evaluator leaks", () => {
    const root = tempRoot("clean");
    mkdirSync(join(root, "tasks", "13-1", "agent"), { recursive: true });
    mkdirSync(join(root, "13-1", "attempt-01"), { recursive: true });
    writeJson(join(root, "tasks", "13-1", "agent", "task.json"), {
      schema: 1,
      taskId: "13-1",
      track: "spreadsheetbench-v1",
      instruction: "Complete the visible workbook task.",
      inputFiles: ["inputs/01-init.xlsx"],
      promptFiles: ["prompts/01-prompt.txt"],
    });
    writeJson(join(root, "13-1", "attempt-01", "candidate-manifest.json"), {
      schema: 1,
      taskId: "13-1",
      mode: "model-edit-plan",
      sourceAgentManifest: "tasks/13-1/agent/task.json",
      generatedEditPlan: "model-edit-plan.json",
      candidateWorkbook: "candidate-01-init.xlsx",
    });
    writeJson(join(root, "13-1", "attempt-01", "model-edit-plan.json"), {
      schema: 1,
      operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }],
    });

    const report = scanBenchmarkContamination(root, { generatedAt: "2026-06-13T00:00:00.000Z" });

    expect(report).toMatchObject({
      schema: 1,
      root: expect.stringContaining("clean"),
      checkedFiles: 3,
      leakCount: 0,
      leaks: [],
    });
  });

  it("flags evaluator-only keys and paths in agent-facing metadata", () => {
    const root = tempRoot("leaky");
    mkdirSync(join(root, "tasks", "13-1", "agent"), { recursive: true });
    mkdirSync(join(root, "13-1"), { recursive: true });
    writeJson(join(root, "tasks", "13-1", "agent", "task.json"), {
      schema: 1,
      taskId: "13-1",
      instruction: "Do not leak metadata.",
      inputFiles: ["../evaluator/gold/01-golden.xlsx"],
      answerPosition: "Sheet1!B2",
    });
    writeJson(join(root, "13-1", "candidate-manifest.json"), {
      schema: 1,
      taskId: "13-1",
      evaluatorManifest: "tasks/13-1/evaluator/evaluator.json",
      rubricItems: [],
      canary: "CANARY-BTB-456",
    });

    const report = scanBenchmarkContamination(root);

    expect(report.leakCount).toBeGreaterThanOrEqual(5);
    expect(report.leaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "forbidden_key", file: "13-1/candidate-manifest.json", location: "$.evaluatorManifest" }),
      expect.objectContaining({ kind: "forbidden_key", file: "13-1/candidate-manifest.json", location: "$.rubricItems" }),
      expect.objectContaining({ kind: "forbidden_key", file: "13-1/candidate-manifest.json", location: "$.canary" }),
      expect.objectContaining({ kind: "forbidden_key", file: "tasks/13-1/agent/task.json", location: "$.answerPosition" }),
      expect.objectContaining({ kind: "forbidden_path_or_metadata_value", file: "tasks/13-1/agent/task.json", location: "$.inputFiles[0]" }),
    ]));
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-benchmark-contamination-${prefix}-`));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
