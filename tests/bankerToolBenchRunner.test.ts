import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanBenchmarkContamination } from "../src/eval/benchmarkContamination";
import { runStagedBankerToolBench } from "../src/eval/bankerToolBenchRunner";
import { stageBankerToolBenchBundle } from "../src/eval/bankerToolBenchStage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench staged runner", () => {
  it("emits candidate deliverables before opening evaluator rubric and gold", () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "1b253d04-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input"), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Input", "vdr-export.xlsx"), "source workbook");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "answer.pptx"), "finished deck");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      schema: 1,
      mode: "copy-input-baseline",
      taskCount: 1,
      passCount: 0,
      passRate: 0,
      harness: {
        toolPolicy: "agent_workspace_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        verifier: "local_exact_golden_smoke",
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "emit_candidate_deliverables",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score?.totals).toMatchObject({
      rubricCriteria: 1,
      weightedTotal: 10,
      awardedWeight: 0,
      exactMatchingGoldenFiles: 0,
      missingGoldenFiles: 1,
    });
    const candidateManifest = readFileSync(join(out, "btb-1b253d04", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("rubric");
    expect(candidateManifest).not.toContain("CANARY");
    expect(existsSync(join(out, "btb-1b253d04", "agent-workspace", "agent-workspace-manifest.json"))).toBe(true);
  });

  it("scores deterministic agent output with evaluator-only weighted rubric", () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "0fc7bc3c-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Inputs"), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Inputs", "model.xlsx"), "source model");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "answer.pptx"), "finished deck");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "btb-0fc7bc3c", "agent", "output-manifest.json"), {
      schema: 1,
      deliverables: [
        { path: "answer.pptx", text: "finished deck" },
      ],
    });

    const report = runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-output",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.averageWeightedScore).toBe(1);
    expect(report.results[0].score).toMatchObject({
      pass: true,
      weightedScore: 1,
      totals: {
        rubricCriteria: 1,
        weightedTotal: 10,
        awardedWeight: 10,
        exactMatchingGoldenFiles: 1,
      },
    });
    expect(report.results[0].score?.rubricResults[0]).toMatchObject({
      criterion: "Deck has correct valuation range",
      weight: 10,
      passed: true,
    });
    const contamination = scanBenchmarkContamination(out, { generatedAt: "2026-06-13T00:00:00.000Z" });
    expect(contamination).toMatchObject({
      checkedFiles: 4,
      leakCount: 0,
    });
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-bankertoolbench-runner-${prefix}-`));
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

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
