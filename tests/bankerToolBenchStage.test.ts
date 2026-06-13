import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { stageBankerToolBenchBundle } from "../src/eval/bankerToolBenchStage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench sandbox staging", () => {
  it("stages agent-visible files separately from rubric, canary, and golden outputs", () => {
    const source = tempRoot("source");
    const out = tempRoot("stage");
    const taskId = "1b253d04-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input "), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Input ", "vdr-export.xlsx"), "");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "golden-deck.pptx"), "");

    const report = stageBankerToolBenchBundle(source, {
      outputRoot: out,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const task = report.tasks[0];
    const agentManifest = JSON.parse(readFileSync(join(out, task.agentManifest), "utf8")) as Record<string, unknown>;
    const evaluatorManifest = JSON.parse(readFileSync(join(out, task.evaluatorManifest), "utf8")) as Record<string, unknown>;

    expect(report.stagedTaskCount).toBe(1);
    expect(report.rubricCriterionCount).toBe(1);
    expect(report.weightedRubricTotal).toBe(10);
    expect(report.isolation).toEqual({
      agentDirectoryGoldenFileCount: 0,
      agentManifestGoldenPathLeaks: 0,
      agentManifestRubricLeaks: 0,
      agentManifestCanaryLeaks: 0,
      agentEvaluatorPathOverlap: false,
    });
    expect(agentManifest).toMatchObject({
      benchmark: "bankertoolbench",
      taskId,
      harborTaskId: "btb-1b253d04",
      instruction: "Prepare an IPO valuation summary.",
      inputFiles: ["inputs/01-vdr-export.xlsx"],
    });
    expect(JSON.stringify(agentManifest).toLowerCase()).not.toContain("gold");
    expect(JSON.stringify(agentManifest).toLowerCase()).not.toContain("rubric");
    expect(JSON.stringify(agentManifest).toLowerCase()).not.toContain("canary");
    expect(evaluatorManifest).toMatchObject({
      benchmark: "bankertoolbench",
      taskId,
      canary: "CANARY-BTB-456",
      weightedRubricTotal: 10,
      goldenFiles: ["golden-outputs/01-golden-deck.pptx"],
      expectedDeliverables: [
        {
          name: "golden-deck.pptx",
          extension: ".pptx",
          goldenFile: "golden-outputs/01-golden-deck.pptx",
        },
      ],
    });
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-bankertoolbench-stage-${prefix}-`));
  roots.push(root);
  return root;
}

function writeTask(root: string, taskId: string) {
  const row = {
    task_id: taskId,
    final_prompt: "Prepare an IPO valuation summary.",
    prompt_context: "Context should be evaluator-only for official-paper parity.",
    formatting_context: "Formatting should be evaluator-only for default official mode.",
    product: "ECM",
    workflow_cat: "Valuation",
    workflow_subcat: "IPO",
    canary: "CANARY-BTB-456",
    aggregated_rubric_json: JSON.stringify([
      { criterion: "Deck has correct valuation range", weight: 10, category: "PowerPoint" },
    ]),
  };
  writeFileSync(join(root, "tasks.jsonl"), `${JSON.stringify(row)}\n`);
}
