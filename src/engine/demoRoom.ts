/**
 * Demo room — "Q3 diligence" (matches the Claude Design handoff).
 *
 * The spreadsheet is a financial model: rows (Revenue, COGS, Gross profit, OpEx,
 * Net income) with read-only label/Q2/Q3 and editable Variance/Note cells, stored
 * as engine elements `${rowId}__${col}`. The collab: the Room Agent locks the
 * Revenue + COGS variance cells and commits them; the private agent drafts the
 * Gross-profit + Net-income variance around the lock; on release it smart-merges.
 */

import { RoomEngine } from "./roomEngine";
import type { Actor, ChangeOp, ToolPart } from "./types";

export const SHEET_COLS = ["label", "q2", "q3", "variance", "note"] as const;
export const SHEET_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];

/** ParselyFi / GTM tabular-research surface: account list, status-gated. */
export const RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;

export const RESEARCH_COMPANIES = [
  { id: "rc_anthropic", company: "Anthropic", url: "https://www.anthropic.com", source2Url: "https://en.wikipedia.org/wiki/Anthropic", tier: "A", intent: "AI safety + enterprise API", owner: "Homen", crmStatus: "Target" },
  { id: "rc_ramp", company: "Ramp", url: "https://ramp.com", source2Url: "https://en.wikipedia.org/wiki/Ramp_(company)", tier: "A", intent: "Finance automation", owner: "Priya", crmStatus: "Working" },
  { id: "rc_mercury", company: "Mercury", url: "https://mercury.com", source2Url: "https://www.forbes.com/companies/mercury/", tier: "B", intent: "Startup banking", owner: "Homen", crmStatus: "Research" },
  { id: "rc_brex", company: "Brex", url: "https://www.brex.com", source2Url: "https://en.wikipedia.org/wiki/Brex", tier: "A", intent: "Spend management", owner: "Priya", crmStatus: "Target" },
];
/** Scripted enrichment targets for the no-keys path (the live LLM researches for real instead). */
export const RESEARCH_PLAN = [
  { rowId: "rc_anthropic", summary: "AI safety lab; Claude model family; enterprise API + apps.", funding: "Backed by major cloud and venture investors.", headcount: "Large AI lab; exact count requires source review.", recentSignal: "Enterprise AI adoption and model updates.", sourceUrl: "https://www.anthropic.com", source2Url: "https://en.wikipedia.org/wiki/Anthropic" },
  { rowId: "rc_ramp", summary: "Corporate cards + spend management; finance automation.", funding: "Late-stage fintech with multiple growth rounds.", headcount: "Scaled finance automation team.", recentSignal: "Expansion across procurement and AP workflows.", sourceUrl: "https://ramp.com", source2Url: "https://en.wikipedia.org/wiki/Ramp_(company)" },
  { rowId: "rc_mercury", summary: "Banking + treasury for startups; business accounts.", funding: "Venture-backed startup banking platform.", headcount: "Mid-size startup-focused financial platform.", recentSignal: "Treasury and business banking product growth.", sourceUrl: "https://mercury.com", source2Url: "https://www.forbes.com/companies/mercury/" },
  { rowId: "rc_brex", summary: "Corporate cards + expense management for scaled startups.", funding: "Late-stage fintech with major venture backing.", headcount: "Scaled global fintech team.", recentSignal: "Spend management and travel platform expansion.", sourceUrl: "https://www.brex.com", source2Url: "https://en.wikipedia.org/wiki/Brex" },
];
export const WIKI_DOC = "Living wiki for room state, file inventory, agent sessions, workflows, backend map, and recent trace evidence. It updates from artifacts, sessions, runs, and traces.";

export interface DemoRoom {
  roomId: string;
  me: Actor;
  members: { homen: Actor; priya: Actor; quokka: Actor };
  agents: { room: Actor; priv: Actor };
  sessions: { room: string; priv: string };
  wikiId: string;
  sheetId: string;
  researchId: string;
  noteId: string;
  wallId: string;
}

export function buildDemoRoom(engine: RoomEngine): DemoRoom {
  const { room, host } = engine.createRoom({ title: "Q3 diligence", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Homen" };
  const priyaM = engine.joinRoom({ code: room.code, name: "Priya", anon: false })!.member;
  const quokkaM = engine.joinRoom({ code: room.code, name: "anon · quokka" })!.member;
  const priya: Actor = { kind: "user", id: priyaM.id, name: "Priya" };
  const quokka: Actor = { kind: "user", id: quokkaM.id, name: "anon · quokka" };

  const seed: Array<{ id: string; value: unknown }> = [];
  for (const r of SHEET_ROWS) {
    seed.push({ id: `${r.id}__label`, value: r.label });
    seed.push({ id: `${r.id}__q2`, value: r.q2 });
    seed.push({ id: `${r.id}__q3`, value: r.q3 });
    seed.push({ id: `${r.id}__variance`, value: "" });
    seed.push({ id: `${r.id}__note`, value: "" });
  }
  const wikiId = engine.createArtifact({ roomId: room.id, kind: "note", title: "Agent wiki", by: me, seed: [{ id: "doc", value: WIKI_DOC }] }).id;
  const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Q3 variance", by: me, seed }).id;

  const researchSeed: Array<{ id: string; value: unknown }> = [];
  for (const c of RESEARCH_COMPANIES) {
    const vals: Record<(typeof RESEARCH_COLS)[number], string> = {
      company: c.company, website: c.url, status: "pending", tier: c.tier, intent: c.intent, owner: c.owner, crm_status: c.crmStatus,
      summary: "", funding: "", headcount: "", recent_signal: "", source: "", source2: "", last_researched: "",
    };
    for (const col of RESEARCH_COLS) researchSeed.push({ id: `${c.id}__${col}`, value: vals[col] });
  }
  const researchId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: me, seed: researchSeed }).id;

  const noteId = engine.createArtifact({
    roomId: room.id, kind: "note", title: "Sync reliability", by: me,
    seed: [{ id: "doc", value: "<h1>Sync reliability — diligence note</h1><p>Null cells are a real blank value in the sheet, not an instruction to delete the row. The sync tool preserves them so a retried delta can't silently drop data.</p><p>Open question: should null cells survive the sync instead of being treated as deletes?</p>" }],
  }).id;

  const wallId = engine.createArtifact({
    roomId: room.id, kind: "wall", title: "Diligence wall", by: me,
    seed: [
      { id: "s1", value: { text: "Variance > 15% needs a footnote", x: 28, y: 26, color: "#E8C9B8" } },
      { id: "s2", value: { text: "Reconcile against the NetSuite export", x: 232, y: 70, color: "#CBD2F0" } },
      { id: "s3", value: { text: "Stable row ids — null is preserved", x: 116, y: 196, color: "#C5DBCB" } },
    ],
  }).id;

  const room_ = engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" });
  const privA = engine.startSession({ roomId: room.id, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: me.id });

  engine.postMessage({ roomId: room.id, channel: "public", author: priya, text: "Pulling the NetSuite Q3 numbers into the variance sheet — revenue looks off vs the close.", clientMsgId: "seed1", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: quokka, text: "joined as a guest. read-only on the sheet for now?", clientMsgId: "seed2", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: me, text: "Private: why should null cells survive the sync instead of being treated as deletes?", clientMsgId: "seed3", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: me.id }, text: "null is a real blank value in the sheet, not an instruction to delete the row. The sync tool preserves it so a retried delta can't silently drop data. This note stays private unless you promote it.", clientMsgId: "seed4", kind: "agent" });

  return {
    roomId: room.id, me, members: { homen: me, priya, quokka },
    agents: { room: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" }, priv: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: me.id } },
    sessions: { room: room_.id, priv: privA.id },
    wikiId, sheetId, researchId, noteId, wallId,
  };
}

const op = (opId: string, artifactId: string, elementId: string, value: unknown, baseVersion: number): ChangeOp =>
  ({ opId, artifactId, elementId, kind: "set", value, baseVersion });
const wait = (ms: number, reduced: boolean) => new Promise<void>((r) => setTimeout(r, reduced ? 0 : ms));

/** Lock → commit → release → draft-merge over the variance column. */
export async function playCollab(engine: RoomEngine, d: DemoRoom, opts: { reduced?: boolean; conflict?: boolean; log?: (s: string) => void } = {}): Promise<void> {
  const reduced = !!opts.reduced;
  const log = opts.log ?? (() => {});
  const ver = (id: string) => engine.getArtifact(d.sheetId)!.elements[id].version;
  const tp = (parts: ToolPart[]) => parts;

  const m1 = engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: "On it. Gathering room context, then I'll propose a versioned delta to the variance column. I'll lock just the rows I touch.", clientMsgId: "ra1", kind: "agent", toolParts: tp([{ tool: "propose_lock", status: "running", detail: "Variance · r_rev, r_cogs" }]) })!;
  const lr = engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: ["r_rev__variance", "r_cogs__variance"], holder: d.agents.room, sessionId: d.sessions.room, reason: "recompute Q3 variance from the NetSuite export" });
  const lockId = lr.ok ? lr.lock.id : "";
  engine.updateMessage(m1.id, { toolParts: [{ tool: "nodeagent.propose_lock", status: "done", detail: "locked Variance on Revenue, COGS" }] });
  log("Room Agent locked Variance on Revenue, COGS");
  await wait(750, reduced);

  const aware = engine.awareness(d.roomId, "agent_priv");
  engine.postMessage({ roomId: d.roomId, channel: { private: d.members.homen.id }, author: d.agents.priv, text: `Room Agent holds Variance on Revenue, COGS (read-only). I can still read it as context — I'll draft Variance for Gross profit and Net income around the lock.`, clientMsgId: "pa1", kind: "agent", toolParts: tp([{ tool: "context.read_locked", status: "done", detail: `${aware.activeLocks.length} lock · read-only, used for reasoning` }]) });
  await wait(750, reduced);

  engine.applyEdit({ roomId: d.roomId, op: op("ra_rev", d.sheetId, "r_rev__variance", "+24%", ver("r_rev__variance")), actor: d.agents.room });
  engine.applyEdit({ roomId: d.roomId, op: op("ra_cogs", d.sheetId, "r_cogs__variance", "+27.5%", ver("r_cogs__variance")), actor: d.agents.room });
  engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: "Committed Variance for Revenue and COGS through the sync tool. Lock released.", clientMsgId: "ra2", kind: "agent", toolParts: tp([{ tool: "nodeagent.apply_spreadsheet_delta", status: "done", detail: "set_cell · +24%, +27.5%" }]) });
  log("Room Agent committed Variance +24%, +27.5%");
  await wait(700, reduced);

  const ops: ChangeOp[] = [op("pa_gp", d.sheetId, "r_gp__variance", "+21.7%", ver("r_gp__variance")), op("pa_ni", d.sheetId, "r_ni__variance", "+22.4%", ver("r_ni__variance"))];
  if (opts.conflict) ops.push(op("pa_rev", d.sheetId, "r_rev__variance", "+19%", 1));
  const draft = engine.createDraft({ roomId: d.roomId, artifactId: d.sheetId, author: d.agents.priv, blockedByLockId: lockId, note: "Variance for Gross profit, Net income", ops });
  log(`Private agent drafted ${ops.length} variance change(s)`);
  await wait(800, reduced);

  const released = engine.releaseLock(lockId, d.agents.room);
  const m = released.merged.find((x) => x.draftId === draft.id);
  engine.postMessage({ roomId: d.roomId, channel: { private: d.members.homen.id }, author: d.agents.priv, text: m && m.conflicts.length ? `Smart-merge needs review: ${m.resolution.note}.` : "Smart-merged my drafted Variance for Gross profit and Net income on top of canonical state.", clientMsgId: "pa2", kind: "agent", toolParts: tp([{ tool: "nodeagent.smart_merge", status: m && m.conflicts.length ? "error" : "done", detail: m?.resolution.note ?? "merged" }]) });
  log(`Smart-merge: ${m?.resolution.verdict}`);
}
