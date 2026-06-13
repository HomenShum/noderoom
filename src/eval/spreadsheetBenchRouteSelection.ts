import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SpreadsheetBenchRoute =
  | "deterministic_table_transform"
  | "model_formula_edit"
  | "model_format_edit"
  | "model_general_edit"
  | "blocked_chart_visual";

export type SpreadsheetBenchRouteSelection = {
  taskId: string;
  category?: string;
  route: SpreadsheetBenchRoute;
  rationale: string[];
  requiredCapabilities: string[];
  agentManifest: string;
};

export type SpreadsheetBenchRouteSelectionReport = {
  schema: 1;
  generatedAt?: string;
  stageRoot: string;
  taskCount: number;
  routeCounts: Record<SpreadsheetBenchRoute, number>;
  selections: SpreadsheetBenchRouteSelection[];
};

type AgentManifest = {
  taskId: string;
  category?: string;
  instruction?: string;
  instructionType?: string;
};

const routes: SpreadsheetBenchRoute[] = [
  "deterministic_table_transform",
  "model_formula_edit",
  "model_format_edit",
  "model_general_edit",
  "blocked_chart_visual",
];

export function selectSpreadsheetBenchRoutes(stageRoot: string, generatedAt?: string): SpreadsheetBenchRouteSelectionReport {
  const root = resolve(stageRoot);
  const tasksRoot = join(root, "tasks");
  const taskDirs = existsSync(tasksRoot)
    ? readdirSync(tasksRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  taskDirs.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const selections = taskDirs.map((entry) => {
    const manifestPath = join(tasksRoot, entry.name, "agent", "task.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AgentManifest;
    return classifySpreadsheetBenchTask(manifest, `tasks/${entry.name}/agent/task.json`);
  });
  const routeCounts = Object.fromEntries(routes.map((route) => [route, selections.filter((selection) => selection.route === route).length])) as Record<SpreadsheetBenchRoute, number>;
  return {
    schema: 1,
    generatedAt,
    stageRoot: root.split(/[\\/]/).pop() ?? stageRoot,
    taskCount: selections.length,
    routeCounts,
    selections,
  };
}

export function classifySpreadsheetBenchTask(manifest: AgentManifest, agentManifest: string = "agent/task.json"): SpreadsheetBenchRouteSelection {
  const instruction = `${manifest.instruction ?? ""} ${manifest.instructionType ?? ""}`.toLowerCase();
  const rationale: string[] = [];
  const requiredCapabilities = new Set<string>();

  if (/\b(chart|visuali[sz]ation|graph|plot)\b/.test(instruction)) {
    rationale.push("chart or visual wording routes through bounded model edit planning plus rendered/VLM chart grading");
    requiredCapabilities.add("model_edit_plan");
    requiredCapabilities.add("chart_visual_grade");
    return buildSelection(manifest, agentManifest, "model_general_edit", rationale, requiredCapabilities);
  }

  if (/\b(filter|start date|end date|sort|duplicate|deduplicate|combine data|matching duplicates|total row|group by)\b/.test(instruction)) {
    rationale.push("table-shape operation matches deterministic structural operators");
    requiredCapabilities.add("filter_rows");
    requiredCapabilities.add("sort_unique_rows");
    requiredCapabilities.add("aggregate_section");
    return buildSelection(manifest, agentManifest, "deterministic_table_transform", rationale, requiredCapabilities);
  }

  if (/\b(formula|sumif|sumifs|countif|countifs|averageif|averageifs|vlookup|xlookup|index|match|lookup|round|iferror)\b/.test(instruction)) {
    rationale.push("formula or lookup wording requires model edit planning plus deterministic formula-result caching");
    requiredCapabilities.add("model_edit_plan");
    requiredCapabilities.add("formula_recompute_subset");
    return buildSelection(manifest, agentManifest, "model_formula_edit", rationale, requiredCapabilities);
  }

  if (/\b(format|formatting|style|color|font|border|width|height|merge|merged)\b/.test(instruction)) {
    rationale.push("format/layout wording requires workbook style diff evidence");
    requiredCapabilities.add("model_edit_plan");
    requiredCapabilities.add("format_diff");
    return buildSelection(manifest, agentManifest, "model_format_edit", rationale, requiredCapabilities);
  }

  rationale.push("no deterministic structural pattern matched; use bounded model edit planning");
  requiredCapabilities.add("model_edit_plan");
  return buildSelection(manifest, agentManifest, "model_general_edit", rationale, requiredCapabilities);
}

function buildSelection(
  manifest: AgentManifest,
  agentManifest: string,
  route: SpreadsheetBenchRoute,
  rationale: string[],
  requiredCapabilities: Set<string>,
): SpreadsheetBenchRouteSelection {
  return {
    taskId: manifest.taskId,
    category: manifest.category,
    route,
    rationale,
    requiredCapabilities: [...requiredCapabilities].sort(),
    agentManifest,
  };
}
