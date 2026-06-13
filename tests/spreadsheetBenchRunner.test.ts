import ExcelJS from "exceljs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { stageSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchStage";
import { runStagedSpreadsheetBench } from "../src/eval/spreadsheetBenchRunner";
import type { AgentModel } from "../src/agent/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench staged runner", () => {
  it("emits a candidate workbook from the agent directory before scoring with evaluator-only gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-1"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-1",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-1",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-1", "1_13-1_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-1", "1_13-1_golden.xlsx"), 2);
    writeFileSync(join(source, "spreadsheet", "13-1", "prompt.txt"), "Use only the workbook and prompt.");
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "copy-input-baseline",
      taskCount: 1,
      passCount: 0,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 0, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score.pass).toBe(false);
    expect(result.score.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "value", sheet: "Sheet1", cell: "B2", expected: "2", actual: "1" }),
    ]));
    expect(existsSync(join(out, result.candidateWorkbook))).toBe(true);
    const candidateManifest = readFileSync(join(out, "13-1", "candidate-manifest.json"), "utf8");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
  });

  it("applies an agent-side edit plan before opening evaluator-only gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-2"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-2",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-2",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-2", "1_13-2_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-2", "1_13-2_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-2", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "apply-agent-patch",
      taskCount: 1,
      passCount: 1,
      averageOverall: 1,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 0, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "read_agent_edit_plan",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score.pass).toBe(true);
    const candidateManifest = readFileSync(join(out, "13-2", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("apply-agent-patch");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
  });

  it("asks a model for an edit plan and records usage before evaluator scoring", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-3"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-3",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-3",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-3", "1_13-3_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-3", "1_13-3_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "scripted-spreadsheetbench-planner",
      async next({ messages }) {
        expect(messages[0]?.content).toContain("Change Sheet1 B2 to 2");
        expect(messages[0]?.content.toLowerCase()).not.toContain("gold");
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 80, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 1,
      passCount: 1,
      averageOverall: 1,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 1, inputTokens: 80, outputTokens: 20, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.model).toMatchObject({
      name: "scripted-spreadsheetbench-planner",
      calls: 1,
      usage: { inputTokens: 80, outputTokens: 20 },
      costUsd: 0,
    });
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "snapshot_agent_workbook",
      "call_model_for_edit_plan",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    const candidateManifest = readFileSync(join(out, "13-3", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("model-edit-plan");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-spreadsheetbench-runner-${prefix}-`));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeWorkbook(path: string, b2: number) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("B2").value = b2;
  await workbook.xlsx.writeFile(path);
}
