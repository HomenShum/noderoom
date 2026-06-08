# Workflow Evals — beyond the L1–L6 collaboration ladder (2026-06-07)

The L1–L6 ladder (`evals/ladder.ts`) tests the **collaboration primitive** (lock → CAS → draft → no-clobber).
These evals test the **real product workflows**. A grounded design pass (5 parallel agents reading the
actual codebase) produced scenario specs; implementing them surfaced that **only 2 of 5 are agent-executable
today** — the other 3 are blocked by missing *capabilities*, not missing tests.

## Status

| Workflow | Status | Where | Note |
|---|---|---|---|
| **GTM enrichment** | ✅ **green** | `tests/workflowEvals.test.ts` (harness) | `companyResearchPlan` fills pending accounts → complete, sourced `CellPayload`+evidence, CRM columns untouched, edit-read provenance. |
| **Parser extraction** | ✅ **green** | `tests/workflowEvals.test.ts` (direct) | banner-band CSV → header detected below banner, blanks stay empty (no invention), per-cell provenance, honest warning. |
| **Cross-file workflows** | ✅ **green** | `tests/workflowEvals.test.ts` | UNBLOCKED by the **multi-artifact tool layer** (`artifactId` on the RoomTools port + `list_artifacts`). One run bound to the sheet now discovers files, reads the sheet, and writes the note. |
| **Wiki updates** | ✅ **green** | `tests/workflowEvals.test.ts` | UNBLOCKED by the **`update_wiki`** tool (grounded, citation-enforced, CAS) riding on multi-artifact reach. |
| **Finance reconciliation** | ✅ **green** | `tests/workflowEvals.test.ts` | UNBLOCKED by the **`reconcile_cell`** derive/compare tool: read → write only if different → SKIPS already-correct cells (no clobber) → CAS-protected. |

## The capability roadmap this eval pass produced — DONE
All four capabilities the eval pass specified have shipped (each backed by a green eval):
1. ✅ **Multi-artifact tool layer** — `artifactId` on the RoomTools port + `list_artifacts` tool (both ports + the engine). Unblocked cross-file + wiki.
2. ✅ **`update_wiki` agent tool** — grounded write to a note doc with required citations + a visible Sources footer. Unblocked wiki.
3. ✅ **`reconcile_cell` capability** — derives/compares (`if current==expected skip; else CAS-correct`). Unblocked finance reconciliation.
4. ⏳ **`parse_file` agent tool** (optional) — parsing is still eval'd directly (correct for a pure app-layer function); promoting it into `ROOM_TOOLS` for agent-driven parsing is the only optional remainder.

## Running
- Scripted (deterministic, fast): `npx vitest run workflowEvals` — both green.
- Real-model matrix (the honest signal): the GTM scenario can run via `companyResearchPlan` targets through
  `evals/ladder.ts --real <model>` once a `research` rung is added (the ladder's variance-only `Env`/rung
  helpers were generalized — `cellValue`/`onlyTouched`/`editReadProvenance` already read `{rowId}__{col}` and
  recognize `write_cell_result`).

## Why this matters
Broadening evals did its job: it proved 2 real workflows green **and** turned "we should test these 5
workflows" into "here are the 3 capabilities to build first." The evals are the spec.
