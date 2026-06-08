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

/** In-memory journal (tests / single process). Production mirrors this with a Convex journal table
 *  keyed by (jobId, step): record after each model call, read on slice retry. */
export class MapStepJournal implements StepJournal {
  private steps = new Map<number, AgentStep>();
  get(step: number): AgentStep | undefined { return this.steps.get(step); }
  record(step: number, result: AgentStep): void { this.steps.set(step, result); }
  get size(): number { return this.steps.size; }
}
