// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import { buildHaloConvexJobContextReport, type HaloConvexJobContextInput } from "../src/eval/haloSelfImprovement";

const modules = convexModuleMap();
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const DEFAULT_JSON_OUT = "docs/eval/halo-convex-context-telemetry.json";
const TOKEN = "halo-context-token-abcdefghij0123456789";

const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
const strict = process.argv.includes("--strict");

const detail = await seedCompactedJobDetail();
if (!detail) throw new Error("expected seeded job detail");

const report = buildHaloConvexJobContextReport({
  jobs: [detailToContextInput(detail)],
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`HALO Convex context telemetry: ${report.pass ? "PASS" : "FAIL"} jobs=${report.jobs.length}`);
for (const job of report.jobs) {
  console.log(`${job.jobId}: fingerprint=${job.metricMirror.fingerprint} compactions=${job.metricMirror.compactionEvents} elided=${job.metricMirror.compactionElidedToolResults}`);
}
console.log(`wrote ${jsonOut}`);

if (strict && !report.pass) process.exit(1);

async function seedCompactedJobDetail() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const authTokenHash = await hashToken(TOKEN);
  const roomId = await t.run((ctx) => ctx.db.insert("rooms", {
    code: "HALOCTX",
    title: "HALO context telemetry",
    hostId: "",
    autoAllow: true,
    status: "live" as const,
    createdAt: now,
  }));
  const memberId = await t.run((ctx) => ctx.db.insert("members", {
    roomId,
    name: "Host",
    role: "host" as const,
    anon: false,
    color: "#111111",
    authTokenHash,
    lastSeenAt: now,
  }));
  const artifactId = await t.run((ctx) => ctx.db.insert("artifacts", {
    roomId,
    kind: "sheet" as const,
    title: "HALO context sheet",
    version: 1,
    order: ["r_rev__variance", "r_cogs__variance"],
    updatedAt: now,
  }));
  const proof = { actor: { kind: "user" as const, id: String(memberId), name: "Host" }, token: TOKEN };
  const { jobId } = await t.mutation(api.agentJobs.createOrReuse, {
    roomId,
    artifactId,
    requester: proof,
    goal: "Seed a compacted HALO context telemetry job.",
    entrypoint: "public_ask" as const,
    scope: "public_room" as const,
    modelPolicy: "test-model",
    idempotencyKey: "halo-convex-context-smoke",
    approvalPolicy: "auto_commit_safe" as const,
    evidencePolicy: "public_only" as const,
    autoAllow: true,
    traceLevel: "full_operation_ledger" as const,
  });
  const runId = await t.mutation(internal.agentRuns.record, {
    jobId,
    roomId,
    agentId: "agent_room",
    model: "test-model",
    goal: "Seed a compacted HALO context telemetry job.",
    steps: 2,
    toolCalls: 2,
    conflictsSurvived: 0,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0,
    ms: 1200,
    exhausted: false,
    stopReason: "handoff",
    handoff: { remainingToolCalls: [] },
  });
  await t.mutation(internal.agentStepJournal.record, {
    jobId,
    sliceKey: "halo-context-slice",
    step: 0,
    model: "test-model",
    inputHash: "input-a",
    outputHash: "output-a",
    result: { text: "", toolCalls: [{ id: "c1", tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false },
  });
  await t.mutation(internal.agentSteps.record, {
    jobId,
    runId,
    roomId,
    agentId: "agent_room",
    steps: [
      { idx: 0, tool: "read_range", args: "{\"elementIds\":[\"r_rev__variance\"]}", result: "[]", status: "ok" as const, ms: 10 },
      { idx: 1, tool: "write_locked_cells", args: "{\"ops\":[]}", result: "{\"ok\":true}", status: "ok" as const, ms: 20 },
    ],
  });
  await t.mutation(internal.agentJobs.finishInteractive, {
    jobId,
    runId,
    status: "paused",
    resolvedModel: "test-model",
    stopReason: "handoff",
    ms: 1200,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0,
    modelCalls: 1,
    toolCalls: 2,
    queryCount: 1,
    mutationCount: 2,
    receiptCount: 0,
    cursor: {
      compacted: true,
      elided: 4,
      remainingToolCalls: [],
      messages: [
        { role: "user", content: "Seed a compacted HALO context telemetry job." },
        { role: "assistant", content: "checkpoint" },
      ],
    },
  });
  return t.query(api.agentJobs.detail, { jobId, requester: proof });
}

function detailToContextInput(detail: any): HaloConvexJobContextInput {
  return {
    jobId: String(detail.job._id),
    runtime: detail.job.runtime,
    status: detail.job.status,
    attempts: detail.attempts.length,
    operations: detail.operations,
    modelJournalRows: detail.modelJournal.length,
    latestRun: detail.latestRun,
    latestSteps: detail.latestSteps,
    cursor: detail.job.cursor,
  };
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function convexModuleMap(): Record<string, () => Promise<unknown>> {
  const root = resolve("convex");
  const out: Record<string, () => Promise<unknown>> = {};
  for (const file of walkTs(root)) {
    const key = `../convex/${relative(root, file).replace(/\\/g, "/")}`;
    const url = pathToFileURL(file).href;
    out[key] = () => import(url);
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walkTs(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}
