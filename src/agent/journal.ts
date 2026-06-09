import type { AgentStep } from "./types";

/**
 * Per-step model-output journal for EXACTLY-ONCE execution (durable-workflow semantics).
 *
 * The double-bill the guide warns about: a slice calls the model, then crashes before the
 * checkpoint mutation; on retry the slice re-runs from the start and re-calls (re-bills) the model.
 * With a journal, the retried slice REPLAYS a completed step's recorded output instead of calling
 * the model again — so the model is billed exactly once per step across crashes. Tools still
 * re-execute, which is safe because every write is CAS-idempotent (a re-applied edit conflicts).
 *
 * Keyed by step index within the slice (a retry restarts from the same point, so indices align).
 * Prior art: LangChain Interrupt 26 / @convex-dev/workflow event journaling.
 */
export interface StepJournal {
  // Sync (in-memory) or async (Convex-backed: persist each step immediately, so a mid-slice crash
  // doesn't lose it — the runtime awaits both).
  get(step: number): AgentStep | undefined | Promise<AgentStep | undefined>;
  record(step: number, result: AgentStep): void | Promise<void>;
}

export function stableJournalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJournalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJournalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function stableJournalHash(value: unknown): string {
  const input = typeof value === "string" ? value : stableJournalJson(value);
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export function journalSliceKey(input: unknown): string {
  return stableJournalHash(input);
}

/** In-memory journal (tests / single process). Production mirrors this with a Convex journal table
 *  keyed by (jobId, sliceKey, step): record after each model call, read on slice retry. */
export class MapStepJournal implements StepJournal {
  private steps = new Map<number, AgentStep>();
  get(step: number): AgentStep | undefined { return this.steps.get(step); }
  record(step: number, result: AgentStep): void { this.steps.set(step, result); }
  get size(): number { return this.steps.size; }
}
