/**
 * Multi-model benchmark — runs the company-research harness across models with a
 * REAL source fetch, scores DETERMINISTIC boolean checks (no arbitrary scalars),
 * captures real $/latency/tokens → docs/eval/results.json (the chart's data source).
 *
 *   npx tsx scripts/benchmark/run.ts                       # default cheap/free set
 *   npx tsx scripts/benchmark/run.ts gemini-2.5-flash-lite # a subset
 *
 * Keys are read from .env.local (ANTHROPIC_API_KEY · GOOGLE_GENERATIVE_AI_API_KEY · OPENAI_API_KEY).
 */
import "./loadEnv"; // MUST be first — loads .env.local before any @ai-sdk/* module captures env
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomEngine } from "../../src/engine/roomEngine";
import { buildDemoRoom, RESEARCH_COMPANIES } from "../../src/engine/demoRoom";
import { InMemoryRoomTools } from "../../src/agent/roomTools";
import { ROOM_TOOLS } from "../../src/agent/tools";
import { runAgent } from "../../src/agent/runtime";
import { model, priceRun, judge } from "../../src/agent/model";
import { buildResearchContext } from "../../src/agent/context";
import { fetchSourceReal } from "../../src/agent/fetchSource";
import type { AgentModel } from "../../src/agent/types";
import { selectOpenRouterFreeModels } from "../../src/agent/openRouterFreeModels";

const BENCHMARK_VERSION = "company-research-v2-9checks-router";
const CHECKS = [
  "ALL_COMPLETE",
  "EVERY_ROW_SOURCED",
  "EVERY_ROW_MULTI_SOURCE",
  "SOURCES_FETCHED",
  "STRUCTURED_FIELDS",
  "FRESHNESS_WRITTEN",
  "COMPLETED_IN_BUDGET",
  "NO_FABRICATION",
  "RIGHT_ENTITY",
];

// Fixed cheap judge (isolated yes/no per the grounded-eval rule — low variance, not a holistic grade).
const JUDGE = process.env.JUDGE_MODEL || "gemini-3.1-flash-lite";
async function judgeCompany(company: string, summary: string, evidence: string): Promise<{ grounded: boolean; rightEntity: boolean }> {
  if (!summary) return { grounded: false, rightEntity: false };
  // Calibrated per grounded_eval: flag ONLY fabricated SPECIFICS (invented numbers/dates/names).
  // Synthesis + directional descriptions ("an AI safety company") are the product, NOT hallucination.
  const prompt = `You are a diligence fact-checker. Flag fabrication ONLY when the summary states a specific
fact — a number, date, funding amount, headcount, or a named person/product — that is NOT present in the
evidence. General/directional/synthesis descriptions are fine and are NOT fabrication.
Company: "${company}"
Summary: "${summary}"
Evidence (fetched from real sources):
${evidence.slice(0, 3500) || "(none)"}

JSON only, no prose:
{"grounded": <false ONLY if the summary asserts a specific fact absent from the evidence; true otherwise>, "rightEntity": <true if the summary describes "${company}", not a different same-name company>}`;
  try {
    const t = await judge(JUDGE, prompt);
    const j = JSON.parse(t.match(/\{[\s\S]*\}/)![0]);
    return { grounded: !!j.grounded, rightEntity: !!j.rightEntity };
  } catch { return { grounded: false, rightEntity: false }; }
}

// Latest models across the cost spectrum (probe-verified 2026-06-06).
const DEFAULT_MODELS = [
  "openrouter/free-auto",
  "gpt-5.4-nano", "gemini-3.1-flash-lite", "gpt-5.4-mini", "gemini-3.5-flash", // cheap → mid (latest)
  "claude-haiku-4-5", "claude-sonnet-4-6", "gpt-5.5", // anchor → flagship (latest)
];
const MODELS = DEFAULT_MODELS;
const COMPANIES = RESEARCH_COMPANIES.slice(0, 3); // bound the spend

const GOAL =
  "Research every company whose status is pending. For each: propose_lock its cells, set status to running, " +
  "fetch_source the company homepage plus a corroborating source when available, write summary/funding/headcount/recent_signal, " +
  "write citation URLs into __source and __source2, set last_researched to today's ISO date, " +
  "set status to complete, then release the lock. Cite only sources you actually fetched.";

interface Row {
  benchmarkVersion: string; model: string; requestedModel: string; resolvedModel: string; resolvedModels: string[];
  ok: boolean; checks: Record<string, boolean>; passed: number; total: number;
  inputTokens: number; outputTokens: number; costUsd: number; ms: number; steps: number; toolCalls: number; error?: string;
}

interface RunModelOptions {
  timeoutMs?: number;
  reserveMs?: number;
  hardTimeoutMs?: number;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function optionNumber(name: string, envName: string): number | undefined {
  const raw = optionValue(name) ?? process.env[envName];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function explicitModels(): string[] | undefined {
  const firstPositional = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  return firstPositional?.split(",").map((m) => m.trim()).filter(Boolean);
}

async function benchmarkModels(): Promise<string[]> {
  let routes = explicitModels() ?? DEFAULT_MODELS;
  const freeAutoTop = optionNumber("--free-auto-top", "BENCHMARK_FREE_AUTO_TOP") ?? 0;
  if (freeAutoTop > 0) {
    const candidates = await selectOpenRouterFreeModels({
      mode: "agent",
      limit: freeAutoTop,
      forceRefresh: process.argv.includes("--free-auto-refresh"),
    });
    routes = [...routes, "openrouter/free-auto", ...candidates.map((m) => m.id)];
  }
  return unique(routes);
}

function timeoutRow(modelId: string, started: number, error: string): Row {
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    model: modelId,
    requestedModel: modelId,
    resolvedModel: modelId,
    resolvedModels: [],
    ok: false,
    checks: {},
    passed: 0,
    total: CHECKS.length,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: Date.now() - started,
    steps: 0,
    toolCalls: 0,
    error,
  };
}

function runModelInChild(modelId: string, options: RunModelOptions): Row {
  const started = Date.now();
  const args = [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), fileURLToPath(import.meta.url), modelId, "--one-model"];
  if (options.timeoutMs) args.push(`--model-timeout-ms=${options.timeoutMs}`);
  if (options.reserveMs) args.push(`--model-reserve-ms=${options.reserveMs}`);
  const child = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: options.hardTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error?.message?.toLowerCase().includes("timed out")) {
    return timeoutRow(modelId, started, `row hard timeout after ${options.hardTimeoutMs}ms`);
  }
  const text = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const match = text.match(/__BENCHMARK_ROW_START__([\s\S]*?)__BENCHMARK_ROW_END__/);
  if (!match) {
    const tail = text.replace(/\s+/g, " ").trim().slice(-300);
    const status = child.status === null ? "null" : String(child.status);
    const signal = child.signal ? ` signal=${child.signal}` : "";
    const childError = child.error?.message ? ` error=${child.error.message}` : "";
    return timeoutRow(modelId, started, `child row missing result status=${status}${signal}${childError}${tail ? `: ${tail}` : ""}`);
  }
  try {
    return JSON.parse(match[1]) as Row;
  } catch (e) {
    return timeoutRow(modelId, started, e instanceof Error ? `child row parse failed: ${e.message}` : "child row parse failed");
  }
}

function recordingModel(modelId: string): { agentModel: AgentModel; resolvedModels: string[] } {
  const baseModel = model(modelId);
  const resolvedModels: string[] = [];
  return {
    resolvedModels,
    agentModel: {
      get name() {
        return baseModel.name;
      },
      async next(input) {
        const step = await baseModel.next(input);
        resolvedModels.push(baseModel.name);
        return step;
      },
    },
  };
}

function cellScalar(value: unknown): unknown {
  return value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
}

function cellText(artifact: { elements: Record<string, { value: unknown }> }, elementId: string): string {
  return String(cellScalar(artifact.elements[elementId]?.value) ?? "");
}

function extractUrl(value: string): string {
  return value.match(/https?:\/\/[^\s)]+/i)?.[0] ?? "";
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

async function runModel(modelId: string, options: RunModelOptions = {}): Promise<Row> {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.researchId, d.agents.room, d.sessions.room);
  rt.fetchSource = fetchSourceReal; // real sourcing (the browser stub is for no-keys demos)
  const t0 = Date.now();
  const route = recordingModel(modelId);
  const resolved = () => route.resolvedModels.at(-1) ?? route.agentModel.name;
  const fail = (error: string): Row => ({
    benchmarkVersion: BENCHMARK_VERSION,
    model: modelId,
    requestedModel: modelId,
    resolvedModel: resolved(),
    resolvedModels: unique(route.resolvedModels),
    ok: false,
    checks: {},
    passed: 0,
    total: CHECKS.length,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: Date.now() - t0,
    steps: 0,
    toolCalls: 0,
    error,
  });
  try {
    const r = await runAgent({
      rt,
      goal: GOAL,
      model: route.agentModel,
      tools: ROOM_TOOLS,
      contextBuilder: buildResearchContext,
      maxSteps: 60,
      deadlineAt: options.timeoutMs ? t0 + options.timeoutMs : undefined,
      reserveMs: options.reserveMs,
    });
    const ms = Date.now() - t0;
    const art = engine.getArtifact(d.researchId)!;
    const ids = COMPANIES.map((c) => c.id);
    const fetchedResults = r.trace.filter((t) => t.tool === "fetch_source" && (t.result as { ok?: boolean })?.ok).map((t) => t.result as { title?: string; snippet?: string; url?: string });
    const fetchedUrls = new Set(fetchedResults.map((x) => normalizeUrl(String(x.url ?? ""))).filter(Boolean));
    const rowSourceUrls = (id: string) => [
      extractUrl(cellText(art, `${id}__source`)),
      extractUrl(cellText(art, `${id}__source2`)),
    ].map(normalizeUrl).filter(Boolean);
    const checks: Record<string, boolean> = {
      ALL_COMPLETE: ids.every((id) => cellText(art, `${id}__status`) === "complete"),
      EVERY_ROW_SOURCED: ids.every((id) => rowSourceUrls(id).length >= 1),
      EVERY_ROW_MULTI_SOURCE: ids.every((id) => new Set(rowSourceUrls(id)).size >= 2),
      SOURCES_FETCHED: ids.every((id) => {
        const urls = rowSourceUrls(id);
        return urls.length >= 1 && urls.every((url) => fetchedUrls.has(url));
      }),
      STRUCTURED_FIELDS: ids.every((id) => ["summary", "funding", "headcount", "recent_signal"].every((c) => cellText(art, `${id}__${c}`).length > 0)),
      FRESHNESS_WRITTEN: ids.every((id) => /^\d{4}-\d{2}-\d{2}/.test(cellText(art, `${id}__last_researched`))),
      COMPLETED_IN_BUDGET: !r.exhausted,
    };
    // LLM-judge content checks — these DIFFERENTIATE models (a cheap one may fabricate or pad).
    let grounded = true, rightEntity = true;
    for (const c of COMPANIES) {
      const rowUrls = new Set(rowSourceUrls(c.id));
      const evidence = fetchedResults
        .filter((x) => rowUrls.has(normalizeUrl(String(x.url ?? ""))))
        .map((x) => `${x.title}: ${x.snippet}`)
        .join("\n");
      const v = await judgeCompany(c.company, cellText(art, `${c.id}__summary`), evidence);
      if (!v.grounded) grounded = false;
      if (!v.rightEntity) rightEntity = false;
    }
    checks.NO_FABRICATION = grounded;
    checks.RIGHT_ENTITY = rightEntity;
    const passed = Object.values(checks).filter(Boolean).length;
    const resolvedModel = resolved();
    return {
      benchmarkVersion: BENCHMARK_VERSION,
      model: modelId,
      requestedModel: modelId,
      resolvedModel,
      resolvedModels: unique(route.resolvedModels),
      ok: passed === Object.keys(checks).length,
      checks,
      passed,
      total: Object.keys(checks).length,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: priceRun(resolvedModel, r.usage.inputTokens, r.usage.outputTokens),
      ms,
      steps: r.steps,
      toolCalls: r.trace.length,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}

async function main() {
  console.log(`benchmark · company-research · ${COMPANIES.length} companies · models: ${MODELS.join(", ")}`);
  const rows: Row[] = [];
  for (const m of MODELS) {
    process.stdout.write(`  ${m.padEnd(24)} `);
    const row = await runModel(m);
    console.log(row.error ? `ERROR: ${row.error}` : `${row.passed}/${row.total} checks · $${row.costUsd.toFixed(4)} · ${(row.ms / 1000).toFixed(1)}s · ${row.toolCalls} tools`);
    rows.push(row);
  }
  mkdirSync(new URL("../../docs/eval/", import.meta.url), { recursive: true });
  const resultsUrl = new URL("../../docs/eval/results.json", import.meta.url);
  // Merge with prior runs so models can be benchmarked in batches (under the timeout).
  let prior: Row[] = [];
  try { prior = (JSON.parse(readFileSync(resultsUrl, "utf8")).models ?? []) as Row[]; } catch { /* first run */ }
  const merged = [...prior.filter((p) => !rows.some((r) => r.model === p.model)), ...rows];
    const out = { generatedAt: new Date().toISOString(), task: "company-research", companies: COMPANIES.length, judge: JUDGE, checks: ["ALL_COMPLETE", "EVERY_ROW_SOURCED", "EVERY_ROW_MULTI_SOURCE", "SOURCES_FETCHED", "STRUCTURED_FIELDS", "FRESHNESS_WRITTEN", "COMPLETED_IN_BUDGET", "NO_FABRICATION", "RIGHT_ENTITY"], models: merged };
  writeFileSync(resultsUrl, JSON.stringify(out, null, 2));
  console.log(`\nwrote docs/eval/results.json (${merged.length} models total)`);
}
async function runBenchmark() {
  const models = await benchmarkModels();
  const timeoutMs = optionNumber("--model-timeout-ms", "BENCHMARK_MODEL_TIMEOUT_MS");
  const reserveMs = optionNumber("--model-reserve-ms", "BENCHMARK_MODEL_RESERVE_MS");
  const hardTimeoutMs = optionNumber("--row-hard-timeout-ms", "BENCHMARK_ROW_HARD_TIMEOUT_MS") ?? (timeoutMs ? timeoutMs + 60_000 : undefined);
  console.log(`benchmark Â· company-research Â· ${COMPANIES.length} companies Â· models: ${models.join(", ")}`);
  const rows: Row[] = [];
  for (const m of models) {
    process.stdout.write(`  ${m.padEnd(24)} `);
    const row = hardTimeoutMs
      ? runModelInChild(m, { timeoutMs, reserveMs, hardTimeoutMs })
      : await runModel(m, { timeoutMs, reserveMs });
    const resolved = row.resolvedModel !== row.requestedModel ? ` Â· resolved=${row.resolvedModel}` : "";
    console.log(row.error ? `ERROR: ${row.error}${resolved}` : `${row.passed}/${row.total} checks Â· $${row.costUsd.toFixed(4)} Â· ${(row.ms / 1000).toFixed(1)}s Â· ${row.toolCalls} tools${resolved}`);
    rows.push(row);
  }
  mkdirSync(new URL("../../docs/eval/", import.meta.url), { recursive: true });
  const resultsUrl = new URL("../../docs/eval/results.json", import.meta.url);
  let prior: Row[] = [];
  if (!process.argv.includes("--no-merge")) {
    try {
      const priorDoc = JSON.parse(readFileSync(resultsUrl, "utf8"));
      const sameContract = priorDoc.benchmarkVersion === BENCHMARK_VERSION && JSON.stringify(priorDoc.checks ?? []) === JSON.stringify(CHECKS);
      if (sameContract) prior = (priorDoc.models ?? []) as Row[];
    } catch { /* first run */ }
  }
  const merged = [...prior.filter((p) => !rows.some((r) => r.model === p.model)), ...rows];
  const out = {
    benchmarkVersion: BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    task: "company-research",
    companies: COMPANIES.length,
    judge: JUDGE,
    timeouts: {
      modelTimeoutMs: timeoutMs ?? null,
      reserveMs: reserveMs ?? null,
      rowHardTimeoutMs: hardTimeoutMs ?? null,
    },
    checks: CHECKS,
    models: merged,
  };
  writeFileSync(resultsUrl, JSON.stringify(out, null, 2));
  console.log(`\nwrote docs/eval/results.json (${merged.length} models total)`);
}

async function runOneModelChild() {
  const modelId = explicitModels()?.[0];
  if (!modelId) throw new Error("--one-model requires a model id");
  const row = await runModel(modelId, {
    timeoutMs: optionNumber("--model-timeout-ms", "BENCHMARK_MODEL_TIMEOUT_MS"),
    reserveMs: optionNumber("--model-reserve-ms", "BENCHMARK_MODEL_RESERVE_MS"),
  });
  process.stdout.write(`__BENCHMARK_ROW_START__${JSON.stringify(row)}__BENCHMARK_ROW_END__`);
}

(process.argv.includes("--one-model") ? runOneModelChild() : runBenchmark()).catch((e) => { console.error(e); process.exit(1); });
