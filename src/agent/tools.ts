/**
 * The agent's tools. Each is `{ name, description, schema (zod), execute }`.
 * `execute` does NOT touch the database directly — it calls a RoomTools method,
 * which in production is a Convex mutation/query. So the tool layer is pure +
 * portable; the backend is swappable. The descriptions encode the protocol
 * (claim → CAS → release / draft-when-locked) so the model uses them correctly.
 *
 * The critical contract: edit_cell returns a conflict as a normal result value,
 * which the runtime feeds back to the model as a tool message — turning a race
 * into a re-read-and-retry instead of a clobber.
 */

import { z } from "zod";
import type { AgentTool } from "./types";
import type { CellEvidence, CellPayload, CellStatus } from "../engine/types";

const opSchema = z.object({ elementId: z.string(), value: z.any(), baseVersion: z.number().int() });
const cellStatusSchema = z.enum(["empty", "running", "complete", "needs_review", "failed", "gap"]);
const evidenceSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["upload", "source", "computed", "manual"]),
  label: z.string(),
  source: z.string().optional(),
  sheetName: z.string().optional(),
  row: z.number().optional(),
  column: z.string().optional(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

function cellPayload(args: {
  elementId: string;
  value: unknown;
  status: CellStatus;
  evidence: CellEvidence[];
  confidence?: number;
  error?: string;
  normalizedValue?: unknown;
}): CellPayload {
  return {
    value: args.value,
    status: args.status,
    confidence: args.confidence,
    error: args.error,
    normalizedValue: args.normalizedValue,
    evidence: args.evidence.map((e, idx) => ({
      ...e,
      id: e.id || `${e.kind}:${args.elementId}:${idx + 1}`,
    })),
  };
}

export const ROOM_TOOLS: AgentTool[] = [
  {
    name: "read_range",
    description: "Read the current value + version of specific cells. Works even on LOCKED cells (locked = read-only, not invisible). Call this before editing, and again after any conflict. Defaults to the primary file; pass artifactId (from list_artifacts) to read another file in the room.",
    schema: z.object({ elementIds: z.array(z.string()).describe("cell ids, e.g. ['r_rev__variance','r_cogs__variance']"), artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file") }),
    execute: (a: { elementIds: string[]; artifactId?: string }, rt) => rt.readRange(a.elementIds, a.artifactId),
  },
  {
    name: "search_sheet_context",
    description: "Search a spreadsheet's header-prepended semantic cell summaries and structural sub-grid chunks. Use this before reading/editing large uploaded sheets so you find relevant cells without dumping the full grid. Returns cell hits with elementId/coordinate and chunk hits with elementIds.",
    schema: z.object({
      query: z.string().describe("business terms to search, e.g. 'software API fees cost' or 'ARR metric'"),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: (a: { query: string; artifactId?: string; limit?: number }, rt) => rt.searchSheetContext(a.query, a.artifactId, a.limit),
  },
  {
    name: "propose_lock",
    description: "Claim an affected range: make these cells read-only for everyone else while you edit. Returns { ok:true, lockId } or { ok:false } if already locked (then read + create_draft instead of waiting).",
    schema: z.object({ elementIds: z.array(z.string()), reason: z.string().describe("one short phrase, shown to the room"), artifactId: z.string().optional() }),
    execute: (a: { elementIds: string[]; reason: string; artifactId?: string }, rt) => rt.proposeLock(a.elementIds, a.reason, a.artifactId),
  },
  {
    name: "edit_cell",
    description: "Set a cell value with optimistic concurrency control. baseVersion MUST be the version you last read for that cell. Returns { ok:true, version } on success, or { ok:false, conflict:true, actual:N } if the cell changed since you read it — in which case read_range it again and retry with version N. Never ignore a conflict.",
    schema: z.object({ elementId: z.string(), value: z.any(), baseVersion: z.number().int(), artifactId: z.string().optional() }),
    execute: (a: { elementId: string; value: unknown; baseVersion: number; artifactId?: string }, rt) => rt.editCell(a.elementId, a.value, a.baseVersion, a.artifactId),
  },
  {
    name: "write_cell_result",
    description: "Write an agent-produced dataframe result as { value, status, evidence[], confidence }. Use this for ENRICH, CLASSIFY, RESOLVE, and COMPUTE cells instead of scalar edit_cell. baseVersion MUST be the version you last read.",
    schema: z.object({
      elementId: z.string(),
      value: z.any(),
      baseVersion: z.number().int(),
      status: cellStatusSchema.default("complete"),
      confidence: z.number().min(0).max(1).optional(),
      normalizedValue: z.any().optional(),
      error: z.string().optional(),
      evidence: z.array(evidenceSchema).min(1),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
    }),
    execute: (a: {
      elementId: string;
      value: unknown;
      baseVersion: number;
      status: CellStatus;
      confidence?: number;
      normalizedValue?: unknown;
      error?: string;
      evidence: CellEvidence[];
      artifactId?: string;
    }, rt) => rt.editCell(a.elementId, cellPayload(a), a.baseVersion, a.artifactId),
  },
  {
    name: "list_artifacts",
    description: "List the other files in this room (sheet/note/wiki/wall) with their id, title, and kind. Use this to discover a file to read or write — then pass its id as artifactId to read_range/edit_cell/write_cell_result. This is how one run reads one file and writes another (e.g. summarize a spreadsheet into a wiki note).",
    schema: z.object({}),
    execute: (_a: Record<string, never>, rt) => rt.listArtifacts(),
  },
  {
    name: "update_wiki",
    description: "Update a wiki/note doc with a GROUNDED summary. You MUST cite the artifact ids this summary is derived from (citesArtifactIds — use list_artifacts to find them and read_range to read their cells first). Writes the target note's 'doc' element with a visible Sources footer so the grounding is auditable. CAS: pass the baseVersion you last read for 'doc'; a conflict returns as data (re-read + retry). No ungrounded wiki writes.",
    schema: z.object({
      artifactId: z.string().describe("the wiki/note artifact id from list_artifacts"),
      content: z.string().describe("the markdown/HTML body of the update"),
      citesArtifactIds: z.array(z.string()).min(1).describe("artifact ids this summary is grounded in — REQUIRED, no ungrounded wiki writes"),
      baseVersion: z.number().int().describe("the version you last read for the 'doc' element"),
      elementId: z.string().optional().describe("the doc element to write; defaults to 'doc'"),
    }),
    execute: (a: { artifactId: string; content: string; citesArtifactIds: string[]; baseVersion: number; elementId?: string }, rt) =>
      rt.editCell(a.elementId ?? "doc", `${a.content}\n\n<p class="wiki-sources">Sources: ${a.citesArtifactIds.join(", ")}</p>`, a.baseVersion, a.artifactId),
  },
  {
    name: "reconcile_cell",
    description: "Reconcile a cell to an expected value — read it, and write ONLY if it differs. SKIPS already-correct cells (a re-run is a no-op; you never clobber a matching value), corrects wrong ones with CAS. Returns { ok:true, skipped:true } if it already matched, { ok:true, corrected:true, version } if written, or { ok:false, conflict:true } if it changed since baseVersion (re-read + retry). Use for finance reconciliation: derive the expected value (from other cells, or a source file via list_artifacts + read_range), then reconcile each cell against it.",
    schema: z.object({
      elementId: z.string(),
      expectedValue: z.any(),
      baseVersion: z.number().int().describe("the version you last read for this cell"),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
    }),
    execute: async (a: { elementId: string; expectedValue: unknown; baseVersion: number; artifactId?: string }, rt) => {
      const [cur] = await rt.readRange([a.elementId], a.artifactId);
      const raw = cur?.value;
      const curScalar = raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>) ? (raw as { value: unknown }).value : raw;
      if (String(curScalar ?? "") === String(a.expectedValue ?? "")) return { ok: true as const, skipped: true as const, version: cur?.version ?? 0 };
      const res = await rt.editCell(a.elementId, a.expectedValue, a.baseVersion, a.artifactId);
      return res.ok ? { ok: true as const, corrected: true as const, version: res.version } : res;
    },
  },
  {
    name: "create_draft",
    description: "When a range you need is locked by someone else, draft your intended changes here instead of waiting. They smart-merge automatically the moment the blocking lock releases, and can never clobber work committed in the meantime.",
    schema: z.object({ ops: z.array(opSchema), blockedByLockId: z.string(), note: z.string(), artifactId: z.string().optional() }),
    execute: (a: { ops: { elementId: string; value: unknown; baseVersion: number }[]; blockedByLockId: string; note: string; artifactId?: string }, rt) => rt.createDraft(a.ops, a.blockedByLockId, a.note, a.artifactId),
  },
  {
    name: "release_lock",
    description: "Release your lock when finished. Any drafts that were waiting on it are smart-merged at this moment.",
    schema: z.object({ lockId: z.string() }),
    execute: (a: { lockId: string }, rt) => rt.releaseLock(a.lockId),
  },
  {
    name: "say",
    description: "Post one short status line to the room chat (a public agent posts publicly; a private agent posts only to its owner).",
    schema: z.object({ text: z.string() }),
    execute: async (a: { text: string }, rt) => { await rt.say(a.text); return { ok: true }; },
  },
  {
    name: "fetch_source",
    description: "Fetch a real web page for sourced enrichment. Returns { ok:true, title, snippet, url } or { ok:false, error }. Use the returned title/url as the CITATION when you write a researched value — NEVER cite a source you did not fetch.",
    schema: z.object({ url: z.string().describe("an https URL to fetch as evidence") }),
    execute: (a: { url: string }, rt) => rt.fetchSource(a.url),
  },
];

export const TOOL_NAMES = ROOM_TOOLS.map((t) => t.name);
