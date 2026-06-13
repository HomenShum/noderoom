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
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 0,
      passRate: 0,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 0, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score).toBeDefined();
    expect(result.candidateWorkbook).toBeDefined();
    expect(result.score!.pass).toBe(false);
    expect(result.score!.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "value", sheet: "Sheet1", cell: "B2", expected: "2", actual: "1" }),
    ]));
    expect(existsSync(join(out, result.candidateWorkbook!))).toBe(true);
    const candidateManifest = readFileSync(join(out, "13-1", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
    const workspaceManifest = JSON.parse(readFileSync(join(out, "13-1", "agent-workspace", "agent-workspace-manifest.json"), "utf8"));
    expect(workspaceManifest.boundary).toBe("agent_visible_files_only");
    expect(workspaceManifest.copiedFiles.map((file: { role: string }) => file.role)).toEqual(expect.arrayContaining(["manifest", "input", "prompt"]));
    expect(JSON.stringify(workspaceManifest).toLowerCase()).not.toContain("gold");
    expect(JSON.stringify(workspaceManifest)).not.toContain("evaluator");
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
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 1,
      passRate: 1,
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
      "prepare_agent_workspace",
      "read_agent_edit_plan",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score).toBeDefined();
    expect(result.score!.pass).toBe(true);
    const candidateManifest = readFileSync(join(out, "13-2", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("apply-agent-patch");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
    expect(existsSync(join(out, "13-2", "agent-workspace", "agent", "edit-plan.json"))).toBe(true);
  });

  it("applies formula-looking values as formulas and preserves cells for format-only operations", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-10"), { recursive: true });
    await writeFormulaSemanticsWorkbook(join(source, "spreadsheet", "13-10", "1_13-10_init.xlsx"), false);
    await writeFormulaSemanticsWorkbook(join(source, "spreadsheet", "13-10", "1_13-10_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-10",
        instruction: "Write the formula in B2 and format C2.",
        spreadsheet_path: "spreadsheet/13-10",
        answer_position: "Sheet1!B2:C2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-10", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "B2", value: "=SUM(A2:A3)" },
        { sheet: "Sheet1", cell: "C2", numFmt: "#,##0.00" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      compareStyles: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("B2").value).toMatchObject({ formula: "SUM(A2:A3)" });
    expect(sheet.getCell("C2").value).toBe(7);
    expect(sheet.getCell("C2").numFmt).toBe("#,##0.00");
  });

  it("caches deterministic results for arithmetic and aggregate formulas before scoring", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-12"), { recursive: true });
    await writeFormulaSubsetWorkbook(join(source, "spreadsheet", "13-12", "1_13-12_init.xlsx"), false);
    await writeFormulaSubsetWorkbook(join(source, "spreadsheet", "13-12", "1_13-12_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-12",
        instruction: "Write the formula result cells using arithmetic and aggregate formulas.",
        spreadsheet_path: "spreadsheet/13-12",
        answer_position: "Sheet1!C2:F2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-12", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "C2", formula: "A2*2+B2/2" },
        { sheet: "Sheet1", cell: "D2", value: "=AVERAGE(A2:A3)" },
        { sheet: "Sheet1", cell: "E2", formula: "MAX(A2:A3)-MIN(A2:A3)" },
        { sheet: "Sheet1", cell: "F2", formula: "COUNT(A2:A3)" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 4,
      valueMatches: 4,
      formulaCells: 4,
      formulaMatches: 4,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("C2").value).toMatchObject({ formula: "A2*2+B2/2", result: 25 });
    expect(sheet.getCell("D2").value).toMatchObject({ formula: "AVERAGE(A2:A3)", result: 15 });
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "MAX(A2:A3)-MIN(A2:A3)", result: 10 });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "COUNT(A2:A3)", result: 2 });
    const candidateManifest = readFileSync(join(out, "13-12", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("deterministic_local_subset");
    expect(candidateManifest).toContain("AVERAGE");
  });

  it("caches deterministic results for conditional, rounding, and criteria formulas", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-13"), { recursive: true });
    await writeBusinessFormulaWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_init.xlsx"), false);
    await writeBusinessFormulaWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-13",
        instruction: "Write the business formulas for conditional rounding and region criteria.",
        spreadsheet_path: "spreadsheet/13-13",
        answer_position: "Sheet1!E2:K2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-13", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "E2", formula: "IF(A2>100,ROUND(ABS(B2),1),0)" },
        { sheet: "Sheet1", cell: "F2", formula: "SUMIF(C2:C4,\"North\",D2:D4)" },
        { sheet: "Sheet1", cell: "G2", formula: "COUNTIF(A2:A4,\">=80\")" },
        { sheet: "Sheet1", cell: "H2", formula: "COUNTA(C2:C4)" },
        { sheet: "Sheet1", cell: "I2", formula: "IFERROR(1/0,99)" },
        { sheet: "Sheet1", cell: "J2", formula: "ROUNDUP(B3,1)" },
        { sheet: "Sheet1", cell: "K2", formula: "ROUNDDOWN(B3,1)" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 7,
      valueMatches: 7,
      formulaCells: 7,
      formulaMatches: 7,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "IF(A2>100,ROUND(ABS(B2),1),0)", result: 12.3 });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "SUMIF(C2:C4,\"North\",D2:D4)", result: 40 });
    expect(sheet.getCell("G2").value).toMatchObject({ formula: "COUNTIF(A2:A4,\">=80\")", result: 2 });
    expect(sheet.getCell("H2").value).toMatchObject({ formula: "COUNTA(C2:C4)", result: 3 });
    expect(sheet.getCell("I2").value).toMatchObject({ formula: "IFERROR(1/0,99)", result: 99 });
    expect(sheet.getCell("J2").value).toMatchObject({ formula: "ROUNDUP(B3,1)", result: 2.8 });
    expect(sheet.getCell("K2").value).toMatchObject({ formula: "ROUNDDOWN(B3,1)", result: 2.7 });
    const candidateManifest = readFileSync(join(out, "13-13", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("SUMIF");
    expect(candidateManifest).toContain("IFERROR");
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
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 1,
      passRate: 1,
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
      "prepare_agent_workspace",
      "snapshot_agent_workbook",
      "call_model_for_edit_plan",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    const candidateManifest = readFileSync(join(out, "13-3", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("model-edit-plan");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest).toContain("rawModelOutput");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
  });

  it("shows every worksheet to the model even when the first sheet exceeds the snapshot cap", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-9"), { recursive: true });
    await writeTwoSheetStarvationWorkbook(join(source, "spreadsheet", "13-9", "1_13-9_init.xlsx"), 1);
    await writeTwoSheetStarvationWorkbook(join(source, "spreadsheet", "13-9", "1_13-9_golden.xlsx"), 2);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-9",
        instruction: "Change the target cell on LISTS to 2.",
        spreadsheet_path: "spreadsheet/13-9",
        answer_position: "LISTS!B2:B2",
        answer_sheet: "LISTS",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "sheet-aware-spreadsheetbench-planner",
      async next({ messages }) {
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          workbook?: {
            sheets?: Array<{
              name: string;
              truncated?: boolean;
              blocks?: Array<{ range: string; headerRow: number; headers: string[]; dataRowCount: number }>;
              cells?: Array<{ address: string }>;
            }>;
          };
        };
        expect(payload.workbook?.sheets?.map((sheet) => sheet.name)).toEqual(["RANGES", "LISTS"]);
        expect(payload.workbook?.sheets?.[0]?.truncated).toBe(true);
        expect(payload.workbook?.sheets?.[0]?.blocks?.[0]).toMatchObject({
          range: "A1:D160",
          headerRow: 1,
          dataRowCount: 159,
        });
        expect(payload.workbook?.sheets?.[1]?.blocks?.[0]).toMatchObject({
          range: "A1:B2",
          title: "target",
          headerRow: 2,
          dataRowCount: 0,
        });
        expect(payload.workbook?.sheets?.[1]?.cells?.map((cell) => cell.address)).toContain("B2");
        return {
          text: `Here is the edit plan:\n\`\`\`json\n${JSON.stringify({ schema: 1, operations: [{ sheet: "LISTS", cell: "B2", value: 2 }] })}\n\`\`\``,
          toolCalls: [],
          done: true,
          usage: { inputTokens: 120, outputTokens: 30 },
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

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    expect(readFileSync(join(out, "13-9", "model-output.txt"), "utf8")).toContain("Here is the edit plan");
    expect(readFileSync(join(out, "13-9", "model-edit-plan.json"), "utf8")).toContain("\"sheet\": \"LISTS\"");
  });

  it("normalizes cell refs that the model accidentally emits in the sheet field", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-11"), { recursive: true });
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_golden.xlsx"), "Actual", 2);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-11",
        instruction: "Change Actual B2 to 2.",
        spreadsheet_path: "spreadsheet/13-11",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "cell-ref-in-sheet-field-planner",
      async next() {
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [
              { sheet: "Actual", cell: "A1", value: "anchor" },
              { sheet: "B2", value: 2 },
            ],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 10 },
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

    expect(report.passCount).toBe(1);
    expect(readFileSync(join(out, "13-11", "model-output.txt"), "utf8")).toContain("\"sheet\":\"B2\"");
    expect(JSON.parse(readFileSync(join(out, "13-11", "model-edit-plan.json"), "utf8")).operations[1]).toMatchObject({
      sheet: "Actual",
      cell: "B2",
      value: 2,
    });
  });

  it("keeps attempt indices globally unique across staged tasks", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    for (const id of ["13-7", "13-8"]) {
      mkdirSync(join(source, "spreadsheet", id), { recursive: true });
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_init.xlsx`), 1);
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_golden.xlsx`), 2);
    }
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-7",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-7",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
      {
        id: "13-8",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-8",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
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

    expect(report.results.map((result) => [result.taskId, result.attemptIndex])).toEqual([
      ["13-7", 1],
      ["13-8", 2],
    ]);
    expect(report.caseRuns.map((run) => [run.taskId, run.attempts, run.finalAttemptIndex])).toEqual([
      ["13-7", [1], 1],
      ["13-8", [2], 2],
    ]);
  });

  it("counts failed model edit plans with usage, trajectory, and error evidence", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-4"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-4",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-4",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-4", "1_13-4_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-4", "1_13-4_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "bad-spreadsheetbench-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 33, outputTokens: 11 },
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
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 0,
      passRate: 0,
      averageOverall: 0,
      harness: {
        budget: { modelCalls: 1, inputTokens: 33, outputTokens: 11, providerCostUsd: 0 },
      },
    });
    expect(report.warnings[0]).toContain("edit-plan references missing sheet: Sheet1");
    const result = report.results[0];
    expect(result.score).toBeUndefined();
    expect(result.error).toMatchObject({
      phase: "candidate_generation",
      message: "edit-plan references missing sheet: Sheet1",
    });
    expect(result.model).toMatchObject({
      name: "bad-spreadsheetbench-planner",
      calls: 1,
      usage: { inputTokens: 33, outputTokens: 11 },
    });
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "snapshot_agent_workbook",
      "call_model_for_edit_plan",
    ]);
    expect(readFileSync(join(out, "13-4", "model-edit-plan.json"), "utf8").toLowerCase()).not.toContain("gold");
  });

  it("repairs generic Sheet1 aliases when the workbook has exactly one sheet", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-11"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-11",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-11",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "single-sheet-alias-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 8 },
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

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    const normalizedPlan = readFileSync(join(out, "13-11", "model-edit-plan.json"), "utf8");
    expect(normalizedPlan).toContain('"sheet": "Actual"');
    expect(normalizedPlan).not.toContain('"sheet": "Sheet1"');
  });

  it("repairs common model JSON drift before applying edit plans", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-12"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-12",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-12",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-12", "1_13-12_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-12", "1_13-12_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "json-drift-planner",
      async next() {
        return {
          text: '{"schema":1,"operations":[{"sheet":"Actual","cell":"A1","value":TOTAL},{"sheet":"A2","formula":"1+1","result":2?,"numFmt":"#\\,##0.00"},{"sheet":"B2","value":2,"formula":null,}]}',
          toolCalls: [],
          done: true,
          usage: { inputTokens: 31, outputTokens: 9 },
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

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    const normalizedPlan = readFileSync(join(out, "13-12", "model-edit-plan.json"), "utf8");
    expect(normalizedPlan).toContain('"value": "TOTAL"');
    expect(normalizedPlan).toContain('"cell": "B2"');
    expect(normalizedPlan).toContain('"result": 2');
    expect(normalizedPlan).toContain('"numFmt": "#,##0.00"');
  });

  it("retries retryable model edit failures and records case-level stop policy", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-5"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-5",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-5",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-5", "1_13-5_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-5", "1_13-5_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    let calls = 0;
    const planner: AgentModel = {
      name: "retrying-spreadsheetbench-planner",
      async next() {
        calls += 1;
        const sheet = calls === 1 ? "Sheet1" : "Actual";
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet, cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 40, outputTokens: 10 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      retryFailed: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 2,
      caseCount: 1,
      caseRunCount: 1,
      casePassCount: 1,
      casePassRate: 1,
      repeatCount: 1,
      attemptCount: 2,
      passCount: 1,
      retryPolicy: {
        maxRetries: 1,
        retryOn: ["candidate_generation", "scoring"],
        stopOnPass: true,
      },
      retryStats: {
        retriedCaseRunCount: 1,
        retryAttemptCount: 1,
        passedAfterRetryCount: 1,
        exhaustedCaseRunCount: 0,
      },
      harness: {
        budget: { modelCalls: 2, inputTokens: 80, outputTokens: 20, providerCostUsd: 0 },
      },
    });
    expect(report.caseRuns).toEqual([
      expect.objectContaining({
        taskId: "13-5",
        repeatIndex: 1,
        attempts: [1, 2],
        finalAttemptIndex: 2,
        pass: true,
        stopReason: "passed",
        bestOverall: 1,
      }),
    ]);
    expect(report.results.map((result) => [result.attemptIndex, result.repeatIndex, result.tryIndex, result.retryOfAttemptIndex])).toEqual([
      [1, 1, 1, undefined],
      [2, 1, 2, 1],
    ]);
    expect(report.results[0].error?.message).toBe("edit-plan references missing sheet: Sheet1");
    expect(report.results[1].score?.pass).toBe(true);
    expect(existsSync(join(out, "13-5", "attempt-01", "model-edit-plan.json"))).toBe(true);
    expect(existsSync(join(out, "13-5", "attempt-02", "candidate-01-1_13-5_init.xlsx"))).toBe(true);
  });

  it("accounts repeated model edit attempts with pass rate, p95, and failure counts", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-6"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-6",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-6",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-6", "1_13-6_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-6", "1_13-6_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "repeated-bad-spreadsheetbench-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 33, outputTokens: 11 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      repeats: 3,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const failureKey = "candidate_generation:edit-plan references missing sheet: Sheet1";
    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 3,
      caseCount: 1,
      repeatCount: 3,
      attemptCount: 3,
      passCount: 0,
      passRate: 0,
      averageOverall: 0,
      stats: {
        failureCounts: { [failureKey]: 3 },
      },
      harness: {
        budget: { modelCalls: 3, inputTokens: 99, outputTokens: 33, providerCostUsd: 0 },
      },
    });
    expect(report.stats.latencyMs.p50).toBeGreaterThanOrEqual(0);
    expect(report.stats.latencyMs.p95).toBeGreaterThanOrEqual(report.stats.latencyMs.p50);
    expect(report.results.map((result) => result.attemptIndex)).toEqual([1, 2, 3]);
    expect(report.results.map((result) => result.error?.message)).toEqual([
      "edit-plan references missing sheet: Sheet1",
      "edit-plan references missing sheet: Sheet1",
      "edit-plan references missing sheet: Sheet1",
    ]);
    expect(existsSync(join(out, "13-6", "attempt-01", "model-edit-plan.json"))).toBe(true);
    expect(readFileSync(join(out, "13-6", "attempt-01", "model-edit-plan.json"), "utf8").toLowerCase()).not.toContain("gold");
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
  await writeWorkbookWithSheet(path, "Sheet1", b2);
}

async function writeWorkbookWithSheet(path: string, sheetName: string, b2: number) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell("B2").value = b2;
  await workbook.xlsx.writeFile(path);
}

async function writeWorkbookWithTwoSheets(path: string, answerSheetName: string, otherSheetName: string, b2: number) {
  const workbook = new ExcelJS.Workbook();
  const answer = workbook.addWorksheet(answerSheetName);
  answer.getCell("B2").value = b2;
  const other = workbook.addWorksheet(otherSheetName);
  other.getCell("A1").value = "context";
  await workbook.xlsx.writeFile(path);
}

async function writeTwoSheetStarvationWorkbook(path: string, targetValue: number) {
  const workbook = new ExcelJS.Workbook();
  const ranges = workbook.addWorksheet("RANGES");
  for (let row = 1; row <= 160; row++) {
    for (let column = 1; column <= 4; column++) {
      ranges.getCell(row, column).value = `r${row}c${column}`;
    }
  }
  const lists = workbook.addWorksheet("LISTS");
  lists.getCell("A1").value = "target";
  lists.getCell("B2").value = targetValue;
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaSemanticsWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 1;
  sheet.getCell("A3").value = 1;
  sheet.getCell("B2").value = completed ? { formula: "SUM(A2:A3)", result: 2 } : "";
  sheet.getCell("C2").value = 7;
  if (completed) sheet.getCell("C2").numFmt = "#,##0.00";
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaSubsetWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 10;
  sheet.getCell("A3").value = 20;
  sheet.getCell("B2").value = 10;
  sheet.getCell("C2").value = completed ? { formula: "A2*2+B2/2", result: 25 } : "";
  sheet.getCell("D2").value = completed ? { formula: "AVERAGE(A2:A3)", result: 15 } : "";
  sheet.getCell("E2").value = completed ? { formula: "MAX(A2:A3)-MIN(A2:A3)", result: 10 } : "";
  sheet.getCell("F2").value = completed ? { formula: "COUNT(A2:A3)", result: 2 } : "";
  await workbook.xlsx.writeFile(path);
}

async function writeBusinessFormulaWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 120;
  sheet.getCell("A3").value = 80;
  sheet.getCell("A4").value = 55;
  sheet.getCell("B2").value = -12.345;
  sheet.getCell("B3").value = 2.718;
  sheet.getCell("C2").value = "North";
  sheet.getCell("C3").value = "South";
  sheet.getCell("C4").value = "North";
  sheet.getCell("D2").value = 10;
  sheet.getCell("D3").value = 20;
  sheet.getCell("D4").value = 30;
  sheet.getCell("E2").value = completed ? { formula: "IF(A2>100,ROUND(ABS(B2),1),0)", result: 12.3 } : "";
  sheet.getCell("F2").value = completed ? { formula: "SUMIF(C2:C4,\"North\",D2:D4)", result: 40 } : "";
  sheet.getCell("G2").value = completed ? { formula: "COUNTIF(A2:A4,\">=80\")", result: 2 } : "";
  sheet.getCell("H2").value = completed ? { formula: "COUNTA(C2:C4)", result: 3 } : "";
  sheet.getCell("I2").value = completed ? { formula: "IFERROR(1/0,99)", result: 99 } : "";
  sheet.getCell("J2").value = completed ? { formula: "ROUNDUP(B3,1)", result: 2.8 } : "";
  sheet.getCell("K2").value = completed ? { formula: "ROUNDDOWN(B3,1)", result: 2.7 } : "";
  await workbook.xlsx.writeFile(path);
}
