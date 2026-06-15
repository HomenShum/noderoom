/**
 * Cross-file join / reconciliation grader (deep-review Workflows 5 & 6 — the cross_file_context
 * primitive). A multi-artifact workflow is only correct if a value reconciled INTO one artifact (B)
 * actually ties out to its source row in another artifact (A), joined on a shared key. This is the
 * deterministic grader that flips cross_file_context from "catalog-only" to a graded contract: given
 * two artifacts and the fields that were joined, it confirms every reconciled value matches its
 * source — and catches a saboteur that invents a value with no support in A or joins on a missing key.
 *
 * Pure + deterministic (no model, no I/O), the same honesty discipline as the formula/CAS/chart
 * spine. The full agent-runtime cross-file rung (driving runAgent across two artifacts, like
 * chatIntakeRuntime.ts) is a heavier follow-up; this grades the join CORRECTNESS the rung depends on.
 */

export interface JoinRow {
  /** The shared join key (e.g. ticker, company id) present in both artifacts. */
  key: string;
  fields: Record<string, string | number>;
}

export interface CrossFileJoinResult {
  ok: boolean;
  checked: number;
  /** Reconciled fields in B whose value does not tie out to the source row in A. */
  mismatches: Array<{ key: string; field: string; reason: string }>;
  /** Rows in B whose join key has no source row in A (a join on a non-existent key). */
  missingKeys: string[];
  matched: number;
}

/**
 * Grade a reconciliation of `artifactB` against `artifactA` on the shared key, for the given
 * `joinedFields`. A field present in B must equal the same field in A's row with the same key.
 */
export function gradeCrossFileJoin(
  artifactA: JoinRow[],
  artifactB: JoinRow[],
  joinedFields: string[],
): CrossFileJoinResult {
  const aByKey = new Map(artifactA.map((row) => [row.key, row]));
  const mismatches: Array<{ key: string; field: string; reason: string }> = [];
  const missingKeys: string[] = [];
  let matched = 0;

  for (const b of artifactB) {
    const a = aByKey.get(b.key);
    if (!a) {
      missingKeys.push(b.key); // B joined on a key that does not exist in A
      continue;
    }
    let rowOk = true;
    for (const field of joinedFields) {
      const bValue = b.fields[field];
      if (bValue === undefined) continue; // B didn't reconcile this field — not graded
      const aValue = a.fields[field];
      if (aValue === undefined) {
        mismatches.push({ key: b.key, field, reason: `B reconciled "${field}" but A has no such field for ${b.key}` });
        rowOk = false;
      } else if (String(aValue) !== String(bValue)) {
        mismatches.push({ key: b.key, field, reason: `B.${field}=${bValue} does not tie out to A.${field}=${aValue}` });
        rowOk = false;
      }
    }
    if (rowOk) matched += 1;
  }

  return { ok: mismatches.length === 0 && missingKeys.length === 0, checked: artifactB.length, mismatches, missingKeys, matched };
}
