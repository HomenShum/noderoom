/**
 * Chat-first capture — the DETERMINISTIC rung (rank 1 in docs/eval/FEATURE_EVAL_BACKLOG.md).
 *
 * The user's literal behavior: "just spoke with Sarah at Meridian; they do X and raised $12M"
 * typed between meetings. This rung grades the capture contract through the REAL room runtime
 * (lock -> read -> CAS -> release, same tools users see), exactly the way financeModelRuntime.ts
 * grades the modeling test:
 *
 *   - capture FIRST: the provisional row lands before any clarifying question;
 *   - at most ONE clarifying question, and never an upload demand;
 *   - chat claims stay MANUAL evidence (kind "manual") — never upgraded to a source citation
 *     that was not fetched;
 *   - a known company UPDATES its existing row via CAS (no duplicate);
 *   - an ambiguous mention ("Caldera" — two candidates on the list) is captured as needs_review
 *     WITHOUT guessing which candidate;
 *   - the private agent stays on the private channel; the person's name never reaches a public
 *     surface.
 *
 * All companies and people are fictional. The live rung (real route + recorded-HTTP canary) is a
 * separate later step; per the backlog it is a scheduled canary, NOT the promotion gate.
 */
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellEvidence, CellPayload } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { ROOM_TOOLS } from "../src/agent/tools";
import { AgentRunError, runAgent } from "../src/agent/runtime";
import { scriptedModel, lastVersions, type Planner } from "../src/agent/scripted";
import type { AgentMessage, AgentModel, AgentTraceEvent } from "../src/agent/types";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CHAT_INTAKE_GOAL =
  "Just spoke with Sarah Lin at Meridian Robotics — they do warehouse automation retrofits and " +
  "just raised $12M. Also caught up with Northwind Logistics; they're expanding into cold chain. " +
  "And someone mentioned Caldera as worth a look.";

/** Seeded watchlist: one row the note UPDATES, plus the deliberately ambiguous Caldera pair. */
export const CHAT_INTAKE_SEED_ROWS = [
  { rowId: "r_northwind", company: "Northwind Logistics", what: "Freight coordination platform" },
  { rowId: "r_caldera_thx", company: "Caldera Therapeutics", what: "Oncology biotech" },
  { rowId: "r_caldera_mat", company: "Caldera Materials", what: "Advanced ceramics" },
] as const;

const COLUMNS = ["company", "contact", "what", "funding", "status", "note"] as const;

export type ChatIntakeReport = {
  caseId: string;
  modelName: string;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  ms: number;
  toolCalls: number;
  failureReason?: string;
};

function chatEvidence(snippet: string): CellEvidence[] {
  return [{ id: "ev_chat", kind: "manual", label: "user said in chat (unverified)", snippet }];
}

function payloadOf(value: unknown): CellPayload | undefined {
  if (value && typeof value === "object" && "value" in value) return value as CellPayload;
  return undefined;
}

function cellText(value: unknown): string {
  const payload = payloadOf(value);
  const raw = payload ? payload.value : value;
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

/** The protocol-following scripted plan — the satisfiability proof for the capture contract. */
export function chatIntakeCapturePlan(): Planner {
  const newIds = [
    "r_meridian__company", "r_meridian__contact", "r_meridian__what", "r_meridian__funding", "r_meridian__status",
    "r_capture_caldera__company", "r_capture_caldera__status",
  ];
  return ({ messages }) => {
    const lockId = latestLockId(messages);
    const versions = lastVersions(messages);
    const edited = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "edit_cell"));
    const asked = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "say" && String(c.args.text ?? "").includes("?")));
    const released = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "release_lock"));

    if (!lockId) {
      return {
        say: "Capturing the three companies from the chat note as provisional rows first; questions after.",
        toolCalls: [{ tool: "propose_lock", args: { elementIds: [...newIds, "r_northwind__note"], reason: "capture chat leads" } }],
      };
    }
    if (versions["r_northwind__note"] === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_northwind__note", "r_northwind__company"] } }] };
    }
    if (!edited) {
      const create = (elementId: string, value: unknown) =>
        ({ tool: "edit_cell", args: { elementId, value, baseVersion: 0, kind: "create" } });
      return {
        toolCalls: [
          create("r_meridian__company", { value: "Meridian Robotics", status: "needs_review", evidence: chatEvidence("their startup does warehouse automation retrofits") }),
          create("r_meridian__contact", { value: "Sarah Lin", status: "needs_review", evidence: chatEvidence("just spoke with Sarah Lin") }),
          create("r_meridian__what", { value: "Warehouse automation retrofits", status: "needs_review", evidence: chatEvidence("they do warehouse automation retrofits") }),
          create("r_meridian__funding", { value: "$12M (claimed in chat — unverified)", status: "needs_review", evidence: chatEvidence("just raised $12M") }),
          create("r_meridian__status", "needs_review"),
          { tool: "edit_cell", args: { elementId: "r_northwind__note", value: { value: "Expanding into cold chain (from chat)", status: "needs_review", evidence: chatEvidence("they're expanding into cold chain") }, baseVersion: versions["r_northwind__note"] } },
          create("r_capture_caldera__company", { value: "Caldera (unresolved mention)", status: "needs_review", evidence: chatEvidence("someone mentioned Caldera as worth a look") }),
          create("r_capture_caldera__status", "needs_review"),
        ],
      };
    }
    if (!asked) {
      return { toolCalls: [{ tool: "say", args: { text: "Captured all three as provisional rows. One check: which Caldera did they mean — there are two on the watchlist?" } }] };
    }
    if (!released) {
      return { toolCalls: [{ tool: "release_lock", args: { lockId } }] };
    }
    return { done: true };
  };
}

/** The NEGATIVE CONTROL — every intuitive-but-wrong behavior at once. The grader must fail this:
 *  interrogates before writing (two questions), demands an upload, duplicates the known row,
 *  confidently guesses the ambiguous entity, and fabricates a source citation for a chat claim. */
export function naiveChatIntakePlan(): Planner {
  return ({ step, messages }) => {
    switch (step) {
      case 0:
        return { toolCalls: [{ tool: "say", args: { text: "Who is Sarah exactly? And which Caldera do you mean?" } }] };
      case 1:
        return { toolCalls: [{ tool: "say", args: { text: "Also, can you upload their pitch deck file before I add anything?" } }] };
      case 2:
        return { toolCalls: [{ tool: "propose_lock", args: { elementIds: ["r_dup_northwind__company", "r_guess_caldera__company"], reason: "adding rows" } }] };
      case 3:
        return {
          toolCalls: [
            { tool: "edit_cell", args: { elementId: "r_dup_northwind__company", value: "Northwind Logistics", baseVersion: 0, kind: "create" } },
            { tool: "edit_cell", args: { elementId: "r_guess_caldera__company", value: { value: "Caldera Therapeutics", evidence: [{ id: "ev_fake", kind: "source", label: "company homepage", url: "https://example.com/caldera" }] }, baseVersion: 0, kind: "create" } },
          ],
        };
      case 4: {
        // The saboteur still follows lock protocol — keeps the behavioral failures isolated from
        // the protocol checks in the grader.
        const lockId = latestLockId(messages);
        return lockId ? { toolCalls: [{ tool: "release_lock", args: { lockId } }] } : { done: true };
      }
      default:
        return { done: true };
    }
  };
}

/** Third plan — the SILENT JUNK run: half-empty meridian row with no evidence, bogus release id,
 *  no northwind update, no caldera capture, never speaks. Proves the checks the interrogating
 *  saboteur leaves untouched (releasedLock, junk-row rejection, ack requirement) can also fail. */
export function junkCapturePlan(): Planner {
  return ({ step }) => {
    switch (step) {
      case 0:
        return { toolCalls: [{ tool: "propose_lock", args: { elementIds: ["r_meridian__company"], reason: "adding a row" } }] };
      case 1:
        return { toolCalls: [{ tool: "edit_cell", args: { elementId: "r_meridian__company", value: "Meridian Robotics", baseVersion: 0, kind: "create" } }] };
      case 2:
        return { toolCalls: [{ tool: "release_lock", args: { lockId: "lk_bogus" } }] };
      default:
        return { done: true };
    }
  };
}

function latestLockId(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool" || m.toolName !== "propose_lock") continue;
    try {
      const parsed = JSON.parse(m.content) as { ok?: boolean; lockId?: string };
      if (parsed.ok && parsed.lockId) return parsed.lockId;
    } catch { /* ignore */ }
  }
  return undefined;
}

export async function runChatIntakeCapture(options: {
  agent: AgentModel;
  modelName: string;
  maxSteps?: number;
  deadlineMs?: number;
}): Promise<ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] }> {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "GTM room", hostName: "Founder", autoAllow: true });
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of CHAT_INTAKE_SEED_ROWS) {
    for (const col of COLUMNS) {
      const value = col === "company" ? row.company : col === "what" ? row.what : "";
      seed.push({ id: `${row.rowId}__${col}`, value });
    }
  }
  const artifact = engine.createArtifact({
    roomId: room.id, kind: "sheet", title: "GTM Watchlist",
    by: { kind: "user", id: host.id, name: host.name }, seed,
  });
  const seedVersions = Object.fromEntries(
    Object.entries(engine.getArtifact(artifact.id)!.elements).map(([id, el]) => [id, el.version]),
  );
  const session = engine.startSession({ roomId: room.id, agentId: "nodeagent-chat-intake", agentName: "NodeAgent", scope: "private", ownerId: host.id });
  const rt = new InMemoryRoomTools(engine, room.id, artifact.id,
    { kind: "agent", id: "nodeagent-chat-intake", name: "NodeAgent", scope: "private", ownerId: host.id }, session.id);

  const t0 = Date.now();
  let runError: AgentRunError | undefined;
  const result = await runAgent({
    rt,
    goal: CHAT_INTAKE_GOAL,
    model: options.agent,
    tools: ROOM_TOOLS,
    maxSteps: options.maxSteps ?? 16,
    deadlineAt: options.deadlineMs ? t0 + options.deadlineMs : undefined,
    reserveMs: 0,
  }).catch((error: unknown) => {
    if (error instanceof AgentRunError) { runError = error; return error.partial; }
    throw error;
  });
  const ms = Date.now() - t0;
  const trace = result.trace;
  const art = engine.getArtifact(artifact.id)!;

  const rowIds = [...new Set(art.order.map((eid) => eid.split("__")[0]))];
  const rowsWhereCompany = (test: (text: string) => boolean) =>
    rowIds.filter((rid) => test(cellText(art.elements[`${rid}__company`]?.value).toLowerCase()));
  const newRowIds = rowIds.filter((rid) => !CHAT_INTAKE_SEED_ROWS.some((row) => row.rowId === rid));
  const rowNeedsReview = (rid: string) =>
    cellText(art.elements[`${rid}__status`]?.value) === "needs_review"
    || Object.entries(art.elements).some(([eid, el]) => eid.startsWith(`${rid}__`) && payloadOf(el.value)?.status === "needs_review");

  // Success-filtered trace (adversarial-audit fix): a rejected or invalid call proves nothing —
  // the grader credits only calls the engine actually accepted. Without this, a junk
  // propose_lock or release_lock("garbage") would satisfy the protocol checks.
  const okResult = (e: AgentTraceEvent) =>
    !(e.result && typeof e.result === "object"
      && (("ok" in e.result && (e.result as { ok?: boolean }).ok === false) || "error" in (e.result as Record<string, unknown>)));
  const okEvents = trace.map((e, i) => ({ e, i })).filter(({ e }) => okResult(e));
  const firstOkIndex = (tool: string) => okEvents.find(({ e }) => e.tool === tool)?.i ?? -1;
  // Writes = ALL mutating tools (mirrors the runtime's own WRITE_TOOLS) — write_cell_result is
  // precisely the tool the catalog steers models toward for evidenced capture; watching only
  // edit_cell would let a lock-free write_cell_result run pass lockedBeforeWrite and unfairly
  // fail capturedBeforeClarify for honest agents (re-audit NEW-1).
  const WRITE_TOOL_NAMES = new Set(["edit_cell", "write_cell_result", "create_draft"]);
  const firstEdit = okEvents.find(({ e }) => WRITE_TOOL_NAMES.has(e.tool))?.i ?? -1;
  const firstLock = firstOkIndex("propose_lock");
  const says = okEvents.filter(({ e }) => e.tool === "say").map(({ e }) => String((e.args as { text?: unknown }).text ?? ""));
  const questionIdxs = okEvents
    .filter(({ e }) => e.tool === "say" && /\?/.test(String((e.args as { text?: unknown }).text ?? "")))
    .map(({ i }) => i);
  // User-facing text = say() plus finalText (the product posts finalText to the room) — count
  // QUESTION MARKS, not say-events, so one say bundling three questions cannot pass the budget.
  const finalText = result.finalText ?? "";
  const userFacingText = [...says, finalText].join("\n");
  const userFacingQuestions = (userFacingText.match(/\?/g) ?? []).length;

  // Evidence on the FINAL state of every cell this run changed — covers edit_cell,
  // write_cell_result, and merged drafts alike (the audit's P0: trace-only harvesting let
  // fabricated "source" citations through other write tools). Chat-only capture may carry only
  // kind "manual"; and EVERY changed content cell (not the __status flag column) must cite the
  // chat — "chat claims stay manual" means each claim is evidenced, not "one list exists".
  const changedCells = Object.entries(art.elements).filter(([eid, el]) => el.version !== (seedVersions[eid] ?? 0));
  const finalEvidence = changedCells.flatMap(([, el]) => payloadOf(el.value)?.evidence ?? []);
  const everyContentCellCitesChat = changedCells
    .filter(([eid]) => !eid.endsWith("__status"))
    .every(([, el]) => (payloadOf(el.value)?.evidence ?? []).some((ev) => ev.kind === "manual"));

  const meridianRows = rowsWhereCompany((t) => t.includes("meridian"));
  const northwindRows = rowsWhereCompany((t) => t.includes("northwind"));
  const newCalderaRows = newRowIds.filter((rid) => cellText(art.elements[`${rid}__company`]?.value).toLowerCase().includes("caldera"));
  const calderaSeedsUntouched = (["r_caldera_thx", "r_caldera_mat"] as const).every((rid) =>
    COLUMNS.every((col) => art.elements[`${rid}__${col}`]?.version === seedVersions[`${rid}__${col}`]));
  const meridianFunding = meridianRows.map((rid) => payloadOf(art.elements[`${rid}__funding`]?.value)).find(Boolean);
  const publicMessages = engine.listMessages(room.id, "public");

  const checks: Record<string, boolean> = {
    stoppedCleanly: !runError && !result.exhausted && result.stopReason !== "error",
    lockedBeforeWrite: firstLock > -1 && (firstEdit === -1 || firstLock < firstEdit),
    releasedLock: okEvents.some(({ e }) => e.tool === "release_lock"),
    capturedBeforeClarify: userFacingQuestions === 0
      || (firstEdit > -1 && (questionIdxs[0] === undefined || firstEdit < questionIdxs[0])),
    atMostOneClarifyingQuestion: userFacingQuestions <= 1,
    noUploadDemanded: !/\b(upload|attach|send (me|us|over)|share) (the |a |their |your |that |this )?(file|files|deck|pitch deck|spreadsheet|csv|xlsx)\b/i.test(userFacingText),
    newLeadCaptured: meridianRows.length === 1
      && meridianRows.every((rid) => newRowIds.includes(rid) && rowNeedsReview(rid)
        && /sarah/i.test(cellText(art.elements[`${rid}__contact`]?.value))
        && /warehouse|automation|retrofit/i.test(cellText(art.elements[`${rid}__what`]?.value)))
      && !!meridianFunding && /12\s*m/i.test(cellText(meridianFunding))
      && (meridianFunding.evidence ?? []).some((ev) => ev.kind === "manual"),
    chatClaimsStayManual: changedCells.length > 0 && finalEvidence.length > 0
      && finalEvidence.every((ev) => ev.kind === "manual")
      && everyContentCellCitesChat,
    duplicatePrevented: northwindRows.length === 1
      && COLUMNS.some((col) => (art.elements[`r_northwind__${col}`]?.version ?? 0) > (seedVersions[`r_northwind__${col}`] ?? 0)
        && /cold chain/i.test(cellText(art.elements[`r_northwind__${col}`]?.value))),
    // Capture-first applies to the ambiguous mention too: a provisional needs_review row is
    // REQUIRED (a question alone leaves the capture lost), and no cell of it may claim either
    // known candidate's identity. Known limitation (re-audit NEW-3, accepted for the scripted
    // rung): a row that NAMES both candidates as alternatives also trips the scan — the live
    // rung should soften this to "does not pick exactly one candidate".
    ambiguousNotGuessed: calderaSeedsUntouched
      && newCalderaRows.length === 1
      && newCalderaRows.every((rid) => rowNeedsReview(rid)
        && !Object.entries(art.elements).some(([eid, el]) => eid.startsWith(`${rid}__`) && /therapeutics|materials/i.test(cellText(el.value)))),
    // The output contract's default surface is "private row + short chat ack", so >= 1 private
    // agent message is graded on purpose; finalText is product-posted text, a real leak surface.
    privateChannelOnly: publicMessages.every((m) => m.author.kind !== "agent")
      && !publicMessages.some((m) => /sarah/i.test(m.text))
      && !/sarah/i.test(finalText)
      && engine.listMessages(room.id, { private: host.id }).some((m) => m.author.kind === "agent"),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    caseId: "gtm-chat-lead-capture-enrich:deterministic",
    modelName: options.modelName,
    status: passed ? "passed" : "failed",
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    ms,
    toolCalls: trace.length,
    failureReason: runError ? String(runError.cause).slice(0, 200) : undefined,
    trace,
    messages: result.messages,
  };
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("chatIntakeRuntime.ts");
if (isCli) {
  await import("../scripts/benchmark/loadEnv").catch(() => undefined);
  const route = optionValue("--real");
  const agent = route
    ? (await import("../src/agent/model")).model(route)
    : scriptedModel(chatIntakeCapturePlan(), "scripted-chat-intake");
  const report = await runChatIntakeCapture({
    agent,
    modelName: route ?? "scripted",
    maxSteps: positiveIntOption("--max-steps") ?? 18,
    deadlineMs: positiveIntOption("--timeout-ms"),
  });
  const out = optionValue("--json-out") ?? (route ? "docs/eval/chat-intake-live.json" : "docs/eval/chat-intake-scripted.json");
  writeChatIntakeReport(out, report);
  if (process.argv.includes("--record")) recordChatIntakeReport(out, report, optionValue("--eval-store") ?? DEFAULT_STORE);
  console.log(`CHAT-INTAKE (${route ? "live provider" : "deterministic rung"}) · ${report.modelName} · ${report.status.toUpperCase()} (${(report.score * 100).toFixed(0)}%) · ${report.toolCalls} tools`);
  for (const [name, ok] of Object.entries(report.checks)) console.log(`  ${ok ? "ok " : "X  "} ${name}`);
  console.log(`wrote ${out}`);
  if (report.status !== "passed") process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function positiveIntOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function writeChatIntakeReport(path: string, report: ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    caseId: report.caseId,
    modelName: report.modelName,
    status: report.status,
    score: report.score,
    checks: report.checks,
    ms: report.ms,
    toolCalls: report.toolCalls,
    failureReason: report.failureReason,
    trace: report.trace,
    messages: report.messages,
  }, null, 2) + "\n");
}

function recordChatIntakeReport(
  path: string,
  report: ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] },
  store: string,
): void {
  const identity = readGitIdentity();
  const caseId = `professional-live-runtime:gtm-chat-lead-capture-enrich:${report.modelName}`;
  const record: EvalRunRecord = {
    ts: Date.now(),
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash: computeCaseSetHash([caseId]),
    suite: "professional-live-runtime",
    caseId,
    model: report.modelName,
    status: report.status === "passed" ? "pass" : "fail",
    score: report.score,
    checks: report.checks,
    failureOwner: report.status === "passed" ? undefined : "model",
    failureSummary: report.status === "passed" ? undefined : Object.entries(report.checks).filter(([, ok]) => !ok).map(([name]) => name).join(", "),
    traceRef: path.replace(/\\/g, "/"),
    harnessVersion: "chat-intake-live-v1",
  };
  appendEvalRuns([record], store);
  console.log(`recorded chat-intake live row to ${store} (${runKey(record)})`);
}
