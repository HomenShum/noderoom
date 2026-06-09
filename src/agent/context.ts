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

/** Unwrap a cell payload ({value,...}) or return the raw scalar/HTML as a string. */
function elementText(value: unknown): string {
  const raw = value && typeof value === "object" && "value" in (value as Record<string, unknown>) ? (value as { value: unknown }).value : value;
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** JIT context for a NOTE artifact: one editable `doc` element (HTML body). The agent reads the
 *  current body + version, then rewrites it with CAS (edit_cell on `doc`, or update_wiki). */
export async function buildNoteContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const [snap, aware] = await Promise.all([rt.snapshot(), rt.awareness()]);
  const els = snap.elements ?? [];
  const doc = els.find((e) => e.id === "doc") ?? els[0];
  const docId = doc?.id ?? "doc";
  const body = elementText(doc?.value);
  const preview = body.length > 1800 ? body.slice(0, 1800) + " …[truncated]" : (body || "  (empty)");
  const others = els.filter((e) => e.id !== docId);
  const locks = aware.activeLocks.length ? aware.activeLocks.map((l) => `  - ${l.holder} holds [${l.elementIds.join(", ")}] — ${l.reason}`).join("\n") : "";
  const content = [
    `YOUR TASK: ${goal}`,
    ``,
    `This artifact (id "${snap.artifactId}", v${snap.version}) is a NOTE. Its body is the \`${docId}\` element (HTML), currently v${doc?.version ?? 0}.`,
    `CURRENT CONTENT:`,
    preview,
    others.length ? `\nOther editable elements: ${others.map((e) => `${e.id} (v${e.version})`).join(", ")}.` : "",
    ``,
    `To update the note: edit the \`${docId}\` element with kind "set" and the new full HTML, using version ${doc?.version ?? 0} for CAS — or use update_wiki (it appends a Sources footer for grounding). Preserve existing structure unless asked to rewrite. If \`${docId}\` is LOCKED, create_draft instead.`,
    locks ? `\nACTIVE LOCKS:\n${locks}` : "",
  ].filter((l) => l !== "").join("\n");
  return [{ role: "user", content }];
}

/** JIT context for a post-it WALL: each element's value is { text, x, y, color }. The agent can ADD
 *  (edit_cell kind "create", fresh id, baseVersion 0), EDIT (kind "set" + CAS), or DELETE post-its. */
export async function buildWallContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const [snap, aware] = await Promise.all([rt.snapshot(), rt.awareness()]);
  const els = snap.elements ?? [];
  const stickies = els.map((e) => {
    const s = (e.value ?? {}) as { text?: unknown; x?: unknown; y?: unknown; color?: unknown };
    const text = String(s.text ?? "").replace(/\s+/g, " ").slice(0, 44);
    return `  ${e.id.padEnd(12)} [v${e.version}]${aware.activeLocks.some((l) => l.elementIds.includes(e.id)) ? " <LOCKED>" : ""}  pos=(${s.x ?? 0},${s.y ?? 0}) color=${s.color ?? "?"}  "${text}"`;
  }).join("\n");
  const content = [
    `YOUR TASK: ${goal}`,
    ``,
    `This artifact (id "${snap.artifactId}", v${snap.version}) is a POST-IT WALL. Each post-it is an element whose value is an object { text, x, y, color }.`,
    els.length ? `CURRENT POST-ITS:\n${stickies}` : `The wall is empty.`,
    ``,
    `To ADD a post-it: edit_cell with a NEW elementId (e.g. "s_idea1"), kind "create", baseVersion 0, value { "text": "…", "x": <40–560>, "y": <40–360>, "color": "#FDE68A" }. Vary x/y by ~120px so notes don't overlap.`,
    `To EDIT an existing post-it: edit_cell on its id with kind "set" and the version shown (CAS). To REMOVE one: kind "delete". If a post-it is LOCKED, create_draft instead.`,
  ].filter((l) => l !== "").join("\n");
  return [{ role: "user", content }];
}

