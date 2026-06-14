import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  buildHaloSelfImprovementReport,
  metricFromAgentResult,
  type HaloSelfImprovementRunMetric,
} from "../src/eval/haloSelfImprovement";

const DEFAULT_JSON_OUT = "docs/eval/halo-self-improvement-smoke.json";
const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
const repeats = Number(optionValue("--repeats") ?? "5");
const strict = process.argv.includes("--strict");

const metrics: HaloSelfImprovementRunMetric[] = [];
for (let runIndex = 0; runIndex < repeats; runIndex++) {
  metrics.push(await runManagedWriteStability(runIndex));
  metrics.push(await runContextCompactionProbe(runIndex));
}

const report = buildHaloSelfImprovementReport({ metrics });
mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

console.log(`HALO self-improvement smoke: ${report.summary.pass ? "PASS" : "FAIL"} (${report.summary.cases} cases, ${report.summary.runs} runs)`);
for (const row of report.cases) {
  console.log(`${row.caseId}: fingerprints=${row.uniqueFingerprintCount} p95Tools=${row.p95ToolCalls} compactions=${row.totalCompactionEvents} savedChars=${row.totalCompactionCharsSaved}`);
}
console.log(`wrote ${jsonOut}`);

if (strict && !report.summary.pass) process.exit(1);

async function runManagedWriteStability(runIndex: number): Promise<HaloSelfImprovementRunMetric> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Set Revenue and COGS variance cells with runtime-managed writes.",
    model: scriptedModel(managedBatchVariancePlan(TARGETS), `scripted-managed-n${runIndex}`),
    tools: PRODUCTION_ROOM_TOOLS,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    maxSteps: 8,
  });
  assertCells(engine, demo.sheetId, TARGETS);
  return metricFromAgentResult({
    caseId: "managed-write-path-stability-n5",
    runIndex,
    modelName: "scripted-managed-lock",
    result,
  });
}

async function runContextCompactionProbe(runIndex: number): Promise<HaloSelfImprovementRunMetric> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Read the same variance context repeatedly, compact stale reads, then write the managed variance cells.",
    model: scriptedModel(repeatedReadThenManagedWritePlan(TARGETS), `scripted-context-n${runIndex}`),
    tools: PRODUCTION_ROOM_TOOLS,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    maxSteps: 12,
    compaction: { maxChars: 500, keepRecent: 4 },
  });
  assertCells(engine, demo.sheetId, TARGETS);
  return metricFromAgentResult({
    caseId: "context-compaction-quality-n5",
    runIndex,
    modelName: "scripted-context-compaction",
    result,
  });
}

function managedBatchVariancePlan(targets: Record<string, string>) {
  const ids = Object.keys(targets);
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (!ids.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
    }
    if (!toolResultExists(messages, "write_locked_cells")) {
      return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            reason: "managed variance write",
            ops: ids.map((id) => ({ elementId: id, value: targets[id], baseVersion: versions[id] })),
          },
        }],
      };
    }
    return { say: "Variance cells written through runtime-managed locking.", done: true };
  };
}

function repeatedReadThenManagedWritePlan(targets: Record<string, string>) {
  const ids = Object.keys(targets);
  const readIds = ["r_rev__q2", "r_rev__q3", "r_cogs__q2", "r_cogs__q3", ...ids];
  return ({ messages }: { messages: AgentMessage[] }) => {
    if (toolResultCount(messages, "read_range") < 6) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: readIds } }] };
    }
    const versions = lastVersions(messages);
    if (!ids.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
    }
    if (!toolResultExists(messages, "write_locked_cells")) {
      return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            reason: "managed variance write after compacted context",
            ops: ids.map((id) => ({ elementId: id, value: targets[id], baseVersion: versions[id] })),
          },
        }],
      };
    }
    return { say: "Compacted stale reads and committed the managed variance cells.", done: true };
  };
}

function toolResultExists(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === "tool" && message.toolName === toolName);
}

function toolResultCount(messages: AgentMessage[], toolName: string): number {
  return messages.filter((message) => message.role === "tool" && message.toolName === toolName).length;
}

function assertCells(engine: RoomEngine, artifactId: string, targets: Record<string, string>): void {
  const artifact = engine.getArtifact(artifactId);
  for (const [elementId, expected] of Object.entries(targets)) {
    const actual = artifact?.elements[elementId]?.value;
    if (actual !== expected) throw new Error(`${elementId} expected ${expected}, got ${String(actual)}`);
    if (engine.lockFor(artifactId, elementId)) throw new Error(`${elementId} still locked after run`);
  }
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
