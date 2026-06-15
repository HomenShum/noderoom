import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";

type SloRun = {
  room: string;
  stopReason: string;
  ms: number;
  steps: number;
  toolCalls: number;
  conflictsSurvived: number;
  modelCalls: number;
  error?: string;
};

type SloReport = {
  schema: 1;
  generatedAt: string;
  gate: "slo_gate_v1";
  scenario: string;
  thresholds: {
    minRuns: number;
    completionRate: number;
    maxErrorRate: number;
    p95RunMs: number;
    maxConflictRate: number;
  };
  metrics: {
    runs: number;
    completed: number;
    completionRate: number;
    errors: number;
    errorRate: number;
    p50RunMs: number;
    p95RunMs: number;
    conflictRate: number;
    totalToolCalls: number;
    totalModelCalls: number;
  };
  passed: boolean;
  failures: string[];
  runs: SloRun[];
};

const thresholds = {
  minRuns: 8,
  completionRate: 1,
  maxErrorRate: 0,
  p95RunMs: 2_500,
  maxConflictRate: 0,
};

const writeIndex = process.argv.indexOf("--json-out");
const jsonOut = writeIndex >= 0 ? process.argv[writeIndex + 1] : undefined;

const report = await runSloGate();
console.log(JSON.stringify(report, null, 2));
if (jsonOut) {
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", jsonOut), `${JSON.stringify(report, null, 2)}\n`);
}
if (!report.passed) process.exitCode = 1;

async function runSloGate(): Promise<SloReport> {
  const runs = await Promise.all(Array.from({ length: thresholds.minRuns }, (_, index) => runRoom(index + 1)));
  const latencies = runs.map((run) => run.ms).sort((a, b) => a - b);
  const completed = runs.filter((run) => run.stopReason === "done" && !run.error).length;
  const errors = runs.filter((run) => run.error).length;
  const conflictRuns = runs.filter((run) => run.conflictsSurvived > 0).length;
  const metrics = {
    runs: runs.length,
    completed,
    completionRate: round(completed / runs.length),
    errors,
    errorRate: round(errors / runs.length),
    p50RunMs: percentile(latencies, 0.5),
    p95RunMs: percentile(latencies, 0.95),
    conflictRate: round(conflictRuns / runs.length),
    totalToolCalls: runs.reduce((sum, run) => sum + run.toolCalls, 0),
    totalModelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0),
  };
  const failures = [
    runs.length < thresholds.minRuns ? `runs ${runs.length} < ${thresholds.minRuns}` : "",
    metrics.completionRate < thresholds.completionRate ? `completionRate ${metrics.completionRate} < ${thresholds.completionRate}` : "",
    metrics.errorRate > thresholds.maxErrorRate ? `errorRate ${metrics.errorRate} > ${thresholds.maxErrorRate}` : "",
    metrics.p95RunMs > thresholds.p95RunMs ? `p95RunMs ${metrics.p95RunMs} > ${thresholds.p95RunMs}` : "",
    metrics.conflictRate > thresholds.maxConflictRate ? `conflictRate ${metrics.conflictRate} > ${thresholds.maxConflictRate}` : "",
  ].filter(Boolean);

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    gate: "slo_gate_v1",
    scenario: "8 concurrent in-memory rooms run lock/CAS/release agent work with deterministic model replay surfaces enabled",
    thresholds,
    metrics,
    passed: failures.length === 0,
    failures,
    runs,
  };
}

async function runRoom(index: number): Promise<SloRun> {
  const started = performance.now();
  try {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
    const target = index % 2 === 0 ? "r_rev__variance" : "r_ni__variance";
    const result = await runAgent({
      rt,
      goal: `SLO gate room ${index}: lock, read, update ${target}, and release.`,
      model: scriptedModel(recomputeVariancePlan({ [target]: index % 2 === 0 ? "+24.0%" : "+22.4%" }, { lock: true })),
      tools: ROOM_TOOLS,
      maxSteps: 12,
      spendLimits: { maxTokens: 10_000, maxCostUsd: 1 },
      priceStep: () => 0,
    });
    return {
      room: `slo-${index}:${demo.roomId}`,
      stopReason: result.stopReason,
      ms: Math.round(performance.now() - started),
      steps: result.steps,
      toolCalls: result.trace.length,
      conflictsSurvived: result.trace.filter((event) => event.tool === "edit_cell" && (event.result as { conflict?: boolean })?.conflict).length,
      modelCalls: result.usage.modelCalls,
    };
  } catch (error) {
    return {
      room: `room-${index}`,
      stopReason: "error",
      ms: Math.round(performance.now() - started),
      steps: 0,
      toolCalls: 0,
      conflictsSurvived: 0,
      modelCalls: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index] ?? values[values.length - 1] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
