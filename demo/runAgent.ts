/**
 * Runs the agent harness against the in-memory room, injecting a CONCURRENT
 * human edit mid-run, in two scenarios that separate the two safety mechanisms:
 *
 *   A) WITH a lock  — the agent claims the range first, so the human's concurrent
 *      write is BLOCKED. The lock PREVENTS the race.
 *   B) NO lock (CAS) — the agent edits directly; the human's write lands between
 *      the agent's read and write, so the agent's stale write is REJECTED. CAS
 *      CATCHES the race: the agent re-reads and retries instead of clobbering.
 *
 *   npx tsx demo/runAgent.ts            # scripted model (no keys), both scenarios
 *   npx tsx demo/runAgent.ts --real     # scenario A with the real Anthropic model
 */

import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools, ROOM_TOOLS, runAgent, scriptedModel, anthropicModel } from "../src/nodeagent/index";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import type { AgentModel } from "../src/nodeagent/index";

const real = process.argv.includes("--real");
const bar = "─".repeat(74);
const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 92 ? s.slice(0, 89) + "…" : s; };

async function scenario(title: string, opts: { targets: Record<string, string>; lock: boolean; model?: AgentModel }) {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  const ids = Object.keys(opts.targets);
  const conflictCell = ids[0];

  console.log(`\n${bar}\n${title}\n${bar}`);
  let injected = false;
  const onTrace = (e: { tool: string; args: unknown; result: unknown }) => {
    const a = e.args as { elementIds?: string[] };
    console.log(`  ▸ ${e.tool.padEnd(13)} ${short(e.args)}\n      → ${short(e.result)}`);
    if (!injected && e.tool === "read_range" && (a.elementIds ?? []).includes(conflictCell)) {
      injected = true;
      const v = engine.getArtifact(d.sheetId)!.elements[conflictCell].version;
      const res = engine.applyEdit({ roomId: d.roomId, op: { opId: "human", artifactId: d.sheetId, elementId: conflictCell, kind: "set", value: "+19% (Priya)", baseVersion: v }, actor: d.members.priya });
      console.log(res.ok
        ? `  ⚡ Priya edits ${conflictCell} → "+19%" (v${res.toVersion}) — no lock to stop her; the agent's next write will be STALE`
        : `  ⛔ Priya's edit to ${conflictCell} is BLOCKED (${res.reason}) — the lock prevented the race`);
    }
  };

  const model = opts.model ?? scriptedModel(recomputeVariancePlan(opts.targets, { lock: opts.lock, reason: "recompute Q3 variance" }));
  const r = await runAgent({ rt, goal: `Set ${ids.map((id) => `${id.replace("__variance", "")}=${opts.targets[id]}`).join(", ")}`, model, tools: ROOM_TOOLS, maxSteps: 16, onTrace });

  const conflicts = r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
  console.log(`  ── ${r.steps} steps · ${r.trace.length} tool calls · ${conflicts} CAS conflict(s) survived · exhausted=${r.exhausted}`);
  const art = engine.getArtifact(d.sheetId)!;
  for (const id of ids) console.log(`     ${id.replace("__variance", "").padEnd(8)} = ${String(art.elements[id]?.value).padEnd(16)} v${art.elements[id]?.version}`);
}

async function main() {
  console.log(`MODEL: ${real ? "anthropic (real)" : "scripted (deterministic, no keys)"}`);
  if (real && process.env.ANTHROPIC_API_KEY) {
    await scenario("A · WITH LOCK — the real model claims the range; the concurrent write is blocked", { targets: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, lock: true, model: anthropicModel() });
  } else {
    if (real) console.log("(no ANTHROPIC_API_KEY — using the scripted model)\n");
    await scenario("A · WITH LOCK — the agent claims the range first; Priya's concurrent write is BLOCKED", { targets: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, lock: true });
    await scenario("B · NO LOCK (CAS) — Priya's write lands first; the agent's stale write is REJECTED → re-read → retry", { targets: { r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" }, lock: false });
  }
  console.log(`\n${bar}\nThe harness is src/nodeagent/ · walkthrough in docs/AGENT_RUNTIME.md\n${bar}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
