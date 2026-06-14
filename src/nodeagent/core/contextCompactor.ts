/**
 * Context compaction — keeps the agent's message history bounded on long runs.
 *
 * The bulk of a long run is OLD `read_range` tool results: each is a fat JSON
 * array, and every later read supersedes the earlier ones, so the old ones are
 * pure dead weight. Compaction elides them — exactly Anthropic's "context
 * editing" (clear stale tool results) pattern — while keeping the message
 * ENVELOPES intact, so the assistant↔tool pairing the model API requires is
 * never broken. We always preserve: the opening task+snapshot (message 0), the
 * most recent turns verbatim, and every conflict/commit (those are signal).
 *
 * Deterministic by default; an optional `summarize` seam can replace the elided
 * block's stub text with an LLM running-summary (the Claude "compaction" pattern).
 *
 * Prior art:
 *   - Anthropic, "Effective context engineering for AI agents" — context editing,
 *     compaction, the memory tool.
 *   - Nous Research Hermes — structured tool-call turns (we preserve the turn shape).
 */

import type { AgentMessage } from "./types";

export interface CompactionOpts {
  /** Compact once the estimated context exceeds this many chars (~chars/4 ≈ tokens). */
  maxChars?: number;
  /** Keep this many of the most recent messages verbatim (chosen at a turn boundary). */
  keepRecent?: number;
  /** Tool results that are superseded by later calls and safe to elide. */
  staleTools?: string[];
  /** Optional: summarize the elided block into one line (the LLM-compaction seam). */
  summarize?: (elided: AgentMessage[]) => Promise<string>;
}

const DEFAULTS = { maxChars: 24_000, keepRecent: 8, staleTools: ["read_range"] };

/** Cheap size estimate — character count of content + serialized tool calls. */
export function estimateChars(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) n += (m.content?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);
  return n;
}

export interface CompactionResult { messages: AgentMessage[]; compacted: boolean; before: number; after: number; elided: number; }

export async function compactMessages(messages: AgentMessage[], opts: CompactionOpts = {}): Promise<CompactionResult> {
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const keepRecent = opts.keepRecent ?? DEFAULTS.keepRecent;
  const stale = new Set(opts.staleTools ?? DEFAULTS.staleTools);
  const before = estimateChars(messages);

  if (before <= maxChars || messages.length <= keepRecent + 2) return { messages, compacted: false, before, after: before, elided: 0 };

  const head = messages[0];
  const tail = messages.slice(messages.length - keepRecent);
  const middle = messages.slice(1, messages.length - keepRecent);

  const elidedReads = middle.filter((m) => m.role === "tool" && stale.has(m.toolName ?? ""));
  const stubText = opts.summarize
    ? `[compacted: earlier reads summarized] ${await opts.summarize(elidedReads)}`
    : "[stale read elided during compaction — superseded by a later read or the current snapshot]";

  // Keep every envelope; only shrink the content of stale tool results.
  const compactedMiddle = middle.map((m) =>
    m.role === "tool" && stale.has(m.toolName ?? "") ? { ...m, content: stubText } : m,
  );

  const out = [head, ...compactedMiddle, ...tail];
  return { messages: out, compacted: true, before, after: estimateChars(out), elided: elidedReads.length };
}
