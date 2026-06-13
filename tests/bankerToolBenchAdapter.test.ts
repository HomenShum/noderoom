import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanBankerToolBenchBundle } from "../src/eval/bankerToolBenchAdapter";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench official bundle ingest", () => {
  it("ingests task jsonl, input files, and weighted rubric without exposing evaluator-only metadata to the agent", () => {
    const root = tempRoot();
    const taskId = "0fc7bc3c-a111-4222-8333-444455556666";
    writeTask(root, taskId);
    mkdirSync(join(root, "task-data", taskId, "Inputs"), { recursive: true });
    writeFileSync(join(root, "task-data", taskId, "Inputs", "model.xlsx"), "");
    writeFileSync(join(root, "task-data", taskId, "Inputs", "source.pdf"), "");
    mkdirSync(join(root, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(root, "golden-outputs", taskId, "answer.xlsx"), "");

    const report = scanBankerToolBenchBundle(root, {
      includeTasks: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.taskCount).toBe(1);
    expect(report.inputFileCount).toBe(2);
    expect(report.evaluatorGoldenFileCount).toBe(1);
    expect(report.rubricCriterionCount).toBe(2);
    expect(report.weightedRubricTotal).toBe(6);
    expect(report.productCounts).toEqual({ "M&A": 1 });
    expect(report.goldIsolation).toEqual({
      agentTaskGoldenPathLeaks: 0,
      agentTasksExposeGoldenOutputs: false,
      agentTaskRubricLeaks: 0,
      agentTasksExposeRubricMetadata: false,
      agentTaskCanaryLeaks: 0,
      agentTasksExposeCanary: false,
    });
    expect(report.tasks?.[0]?.agentTask).toMatchObject({
      id: taskId,
      harborTaskId: "btb-0fc7bc3c",
      instruction: "Build a buyer screen and short memo.",
      inputFiles: [
        `task-data/${taskId}/Inputs/model.xlsx`,
        `task-data/${taskId}/Inputs/source.pdf`,
      ],
      hasPromptContext: true,
      hasFormattingContext: true,
    });
    expect(report.tasks?.[0]?.evaluatorMetadata.rubricItems).toEqual([
      { criterion: "Uses revenue multiple correctly", weight: 5, category: "Excel" },
      { criterion: "Memo includes risks", weight: 1, category: "Memo" },
    ]);
    expect(JSON.stringify(report.sampleAgentTasks).toLowerCase()).not.toContain("golden");
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("rubric");
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("CANARY");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-bankertoolbench-"));
  roots.push(root);
  return root;
}

function writeTask(root: string, taskId: string) {
  const row = {
    task_id: taskId,
    final_prompt: "Build a buyer screen and short memo.",
    prompt_context: "Use only the provided data room files.",
    formatting_context: "Return an Excel workbook and memo.",
    product: "M&A",
    workflow_cat: "Buyer Screen",
    workflow_subcat: "Public comps",
    canary: "CANARY-BTB-123",
    aggregated_rubric_json: JSON.stringify([
      { criterion: "Uses revenue multiple correctly", weight: 5, category: "Excel" },
      { criterion: "Memo includes risks", weight: 1, category: "Memo" },
    ]),
  };
  writeFileSync(join(root, "tasks.jsonl"), `${JSON.stringify(row)}\n`);
}
