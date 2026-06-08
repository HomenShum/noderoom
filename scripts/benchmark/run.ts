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
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { RoomEngine } from "../../src/engine/roomEngine";
import { buildDemoRoom, RESEARCH_COMPANIES } from "../../src/engine/demoRoom";
import { InMemoryRoomTools } from "../../src/agent/roomTools";
import { ROOM_TOOLS } from "../../src/agent/tools";
import { runAgent } from "../../src/agent/runtime";
import { model, priceRun, judge } from "../../src/agent/model";
import { buildResearchContext } from "../../src/agent/context";
import { fetchSourceReal } from "../../src/agent/fetchSource";

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
const MODELS = process.argv[2] ? process.argv[2].split(",") : [
  "gpt-5.4-nano", "gemini-3.1-flash-lite", "gpt-5.4-mini", "gemini-3.5-flash", // cheap → mid (latest)
  "claude-haiku-4-5", "claude-sonnet-4-6", "gpt-5.5", // anchor → flagship (latest)
];
const COMPANIES = RESEARCH_COMPANIES.slice(0, 3); // bound the spend

const GOAL =
  "Research every company whose status is pending. For each: propose_lock its cells, set status to running, " +
  "fetch_source the company homepage plus a corroborating source when available, write summary/funding/headcount/recent_signal, " +
  "write citation URLs into __source and __source2, set last_researched to today's ISO date, " +
  "set status to complete, then release the lock. Cite only sources you actually fetched.";

interface Row {
  model: string; ok: boolean; checks: Record<string, boolean>; passed: number; total: number;
  inputTokens: number; outputTokens: number; costUsd: number; ms: number; steps: number; toolCalls: number; error?: string;
}

async function runModel(modelId: string): Promise<Row> {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.researchId, d.agents.room, d.sessions.room);
  rt.fetchSource = fetchSourceReal; // real sourcing (the browser stub is for no-keys demos)
  const t0 = Date.now();
  const fail = (error: string): Row => ({ model: modelId, ok: false, checks: {}, passed: 0, total: 9, inputTokens: 0, outputTokens: 0, costUsd: 0, ms: Date.now() - t0, steps: 0, toolCalls: 0, error });
  try {
    const r = await runAgent({ rt, goal: GOAL, model: model(modelId), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 60 });
    const ms = Date.now() - t0;
    const art = engine.getArtifact(d.researchId)!;
    const ids = COMPANIES.map((c) => c.id);
    const fetched = r.trace.filter((t) => t.tool === "fetch_source" && (t.result as { ok?: boolean })?.ok).map((t) => String((t.result as { url?: string }).url ?? ""));
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const checks: Record<string, boolean> = {
      ALL_COMPLETE: ids.every((id) => String(art.elements[`${id}__status`]?.value) === "complete"),
      EVERY_ROW_SOURCED: ids.every((id) => String(art.elements[`${id}__source`]?.value ?? "").length > 0),
      EVERY_ROW_MULTI_SOURCE: ids.every((id) => String(art.elements[`${id}__source2`]?.value ?? "").length > 0),
      SOURCES_FETCHED: ids.every((id) => { const s = `${String(art.elements[`${id}__source`]?.value ?? "")}\n${String(art.elements[`${id}__source2`]?.value ?? "")}`; return !!s && fetched.some((u) => host(u) && s.includes(host(u))); }),
      STRUCTURED_FIELDS: ids.every((id) => ["summary", "funding", "headcount", "recent_signal"].every((c) => String(art.elements[`${id}__${c}`]?.value ?? "").length > 0)),
      FRESHNESS_WRITTEN: ids.every((id) => /^\d{4}-\d{2}-\d{2}/.test(String(art.elements[`${id}__last_researched`]?.value ?? ""))),
      COMPLETED_IN_BUDGET: !r.exhausted,
    };
    // LLM-judge content checks — these DIFFERENTIATE models (a cheap one may fabricate or pad).
    const evidence = r.trace.filter((t) => t.tool === "fetch_source" && (t.result as { ok?: boolean })?.ok).map((t) => { const x = t.result as { title?: string; snippet?: string }; return `${x.title}: ${x.snippet}`; }).join("\n");
    let grounded = true, rightEntity = true;
    for (const c of COMPANIES) {
      const v = await judgeCompany(c.company, String(art.elements[`${c.id}__summary`]?.value ?? ""), evidence);
      if (!v.grounded) grounded = false;
      if (!v.rightEntity) rightEntity = false;
    }
    checks.NO_FABRICATION = grounded;
    checks.RIGHT_ENTITY = rightEntity;
    const passed = Object.values(checks).filter(Boolean).length;
    return { model: modelId, ok: passed === Object.keys(checks).length, checks, passed, total: Object.keys(checks).length, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: priceRun(modelId, r.usage.inputTokens, r.usage.outputTokens), ms, steps: r.steps, toolCalls: r.trace.length };
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
main().catch((e) => { console.error(e); process.exit(1); });
