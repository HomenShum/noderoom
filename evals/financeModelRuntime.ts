import type { CellPayload } from "../src/engine/types";
import type { AgentTraceEvent, AgentMessage } from "../src/agent/types";
import type { Planner } from "../src/agent/scripted";
import { scriptedModel, lastVersions } from "../src/agent/scripted";
import { runAgent } from "../src/agent/runtime";
import { ROOM_TOOLS } from "../src/agent/tools";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  formulaMentionsAllRefs,
  formulaMentionsAllTokens,
  normalizeExcelFormula,
  type FinanceModelCriticalFormula,
} from "./financeModelGold";

export type FinanceModelGoldCell = FinanceModelCriticalFormula & {
  formula: string;
  value: number | string;
};

export type FinanceModelGold = {
  id: string;
  title: string;
  source: "synthetic" | "private_workbook";
  sourceHash?: string;
  cells: FinanceModelGoldCell[];
};

export type FinanceModelCellResult = {
  cell: string;
  label: string;
  formulaOk: boolean;
  valueOk: boolean;
  expectedFormula: string;
  actualFormula: string;
  expectedValue: number | string;
  actualValue: unknown;
};

export type FinanceModelSolveReport = {
  caseId: string;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  cellResults: FinanceModelCellResult[];
  trace: AgentTraceEvent[];
  messages: AgentMessage[];
  artifactId: string;
};

const SYNTHETIC_FORMULAS: Record<string, { formula: string; value: number | string }> = {
  F7: { formula: "=E7*(1+'Historical Data'!D98)", value: 110 },
  G7: { formula: "=F7*(1+'Historical Data'!E98)", value: 121 },
  F8: { formula: "=F7*'Historical Data'!D99", value: -66 },
  F12: { formula: "=E60*'Historical Data'!D114+'Historical Data'!D115", value: -10 },
  F16: { formula: "=(E69+E74+E73)*AVERAGE('Historical Data'!D120,'Historical Data'!D121)", value: -4 },
  F19: { formula: "=F18*'Historical Data'!D102", value: -8 },
  F36: { formula: "=SUM(F25:F35)", value: 25 },
  F44: { formula: "=IF(E54+F36+F40+F43-F45<'Historical Data'!D123,MIN('Historical Data'!D122,E73),0)", value: -3 },
  F50: { formula: "=F49+F48", value: 42 },
  F54: { formula: "=F50", value: 42 },
  F55: { formula: "=F7*'Historical Data'!D105/365", value: 16 },
  F60: { formula: "=E60+F39-'Historical Data'!D114", value: 75 },
  F73: { formula: "=E73+F44", value: 0 },
  F80: { formula: "=E80+F20-'Historical Data'!D128", value: 130 },
  F85: { formula: "=F64-F83", value: 0 },
  G85: { formula: "=G64-G83", value: 0 },
};

export function makeSyntheticFinanceModelGold(): FinanceModelGold {
  return {
    id: "finance-model-synthetic-v1",
    title: "Owned synthetic three-statement model gold pack",
    source: "synthetic",
    cells: FINANCE_MODEL_CRITICAL_FORMULAS.map((contract) => ({
      ...contract,
      formula: SYNTHETIC_FORMULAS[contract.cell]?.formula ?? "",
      value: SYNTHETIC_FORMULAS[contract.cell]?.value ?? "",
    })),
  };
}

export function financeCellPayload(cell: FinanceModelGoldCell): CellPayload {
  return {
    value: cell.value,
    status: "complete",
    formula: cell.formula,
    normalizedValue: cell.value,
    confidence: 0.99,
    evidence: [
      {
        id: `computed:${cell.cell}`,
        kind: "computed",
        label: `${cell.label} linked formula`,
        source: cell.why,
        confidence: 0.99,
      },
    ],
  };
}

export function financeModelSolvePlan(gold: FinanceModelGold): Planner {
  const ids = gold.cells.map((cell) => cell.cell);

  return ({ messages }) => {
    const lockId = latestToolResult<{ ok: true; lockId: string }>(messages, "propose_lock")?.lockId;
    const versions = lastVersions(messages);
    const editedCells = new Set(
      toolCallArgs(messages, "edit_cell")
        .map((args) => String(args.elementId ?? ""))
        .filter((id) => ids.includes(id)),
    );
    const released = toolCallArgs(messages, "release_lock").some((args) => args.lockId === lockId);

    if (!lockId) {
      return {
        say: "I will lock the forecast cells, read current versions, and write linked formulas with traceable receipts.",
        toolCalls: [
          {
            tool: "propose_lock",
            args: {
              elementIds: ids,
              reason: "complete three-statement forecast cells",
            },
          },
        ],
      };
    }

    if (!ids.every((id) => versions[id] !== undefined)) {
      return {
        say: "Reading the locked forecast cells before writing formulas.",
        toolCalls: [{ tool: "read_range", args: { elementIds: ids } }],
      };
    }

    const missing = gold.cells.filter((cell) => !editedCells.has(cell.cell));
    if (missing.length) {
      return {
        say: `Writing ${missing.length} linked model formula(s) with CAS versions.`,
        toolCalls: missing.map((cell) => ({
          tool: "edit_cell",
          args: {
            elementId: cell.cell,
            baseVersion: versions[cell.cell],
            value: financeCellPayload(cell),
          },
        })),
      };
    }

    if (!released) {
      return {
        say: "All critical formula cells are complete; releasing the range for review.",
        toolCalls: [{ tool: "release_lock", args: { lockId } }],
      };
    }

    return {
      say: "Three-statement model critical cells are complete and tied out to the gold checks.",
      done: true,
    };
  };
}

export async function runFinanceModelSolveEval(gold: FinanceModelGold): Promise<FinanceModelSolveReport> {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({
    title: "Finance modeling eval room",
    hostName: "Analyst",
    autoAllow: true,
  });
  const artifact = engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Your Model",
    by: { kind: "user", id: host.id, name: host.name },
    seed: gold.cells.map((cell) => ({ id: cell.cell, value: "" })),
    meta: {
      dataframe: {
        sourceFile: gold.source === "private_workbook" ? "private-workbook.xlsx" : "synthetic-owned-gold.xlsx",
        sheetName: "Your Model",
        rowCount: gold.cells.length,
        columns: [
          { id: "cell", label: "Cell", order: 0, type: "text" },
          { id: "value", label: "Forecast Value", order: 1, type: "number", agentWritable: true },
        ],
      },
    },
  });
  const session = engine.startSession({
    roomId: room.id,
    agentId: "nodeagent-finance-model",
    agentName: "NodeAgent",
    scope: "private",
    ownerId: host.id,
  });
  const rt = new InMemoryRoomTools(
    engine,
    room.id,
    artifact.id,
    { kind: "agent", id: "nodeagent-finance-model", name: "NodeAgent", scope: "private", ownerId: host.id },
    session.id,
  );

  const result = await runAgent({
    rt,
    goal: "Complete the uploaded three-statement modeling test by filling the critical forecast formulas in Your Model.",
    model: scriptedModel(financeModelSolvePlan(gold), "nodeagent-finance-model-solver"),
    tools: ROOM_TOOLS,
    maxSteps: 8,
  });

  const finalArtifact = engine.getArtifact(artifact.id);
  const cellResults = gold.cells.map((cell): FinanceModelCellResult => {
    const payload = finalArtifact?.elements[cell.cell]?.value as CellPayload | undefined;
    const actualFormula = typeof payload?.formula === "string" ? payload.formula : "";
    const actualValue = payload?.value;
    return {
      cell: cell.cell,
      label: cell.label,
      formulaOk: formulaMentionsAllRefs(actualFormula, cell.requiredRefs)
        && formulaMentionsAllTokens(actualFormula, cell.requiredTokens)
        && normalizeExcelFormula(actualFormula) === normalizeExcelFormula(cell.formula),
      valueOk: valuesMatch(actualValue, cell.value),
      expectedFormula: cell.formula,
      actualFormula,
      expectedValue: cell.value,
      actualValue,
    };
  });

  const trace = result.trace;
  const targetIds = new Set(gold.cells.map((cell) => cell.cell));
  const readBeforeEdit = trace.every((event, index) => {
    if (event.tool !== "edit_cell") return true;
    const elementId = String((event.args as { elementId?: unknown }).elementId ?? "");
    if (!targetIds.has(elementId)) return true;
    return trace.slice(0, index).some((prior) => prior.tool === "read_range"
      && Array.isArray((prior.args as { elementIds?: unknown }).elementIds)
      && ((prior.args as { elementIds: unknown[] }).elementIds).includes(elementId));
  });
  const editedIds = trace
    .filter((event) => event.tool === "edit_cell")
    .map((event) => String((event.args as { elementId?: unknown }).elementId ?? ""));
  const checks: Record<string, boolean> = {
    stoppedCleanly: result.stopReason === "done" && !result.exhausted,
    lockedBeforeWrite: trace.findIndex((event) => event.tool === "propose_lock") > -1
      && trace.findIndex((event) => event.tool === "propose_lock") < trace.findIndex((event) => event.tool === "edit_cell"),
    readBeforeEdit,
    writesOnlyForecastCells: editedIds.length === targetIds.size && editedIds.every((id) => targetIds.has(id)),
    everyFormulaLinked: cellResults.every((cell) => cell.formulaOk),
    valueTieOut: cellResults.every((cell) => cell.valueOk),
    releasedLock: trace.some((event) => event.tool === "release_lock"),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    caseId: gold.id,
    status: passed ? "passed" : "failed",
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    cellResults,
    trace,
    messages: result.messages,
    artifactId: artifact.id,
  };
}

function toolCallArgs(messages: AgentMessage[], tool: string): Record<string, unknown>[] {
  return messages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((call) => call.tool === tool)
    .map((call) => call.args);
}

function latestToolResult<T>(messages: AgentMessage[], tool: string): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool" || message.toolName !== tool) continue;
    try {
      return JSON.parse(message.content) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function valuesMatch(actual: unknown, expected: number | string): boolean {
  if (typeof expected === "number") {
    const actualNumber = typeof actual === "number" ? actual : Number(actual);
    return Number.isFinite(actualNumber) && Math.abs(actualNumber - expected) <= Math.max(0.01, Math.abs(expected) * 0.0001);
  }
  return String(actual ?? "").trim() === expected.trim();
}
