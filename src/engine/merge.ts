/**
 * Smart-merge — resolve a pending draft against the artifact state at unlock time.
 *
 * This is the "smart resolved by the LLM agent itself once the affected range is
 * unlocked" seam. The `deterministicResolver` ships in the spike and is honest:
 * it applies draft ops to elements that are UNCHANGED since the draft was made
 * (the common "agent worked AROUND the locked range" case → clean merge), treats
 * identical re-edits as no-ops, and flags genuine value divergence for review
 * rather than clobbering committed work.
 *
 * A real LLM resolver implements the same `SmartResolver` signature: it receives
 * the draft, the current element state, and the committed edits, and returns the
 * ops to apply plus a resolution note — e.g. it can MERGE two diverged paragraphs
 * or reconcile two numbers instead of flagging a conflict.
 */

import type { ChangeOp, MergeResolution, SmartResolver } from "./types";

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => kb[i] === k && deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export const deterministicResolver: SmartResolver = ({ draft, current }) => {
  const ops: ChangeOp[] = [];
  const applied: string[] = [];
  const reauthored: string[] = [];
  const conflicts: MergeResolution["conflicts"] = [];

  for (const op of draft.ops) {
    const el = current[op.elementId];

    if (op.kind === "create") {
      if (el) conflicts.push({ opId: op.opId, elementId: op.elementId, reason: "created_concurrently", current: el.value });
      else { ops.push({ ...op }); applied.push(op.opId); }
      continue;
    }
    if (!el) {
      conflicts.push({ opId: op.opId, elementId: op.elementId, reason: "element_removed_while_locked", current: undefined });
      continue;
    }
    if (op.kind === "delete") {
      if (el.version === op.baseVersion) { ops.push({ ...op, baseVersion: el.version }); applied.push(op.opId); }
      else conflicts.push({ opId: op.opId, elementId: op.elementId, reason: "changed_before_delete", current: el.value });
      continue;
    }
    // set
    if (el.version === op.baseVersion) {
      // Untouched since the draft was authored → apply cleanly (the happy path:
      // the blocked agent worked on elements the lock-holder never touched).
      ops.push({ ...op, baseVersion: el.version });
      applied.push(op.opId);
    } else if (deepEq(el.value, op.value)) {
      // The lock-holder independently made the same change → benign no-op.
      applied.push(op.opId);
    } else {
      // Genuine divergence. Deterministic policy: do NOT clobber committed work —
      // flag for review. (An LLM resolver would merge the two values here.)
      conflicts.push({ opId: op.opId, elementId: op.elementId, reason: "value_diverged", current: el.value });
    }
  }

  const verdict: MergeResolution["verdict"] =
    conflicts.length > 0 ? "needs_review" : reauthored.length > 0 ? "resolved" : "clean";

  const resolution: MergeResolution = {
    applied,
    reauthored,
    conflicts,
    verdict,
    resolver: "deterministic",
    note:
      conflicts.length > 0
        ? `${applied.length} op(s) merged cleanly; ${conflicts.length} need review (value diverged while locked)`
        : `${applied.length} op(s) merged cleanly — the draft targeted elements the lock-holder never touched`,
  };

  return { ops, resolution };
};
