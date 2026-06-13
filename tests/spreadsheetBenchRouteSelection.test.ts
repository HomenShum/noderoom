import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifySpreadsheetBenchTask,
  selectSpreadsheetBenchRoutes,
} from "../src/eval/spreadsheetBenchRouteSelection";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench route selection", () => {
  it("classifies chart, structural table, formula, format, and general tasks", () => {
    expect(classifySpreadsheetBenchTask({ taskId: "chart", instruction: "Create a chart and visualization" })).toMatchObject({
      route: "model_general_edit",
      requiredCapabilities: ["chart_visual_grade", "model_edit_plan"],
    });
    expect(classifySpreadsheetBenchTask({ taskId: "table", instruction: "Filter by start date, remove duplicates, then sort" })).toMatchObject({
      route: "deterministic_table_transform",
      requiredCapabilities: ["aggregate_section", "filter_rows", "sort_unique_rows"],
    });
    expect(classifySpreadsheetBenchTask({ taskId: "formula", instruction: "Use VLOOKUP and SUMIFS formulas" })).toMatchObject({
      route: "model_formula_edit",
      requiredCapabilities: ["formula_recompute_subset", "model_edit_plan"],
    });
    expect(classifySpreadsheetBenchTask({ taskId: "format", instruction: "Format the table with borders and column width" })).toMatchObject({
      route: "model_format_edit",
      requiredCapabilities: ["format_diff", "model_edit_plan"],
    });
    expect(classifySpreadsheetBenchTask({ taskId: "general", instruction: "Audit and fix the workbook thoroughly" })).toMatchObject({
      route: "model_general_edit",
      requiredCapabilities: ["model_edit_plan"],
    });
  });

  it("builds a stable report from staged agent-only manifests", () => {
    const root = tempRoot();
    const stageRoot = join(root, "stage");
    writeAgentTask(stageRoot, "b-task", {
      taskId: "b-task",
      category: "Debugging",
      instruction: "Fix formula logic errors",
    });
    writeAgentTask(stageRoot, "a-task", {
      taskId: "a-task",
      category: "Analysis",
      instruction: "Group by customer and add a total row",
    });

    const report = selectSpreadsheetBenchRoutes(stageRoot, "2026-06-13T00:00:00.000Z");

    expect(report).toMatchObject({
      schema: 1,
      generatedAt: "2026-06-13T00:00:00.000Z",
      stageRoot: "stage",
      taskCount: 2,
      routeCounts: {
        deterministic_table_transform: 1,
        model_formula_edit: 1,
        model_format_edit: 0,
        model_general_edit: 0,
        blocked_chart_visual: 0,
      },
    });
    expect(report.selections.map((selection) => selection.taskId)).toEqual(["a-task", "b-task"]);
    expect(report.selections.map((selection) => selection.agentManifest)).toEqual([
      "tasks/a-task/agent/task.json",
      "tasks/b-task/agent/task.json",
    ]);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-route-selection-"));
  roots.push(root);
  return root;
}

function writeAgentTask(stageRoot: string, taskDir: string, manifest: Record<string, unknown>) {
  const dir = join(stageRoot, "tasks", taskDir, "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.json"), `${JSON.stringify({ schema: 1, ...manifest }, null, 2)}\n`);
}
