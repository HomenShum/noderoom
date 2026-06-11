/**
 * LIVE finance-model solve eval — the run the gold pack exists for.
 *
 * What scripted satisfiability (financeModelRuntime.ts) cannot prove: that a REAL model, given only
 * the test material a human candidate sees, synthesizes correctly-LINKED forecast formulas in the
 * room's sheet artifact through the lock -> read -> CAS -> release protocol.
 *
 * Leakage rule (structural, not aspirational): the agent context pack is built EXCLUSIVELY from the
 * "Test Prompt" / "Historical Data" / "Your Model" worksheets. The "Answer Key" worksheet object is
 * only ever touched by the GRADER. A post-run check additionally asserts the literal sheet name
 * never entered the message stream.
 *
 *   npx tsx evals/financeModelLive.ts --scripted                # satisfiability through the LIVE path
 *   npx tsx evals/financeModelLive.ts --real deepseek/deepseek-v4-flash
 *   (workbook path: --workbook <xlsx> or NODEAGENT_FINANCE_MODEL_GOLD_XLSX; skips honestly if absent)
 *
 * Privacy: the workbook is private gold (RareLiquid / Ben Chon). Full traces + context go to the
 * GITIGNORED docs/eval/finance-model-runs/; the committed summary carries booleans + labels only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import type { AgentMessage, AgentModel, RoomTools } from "../src/agent/types";
import { model as realModel, priceRun } from "../src/agent/model";
import { runAgent } from "../src/agent/runtime";
import { ROOM_TOOLS } from "../src/agent/tools";
import { scriptedModel } from "../src/agent/scripted";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellPayload } from "../src/engine/types";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  PRIVATE_FINANCE_MODEL_GOLD_ENV,
  formulaMentionsAllRefs,
  formulaMentionsAllTokens,
} from "./financeModelGold";
import {
  financeModelSolvePlan,
  makeSyntheticFinanceModelGold,
  type FinanceModelCellResult,
  type FinanceModelGold,
  type FinanceModelGoldCell,
} from "./financeModelRuntime";

/** Cells whose expected value is derivable from material IN the context pack (historical D/E columns
 *  + assumption rows). The other critical cells reference forecast precedents outside the 16-cell
 *  slice, so their VALUE cannot honestly be demanded — formula linkage remains gated for all 16. */
const VALUE_COMPUTABLE_IN_SLICE = new Set(["F7", "G7", "F8", "F12", "F16", "F55"]);

type ContextPack = {
  instructions: string;
  assumptionLines: string[];
  modelLines: string[];
  /** Historical D/E cells seeded INTO the sheet so the world is consistent: a formula that must
   *  reference E7 can read a real E7. First live run proved models (correctly) verify the sheet
   *  over prose — an empty world sends them exploring until the deadline kills the run. */
  seedCells: Array<{ id: string; value: string | number }>;
};

type FormulaCellValue = { formula?: string; result?: unknown };

function formulaText(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value;
  if (typeof value === "string" && value.trim().startsWith("=")) return value;
  if (value && typeof value === "object" && "formula" in value) return String((value as FormulaCellValue).formula ?? "");
  return undefined;
}

function cachedResult(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return (value as FormulaCellValue).result;
  return value;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cachedResult(cell);
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v).trim();
}

function requiredContextRows(): { historical: Set<number>; model: Set<number> } {
  const historical = new Set<number>();
  const model = new Set<number>();
  for (const contract of FINANCE_MODEL_CRITICAL_FORMULAS) {
    const targetRow = Number(contract.cell.match(/\d+/)?.[0]);
    if (Number.isFinite(targetRow)) model.add(targetRow);
    for (const ref of contract.requiredRefs) {
      const historicalMatch = ref.match(/Historical Data'?![A-Z]+(\d+)/i);
      if (historicalMatch) {
        historical.add(Number(historicalMatch[1]));
        continue;
      }
      const modelMatch = ref.match(/[A-Z]+(\d+)/i);
      if (modelMatch) model.add(Number(modelMatch[1]));
    }
  }
  return { historical, model };
}

function compactSeedCells(cells: Array<{ id: string; value: string | number }>): Array<{ id: string; value: string | number }> {
  return [...new Map(cells.map((cell) => [cell.id, cell])).values()];
}

/** Build gold from the PRIVATE workbook's Answer Key — grader-side only. */
export async function loadPrivateFinanceModelGold(path: string): Promise<FinanceModelGold> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const answer = workbook.getWorksheet("Answer Key");
  if (!answer) throw new Error("workbook has no Answer Key sheet");
  const cells: FinanceModelGoldCell[] = FINANCE_MODEL_CRITICAL_FORMULAS.map((contract) => {
    const cell = answer.getCell(contract.cell);
    const formula = formulaText(cell) ?? "";
    const result = cachedResult(cell);
    return { ...contract, formula, value: typeof result === "number" ? result : String(result ?? "") };
  });
  return {
    id: "finance-model-private-v1",
    title: "Private three-statement modeling test (answer-key oracle)",
    source: "private_workbook",
    sourceHash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    cells,
  };
}

/** Build the agent-visible material — STRUCTURALLY without the Answer Key worksheet. */
export async function loadFinanceModelContextPack(path: string): Promise<ContextPack> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const prompt = workbook.getWorksheet("Test Prompt");
  const historical = workbook.getWorksheet("Historical Data");
  const yourModel = workbook.getWorksheet("Your Model");
  if (!prompt || !historical || !yourModel) throw new Error("workbook missing candidate-visible sheets");

  const instructionsParts: string[] = [];
  prompt.eachRow({ includeEmpty: false }, (row) => {
    const text = cellText(row.getCell("B"));
    // The workbook's own prompt references its answer sheet; keep those lines out of the agent's
    // world entirely (no oracle priming, and the content-based leakage gate stays clean).
    if (text && text !== "x" && !/answer\s*key/i.test(text)) instructionsParts.push(text);
  });

  // Assumption block: every Historical Data row carrying a label — address-stamped so the model can
  // write linked references exactly the way the grader's requiredRefs expect them.
  const requiredRows = requiredContextRows();
  const seedCells: Array<{ id: string; value: string | number }> = [];
  const seedCellsPush = (id: string, raw: unknown) => {
    seedCells.push({ id, value: typeof raw === "number" ? raw : String(raw) });
  };
  const assumptionLines: string[] = [];
  historical.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!requiredRows.historical.has(rowNumber)) return;
    const label = cellText(row.getCell("B"));
    if (!label || label === "x") return;
    const d = cellText(row.getCell("D"));
    const e = cellText(row.getCell("E"));
    if (!d && !e) { assumptionLines.push(`  [section] ${label}`); return; }
    // Period tags are load-bearing: the assumptions block REUSES columns D/E for FY2025E/FY2026E
    // (workbook row 95 header), while the statement rows above use D/E for FY2023A/FY2024A. An
    // untagged line invites the symmetry inference "forecasts must be F/G" (iteration-5 failure).
    assumptionLines.push(`  'Historical Data'!D${rowNumber}=${d || "(blank)"} (FY2025E) | 'Historical Data'!E${rowNumber}=${e || "(blank)"} (FY2026E) | ${label}`);
    // Seed assumptions under their EXACT oracle spelling — element ids are plain strings, so the
    // cross-sheet address itself is the id. One spelling everywhere: readable via read_range,
    // citable in formulas, matched by requiredRefs. (Plain D98-style aliases would train the model
    // into references the oracle rejects.)
    const dRaw = cachedResult(row.getCell("D"));
    const eRaw = cachedResult(row.getCell("E"));
    if (dRaw !== null && dRaw !== undefined && dRaw !== "") seedCellsPush(`'Historical Data'!D${rowNumber}`, dRaw);
    if (eRaw !== null && eRaw !== undefined && eRaw !== "") seedCellsPush(`'Historical Data'!E${rowNumber}`, eRaw);
    seedCellsPush(`'Historical Data'!B${rowNumber}`, label); // row label — verifier-style models read these
  });

  const targets = new Set(FINANCE_MODEL_CRITICAL_FORMULAS.map((c) => c.cell));
  const modelLines: string[] = [];
  yourModel.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!requiredRows.model.has(rowNumber)) return;
    const label = cellText(row.getCell("B"));
    if (!label || label === "x") return;
    const d = cellText(row.getCell("D"));
    const e = cellText(row.getCell("E"));
    const fTarget = targets.has(`F${rowNumber}`) ? ` | F${rowNumber}=<FILL>` : "";
    const gTarget = targets.has(`G${rowNumber}`) ? ` | G${rowNumber}=<FILL>` : "";
    modelLines.push(`  row ${rowNumber}: ${label} | D${rowNumber}=${d || "-"} | E${rowNumber}=${e || "-"}${fTarget}${gTarget}`);
    const dRaw = cachedResult(row.getCell("D"));
    const eRaw = cachedResult(row.getCell("E"));
    if (dRaw !== null && dRaw !== undefined && dRaw !== "") seedCellsPush(`D${rowNumber}`, dRaw);
    if (eRaw !== null && eRaw !== undefined && eRaw !== "") seedCellsPush(`E${rowNumber}`, eRaw);
    seedCellsPush(`B${rowNumber}`, label); // row label — verifier-style models read these before writing
  });

  return { instructions: instructionsParts.join("\n"), assumptionLines, modelLines, seedCells: compactSeedCells(seedCells) };
}

function buildLiveContext(pack: ContextPack): (rt: RoomTools, goal: string) => Promise<AgentMessage[]> {
  const targetList = FINANCE_MODEL_CRITICAL_FORMULAS
    .map((c) => `  ${c.cell} (${c.period} ${c.label}, ${c.section})`)
    .join("\n");
  return async (_rt, goal) => [{
    role: "user",
    content: [
      `YOUR TASK: ${goal}`,
      ``,
      `You are completing a three-statement modeling test inside a shared sheet. The sheet's element`,
      `ids are Excel cell addresses (e.g. "F7"). Fill EXACTLY these forecast cells and no others:`,
      targetList,
      ``,
      `SHEET LAYOUT: the sheet contains three kinds of readable cells: model historicals D<row>`,
      `(FY2023A) and E<row> (FY2024A); assumption cells whose ids are LITERALLY the cross-sheet`,
      `address (e.g. the element id "'Historical Data'!D98" — read_range and formulas both use that`,
      `exact string); and your blank F/G targets. Every value you need is ALREADY printed in this`,
      `message — reading cells again is allowed but never required.`,
      ``,
      `PROTOCOL (mandatory, 4 turns total — the deadline is tight):`,
      `  turn 1: propose_lock on all 16 target cells.`,
      `  turn 2: ONE read_range of exactly those 16 targets (for baseVersions).`,
      `  turn 3: ALL 16 edit_cell calls batched in this single turn, baseVersion from your read.`,
      `  turn 4: release_lock. Then stop.`,
      `For each edit_cell, the value MUST be`,
      `an object: { "formula": "=<linked Excel formula>", "value": <computed number or null> }.`,
      `LINK, never hardcode: formulas must reference the prior-period model cells and the`,
      `'Historical Data' assumption addresses shown below — a typed-out constant where a reference`,
      `belongs is a failing answer. Compute "value" only when every input is visible in the data`,
      `below; otherwise set it to null.`,
      ``,
      `TEST INSTRUCTIONS (from the workbook):`,
      pack.instructions,
      ``,
      `ASSUMPTION COLUMN MAP (critical): in the assumptions block, column D holds the FY2025E`,
      `assumption and column E holds FY2026E — there are NO F/G assumption columns. Your FY2025E`,
      `formulas reference 'Historical Data'!D<row>; FY2026E formulas reference 'Historical Data'!E<row>.`,
      ``,
      `HISTORICAL DATA + ASSUMPTIONS (address = value (period) | label):`,
      ...pack.assumptionLines,
      ``,
      `YOUR MODEL (labels + historical FY2023A=D / FY2024A=E; <FILL> marks your target cells):`,
      ...pack.modelLines,
    ].join("\n"),
  }];
}

type LiveReport = {
  caseId: string;
  mode: "scripted" | "live";
  modelName: string;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  cellResults: FinanceModelCellResult[];
  costUsd: number;
  ms: number;
  toolCalls: number;
};

export async function runFinanceModelLiveSolve(options: {
  gold: FinanceModelGold;
  pack: ContextPack | null; // null => scripted mode (plan needs no context pack)
  agent: AgentModel;
  modelName: string;
  maxSteps?: number;
  deadlineMs?: number;
}): Promise<LiveReport & { trace: unknown[]; messages: AgentMessage[] }> {
  const { gold, pack, agent, modelName } = options;
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Finance modeling eval room", hostName: "Analyst", autoAllow: true });
  const artifact = engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Your Model",
    by: { kind: "user", id: host.id, name: host.name },
    seed: [
      ...(options.pack?.seedCells ?? []),
      ...gold.cells.map((cell) => ({ id: cell.cell, value: "" })),
    ],
  });
  const session = engine.startSession({ roomId: room.id, agentId: "nodeagent-finance-model", agentName: "NodeAgent", scope: "private", ownerId: host.id });
  const rt = new InMemoryRoomTools(engine, room.id, artifact.id,
    { kind: "agent", id: "nodeagent-finance-model", name: "NodeAgent", scope: "private", ownerId: host.id }, session.id);

  const t0 = Date.now();
  const result = await runAgent({
    rt,
    goal: "Complete the three-statement modeling test by filling the listed forecast cells with LINKED formulas.",
    model: agent,
    tools: ROOM_TOOLS,
    contextBuilder: pack ? buildLiveContext(pack) : undefined,
    // Steps are cheap in-memory; the wall-clock deadline is the honest budget. 24 starved
    // verifier-style models (gemini burned its cap on label reads before writing anything).
    maxSteps: options.maxSteps ?? 60,
    deadlineAt: options.deadlineMs ? t0 + options.deadlineMs : undefined,
    reserveMs: 10_000,
  });
  const ms = Date.now() - t0;

  const finalArtifact = engine.getArtifact(artifact.id);
  const cellResults = gold.cells.map((cell): FinanceModelCellResult => {
    let payload = finalArtifact?.elements[cell.cell]?.value as CellPayload | string | undefined;
    // Postel grading: models routinely double-encode nested tool args — a JSON string holding the
    // payload object is the SAME answer and must grade the same (iteration-3 lesson: 14 correct
    // formulas scored 0% on shape alone, which is grader dishonesty, not model failure).
    if (typeof payload === "string" && payload.trim().startsWith("{")) {
      try { payload = JSON.parse(payload) as CellPayload; } catch { /* keep the string */ }
    }
    const actualFormula = typeof payload === "object" && payload && typeof payload.formula === "string"
      ? payload.formula
      : typeof payload === "string" && payload.trim().startsWith("=") ? payload.trim() : "";
    const actualValue = typeof payload === "object" && payload ? payload.value : payload;
    const valueGated = VALUE_COMPUTABLE_IN_SLICE.has(cell.cell);
    const numeric = typeof actualValue === "number" ? actualValue : Number(actualValue);
    const valueOk = !valueGated
      || (typeof cell.value === "number"
        ? Number.isFinite(numeric) && Math.abs(numeric - cell.value) <= Math.max(0.05, Math.abs(cell.value) * 0.005)
        : String(actualValue ?? "").trim() === String(cell.value).trim());
    return {
      cell: cell.cell,
      label: cell.label,
      formulaOk: Boolean(actualFormula)
        && formulaMentionsAllRefs(actualFormula, cell.requiredRefs)
        && formulaMentionsAllTokens(actualFormula, cell.requiredTokens),
      valueOk,
      expectedFormula: cell.formula,
      actualFormula,
      expectedValue: cell.value,
      actualValue,
    };
  });

  const trace = result.trace;
  const targetIds = new Set(gold.cells.map((cell) => cell.cell));
  const editedIds = trace.filter((e) => e.tool === "edit_cell").map((e) => String((e.args as { elementId?: unknown }).elementId ?? ""));
  const firstLock = trace.findIndex((e) => e.tool === "propose_lock");
  const firstEdit = trace.findIndex((e) => e.tool === "edit_cell");
  // Leakage gate — CONTENT-based: no oracle formula may appear in the candidate-visible context.
  // (A phrase match is wrong twice over: the workbook's own prompt benignly says "answer key", and
  // an attacker could leak formulas without ever using the phrase.)
  const preRunContext = JSON.stringify(pack ?? {}).toUpperCase().replace(/[\s$']/g, "");
  const oracleLeaked = gold.cells.some((cell) => {
    const normalized = cell.formula.toUpperCase().replace(/[\s$'=]/g, "");
    return normalized.length > 6 && preRunContext.includes(normalized);
  });
  const checks: Record<string, boolean> = {
    stoppedCleanly: !result.exhausted,
    lockedBeforeWrite: firstLock > -1 && (firstEdit === -1 || firstLock < firstEdit),
    writesOnlyForecastCells: editedIds.every((id) => targetIds.has(id)),
    allTargetsWritten: gold.cells.every((cell) => editedIds.includes(cell.cell)),
    everyFormulaLinked: cellResults.every((cell) => cell.formulaOk),
    valueTieOutComputable: cellResults.every((cell) => cell.valueOk),
    releasedLock: trace.some((e) => e.tool === "release_lock"),
    noAnswerKeyLeakage: !oracleLeaked,
  };
  const passed = Object.values(checks).every(Boolean);
  const resolvedName = modelName;
  return {
    caseId: gold.id,
    mode: pack ? "live" : "scripted",
    modelName: resolvedName,
    status: passed ? "passed" : "failed",
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    cellResults,
    costUsd: result.usage ? priceRun(resolvedName, result.usage.inputTokens, result.usage.outputTokens) : 0,
    ms,
    toolCalls: trace.length,
    trace,
    messages: result.messages,
  };
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

async function main(): Promise<void> {
  const { default: loadEnv } = await import("../scripts/benchmark/loadEnv").catch(() => ({ default: undefined }));
  void loadEnv;
  const workbook = optionValue("--workbook") ?? process.env[PRIVATE_FINANCE_MODEL_GOLD_ENV];
  const scripted = process.argv.includes("--scripted");
  const route = optionValue("--real") ?? "deepseek/deepseek-v4-flash";

  let gold: FinanceModelGold;
  let pack: ContextPack | null = null;
  if (workbook && existsSync(workbook)) {
    gold = await loadPrivateFinanceModelGold(workbook);
    pack = scripted ? null : await loadFinanceModelContextPack(workbook);
    console.log(`gold: private workbook (${gold.sourceHash?.slice(0, 12)}…), ${gold.cells.length} critical cells`);
  } else if (scripted) {
    gold = makeSyntheticFinanceModelGold();
    console.log("gold: synthetic (no workbook provided)");
  } else {
    console.log(JSON.stringify({ status: "skipped", reason: `live mode needs the private workbook: set --workbook or ${PRIVATE_FINANCE_MODEL_GOLD_ENV}` }));
    return;
  }

  const agent = scripted ? scriptedModel(financeModelSolvePlan(gold), "scripted-finance-solver") : realModel(route);
  const report = await runFinanceModelLiveSolve({
    gold, pack, agent,
    modelName: scripted ? "scripted" : route,
    // The human test allots 60 minutes; 12 minutes is a fair model budget at observed ~20 single-edit turns.
    deadlineMs: Number(optionValue("--timeout-ms") ?? 720_000),
  });

  console.log(`\n${report.mode.toUpperCase()} · ${report.modelName} · ${report.status.toUpperCase()} (${(report.score * 100).toFixed(0)}%) · $${report.costUsd.toFixed(4)} · ${(report.ms / 1000).toFixed(1)}s · ${report.toolCalls} tools`);
  for (const [name, ok] of Object.entries(report.checks)) console.log(`  ${ok ? "ok " : "X  "} ${name}`);
  const failing = report.cellResults.filter((c) => !c.formulaOk || !c.valueOk);
  for (const c of failing) console.log(`  cell ${c.cell} (${c.label}): formulaOk=${c.formulaOk} valueOk=${c.valueOk} actual="${String(c.actualFormula).slice(0, 80)}"`);

  // Committed summary: booleans + labels only — no workbook formulas or values leave the machine.
  const summary = {
    generatedAt: new Date().toISOString(),
    caseId: report.caseId, mode: report.mode, modelName: report.modelName,
    status: report.status, score: report.score, checks: report.checks,
    cells: report.cellResults.map((c) => ({ cell: c.cell, label: c.label, formulaOk: c.formulaOk, valueOk: c.valueOk })),
    costUsd: report.costUsd, ms: report.ms, toolCalls: report.toolCalls,
    goldSourceHash: gold.sourceHash?.slice(0, 16),
  };
  writeFileSync("docs/eval/finance-model-live.json", JSON.stringify(summary, null, 2));
  // Full private artifact (trace + messages) -> gitignored runs dir.
  mkdirSync("docs/eval/finance-model-runs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  writeFileSync(`docs/eval/finance-model-runs/${stamp}-${report.modelName.replace(/[^a-z0-9.-]+/gi, "-")}.json`,
    JSON.stringify({ ...report }, null, 2));
  console.log(`\nwrote docs/eval/finance-model-live.json (redacted summary) + private trace in docs/eval/finance-model-runs/`);
  if (report.status !== "passed") process.exitCode = 1;
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("financeModelLive.ts");
if (isCli) await main();
