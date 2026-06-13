import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/agent";
import { recomputeVariancePlan } from "../src/agent/plans";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  buildHaloVariantSelectionReport,
  metricFromAgentResult,
  type HaloHarnessVariantCandidate,
  type HaloSelfImprovementRunMetric,
} from "../src/eval/haloSelfImprovement";

const DEFAULT_JSON_OUT = "docs/eval/halo-variant-selection.json";
const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
const repeats = Number(optionValue("--repeats") ?? "5");
const strict = process.argv.includes("--strict");

const explicitMetrics: HaloSelfImprovementRunMetric[] = [];
const managedMetrics: HaloSelfImprovementRunMetric[] = [];
for (let runIndex = 0; runIndex < repeats; runIndex++) {
  explicitMetrics.push(await runExplicitLockVariant(runIndex));
  managedMetrics.push(await runManagedLockVariant(runIndex));
}

const variants: HaloHarnessVariantCandidate[] = [
  {
    variantId: "explicit-agent-lock-v1",
    parentId: "explicit-agent-lock-v1",
    description: "The model calls propose_lock/edit_cell/release_lock directly.",
    policy: "Agent-visible coordination tools remain available.",
    metrics: explicitMetrics,
    safetyBoundary: "Runtime still enforces CAS/lock checks, but the model spends calls coordinating locks.",
  },
  {
    variantId: "runtime-managed-lock-v1",
    parentId: "runtime-managed-lock-v1",
    description: "The model supplies target cells, values, and base versions; runtime acquires/releases locks.",
    policy: "Model-visible coordination tools are removed from the happy path.",
    metrics: managedMetrics,
    safetyBoundary: "Runtime owns acquire/write/draft/release and every write still passes CAS.",
  },
];

const report = buildHaloVariantSelectionReport({ variants });
mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

console.log(`HALO variant selection: ${report.pass ? "PASS" : "FAIL"} selected=${report.selectedVariantId ?? "none"} parent=${report.selectedParent ?? "none"}`);
for (const variant of report.variants) {
  console.log(`${variant.variantId}: score=${variant.score} p95Tools=${variant.p95ToolCalls} p95Models=${variant.p95ModelCalls} fingerprints=${variant.uniqueFingerprintCount} selected=${variant.selected}`);
}
console.log(`wrote ${jsonOut}`);

if (strict && !report.pass) process.exit(1);

async function runExplicitLockVariant(runIndex: number): Promise<HaloSelfImprovementRunMetric> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Set Revenue and COGS variance cells.",
    model: scriptedModel(recomputeVariancePlan(TARGETS, { lock: true }), `scripted-explicit-lock-${runIndex}`),
    tools: ROOM_TOOLS,
    maxSteps: 10,
  });
  assertCells(engine, demo.sheetId, TARGETS);
  return metricFromAgentResult({
    caseId: "explicit-agent-lock-v1",
    runIndex,
    modelName: "scripted-explicit-lock",
    result,
  });
}

async function runManagedLockVariant(runIndex: number): Promise<HaloSelfImprovementRunMetric> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Set Revenue and COGS variance cells with runtime-managed writes.",
    model: scriptedModel(managedBatchVariancePlan(TARGETS), `scripted-managed-lock-${runIndex}`),
    tools: PRODUCTION_ROOM_TOOLS,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    maxSteps: 8,
  });
  assertCells(engine, demo.sheetId, TARGETS);
  return metricFromAgentResult({
    caseId: "runtime-managed-lock-v1",
    runIndex,
    modelName: "scripted-managed-lock",
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

function toolResultExists(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === "tool" && message.toolName === toolName);
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
