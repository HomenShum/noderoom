/**
 * Context engineering — the OTHER half. Each run, before the model sees anything,
 * we pull a fresh snapshot + awareness from the room and render them into ONE
 * compact, model-legible message: the table (with versions + lock flags), who
 * holds what, the active agents, and the recent activity. This is "just-in-time"
 * context — assembled at call time from live state, not stuffed into the prompt.
 *
 * Why render it ourselves instead of dumping JSON: the model reasons better over
 * a small aligned table than over a blob, and we control exactly what it sees
 * (versions for CAS, lock flags for the protocol) and what we leave out (noise).
 */

import type { RoomTools, AgentMessage } from "./types";

export async function buildContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const [snap, aware] = await Promise.all([rt.snapshot(), rt.awareness()]);

  const table = snap.rows
    .map((r) => `  ${r.rowId.padEnd(8)} ${r.label.padEnd(13)} Q2=${r.q2.padEnd(8)} Q3=${r.q3.padEnd(8)} variance=${(r.variance || "(empty)").padEnd(8)} [v${r.varianceVersion}]${r.locked ? "  <LOCKED>" : ""}`)
    .join("\n");

  const locks = aware.activeLocks.length
    ? aware.activeLocks.map((l) => `  - ${l.holder} holds [${l.elementIds.join(", ")}] — ${l.reason} (lockId ${l.lockId})`).join("\n")
    : "  (none — the sheet is fully editable)";

  const agents = aware.agents.length ? aware.agents.map((a) => `  - ${a.name} [${a.scope}] · ${a.status}`).join("\n") : "  (none)";

  const content = [
    `YOUR TASK: ${goal}`,
    ``,
    `SPREADSHEET (artifact "${snap.artifactId}", v${snap.version}). Editable cells are addressed \`{rowId}__variance\` and \`{rowId}__note\`:`,
    table,
    ``,
    `ACTIVE LOCKS (held read-only by others — you can still read them):`,
    locks,
    ``,
    `AGENTS IN THE ROOM:`,
    agents,
    aware.recentTrace.length ? `\nRECENT ACTIVITY:\n${aware.recentTrace.map((t) => "  - " + t).join("\n")}` : "",
    ``,
    `Claim the cells you need, edit them with the versions shown (CAS), then release. If a cell you need is LOCKED, draft around it instead.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return [{ role: "user", content }];
}

/** JIT context for the company-research sheet: status/freshness gated, multi-field, multi-source. */
export async function buildResearchContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const [snap, aware] = await Promise.all([rt.snapshot(), rt.awareness()]);
  const editable = ["status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"];
  const table = snap.rows.map((r) => {
    const company = String(r.cells.company?.value || r.rowId);
    const status = String(r.cells.status?.value || "pending");
    const tier = String(r.cells.tier?.value || "");
    const intent = String(r.cells.intent?.value || "");
    const website = String(r.cells.website?.value || "");
    const last = String(r.cells.last_researched?.value || "(never)");
    const sourceCount = [r.cells.source?.value, r.cells.source2?.value].filter(Boolean).length;
    const versions = editable.map((c) => `${c}=v${r.cells[c]?.version ?? 0}`).join(" ");
    const locked = editable.some((c) => r.cells[c]?.locked);
    return `  ${r.rowId.padEnd(14)} ${company.padEnd(22)} status=${status.padEnd(9)} tier=${tier.padEnd(2)} intent=${intent.slice(0, 24).padEnd(24)} website=${website || "(none)"} last=${last} sources=${sourceCount} ${versions}${locked ? "  <LOCKED>" : ""}`;
  }).join("\n");
  const locks = aware.activeLocks.length ? aware.activeLocks.map((l) => `  - ${l.holder} holds [${l.elementIds.join(", ")}] - ${l.reason}`).join("\n") : "  (none)";
  const content = [
    `YOUR TASK: ${goal}`,
    ``,
    `COMPANY RESEARCH SHEET (artifact "${snap.artifactId}", v${snap.version}). Editable cells per row: ${editable.map((c) => `\`{rowId}__${c}\``).join(", ")}.`,
    table,
    ``,
    `Process rows whose status is "pending" or whose last_researched is stale for the user's request. For each row: propose_lock the editable cells, set status to "running", fetch_source the website plus one corroborating source when available, then use write_cell_result for summary/funding/headcount/recent_signal/source/source2/last_researched/status so every agent-filled cell stores value, evidence, confidence, and status. Set last_researched to today's ISO date, set status to "complete", then release the lock. Cite only sources you actually fetched. Preserve tier, intent, owner, and crm_status unless explicitly asked to change them.`,
    ``,
    `ACTIVE LOCKS (read-only held by others):`,
    locks,
  ].filter((l) => l !== "").join("\n");
  return [{ role: "user", content }];
}

/** Legacy one-source prompt retained for comparison docs. */
export async function buildResearchContextLegacy(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const [snap, aware] = await Promise.all([rt.snapshot(), rt.awareness()]);
  const table = snap.rows.map((r) => {
    const company = r.cells.company?.value || r.rowId;
    const status = r.cells.status?.value || "pending";
    const sv = r.cells.summary?.version ?? 0;
    const locked = r.cells.status?.locked || r.cells.summary?.locked;
    return `  ${r.rowId.padEnd(8)} ${company.padEnd(22)} status=${status.padEnd(9)} summary=${(r.cells.summary?.value ? "[set]" : "(empty)").padEnd(8)} [summary v${sv}]${locked ? "  <LOCKED>" : ""}`;
  }).join("\n");
  const locks = aware.activeLocks.length ? aware.activeLocks.map((l) => `  - ${l.holder} holds [${l.elementIds.join(", ")}] — ${l.reason}`).join("\n") : "  (none)";
  const content = [
    `YOUR TASK: ${goal}`,
    ``,
    `COMPANY RESEARCH SHEET (artifact "${snap.artifactId}", v${snap.version}). Per company, editable cells are \`{rowId}__status\`, \`{rowId}__summary\`, \`{rowId}__source\`:`,
    table,
    ``,
    `Process ONLY rows whose status is "pending". For each: propose_lock its cells, set status to "running", fetch_source a real page for evidence, write a sourced summary + the citation into __source, set status to "complete", then release the lock. CITE only sources you actually fetched — never invent one.`,
    ``,
    `ACTIVE LOCKS (read-only held by others):`,
    locks,
  ].filter((l) => l !== "").join("\n");
  return [{ role: "user", content }];
}
