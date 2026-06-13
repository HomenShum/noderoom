import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAlgorithmArtifactFromRoomTools, type AlgorithmArtifact } from "../src/agent/algorithmArtifacts";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { PRODUCTION_ROOM_TOOLS } from "../src/agent/tools";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import type { CellPayload } from "../src/engine/types";

const jsonOut = optionValue("--json-out") ?? "docs/eval/algorithm-artifact-smoke.json";

const artifact: AlgorithmArtifact = {
  schema: 1,
  algorithmId: "revenue_variance_pct_v1",
  name: "Revenue variance percent",
  description: "Reusable finance calculation artifact: compute Q3 vs Q2 revenue variance from source cells.",
  kind: "spreadsheet_formula",
  language: "formula_dsl",
  inputs: [
    { id: "q2", elementId: "r_rev__q2", label: "Q2 revenue" },
    { id: "q3", elementId: "r_rev__q3", label: "Q3 revenue" },
  ],
  outputs: [
    { id: "variancePct", elementId: "r_rev__variance", expression: "(q3 - q2) / q2", format: "percent" },
  ],
  constraints: {
    deterministic: true,
    noNetwork: true,
    noRandom: true,
    noDateNow: true,
    maxInputs: 4,
    maxOutputs: 2,
  },
  evidencePolicy: { requireSourceCells: true },
  tests: [
    { name: "demo revenue variance", inputs: { q2: 10000, q3: 12400 }, expected: { variancePct: 0.24 } },
  ],
};

const engine = new RoomEngine();
const demo = buildDemoRoom(engine);
const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
const startedAt = Date.now();
const run = await runAlgorithmArtifactFromRoomTools(artifact, rt);
if (!run.ok) {
  writeReport({ ok: false, errors: run.errors });
  process.exitCode = 1;
} else {
  const writeTool = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results");
  if (!writeTool) throw new Error("write_locked_cell_results tool missing");
  const write = await writeTool.execute(run.bundle.writeLockedCellResultsArgs, rt) as { ok?: boolean };
  const [cell] = await rt.readRange(["r_rev__variance"]);
  const payload = cell.value as CellPayload;
  const report = {
    schema: 1,
    ok: write.ok === true,
    generatedAt: new Date().toISOString(),
    ms: Date.now() - startedAt,
    algorithmId: artifact.algorithmId,
    artifactHash: run.bundle.artifactHash,
    commitPolicy: run.bundle.commitPolicy,
    patchCount: run.bundle.patches.length,
    writeTool: "write_locked_cell_results",
    runnerVersion: run.bundle.proof.runnerVersion,
    testsPassed: run.bundle.proof.testsPassed,
    finalCell: {
      elementId: cell.id,
      version: cell.version,
      value: payload.value,
      normalizedValue: payload.normalizedValue,
      formula: payload.formula,
      evidenceCount: payload.evidence?.length ?? 0,
    },
    proof: run.bundle.proof,
  };
  writeReport(report);
  if (!report.ok || report.finalCell.value !== "+24.0%" || report.finalCell.evidenceCount < 3) process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function writeReport(report: unknown): void {
  const out = resolve(jsonOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Algorithm artifact smoke wrote ${out}`);
}
