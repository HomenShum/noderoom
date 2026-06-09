# Workflow Evals - beyond the L1-L6 collaboration ladder (2026-06-07)

The L1-L6 ladder (`evals/ladder.ts`) tests the collaboration primitive: lock, CAS, draft, range
discipline, and compaction recovery. These evals test product workflows.

The earlier design pass produced five workflow specs. All five now have green deterministic coverage;
the remaining work is live provider repetition, browser E2E, and production-scale Convex proof.

## Status

| Workflow | Status | Where | Note |
|---|---|---|---|
| GTM enrichment | green | `tests/workflowEvals.test.ts` | `companyResearchPlan` fills pending accounts, writes sourced `CellPayload` evidence, leaves CRM columns untouched, and preserves edit-read provenance. |
| Parser extraction | green | `tests/workflowEvals.test.ts` | Banner-band CSV parsing detects headers below the banner, keeps blanks empty, and records honest warnings. |
| Cross-file workflows | green | `tests/workflowEvals.test.ts` | Multi-artifact RoomTools and `list_artifacts` let an agent read the sheet and write the note/wiki. |
| Wiki updates | green | `tests/workflowEvals.test.ts` | `update_wiki` performs grounded note writes with required citations and CAS. |
| Finance reconciliation | green | `tests/workflowEvals.test.ts` | `reconcile_cell` derives expected values, skips already-correct cells, and CAS-corrects only when different. |

## Capability Roadmap

Shipped capabilities:

1. Multi-artifact tool layer: artifact-scoped RoomTools plus `list_artifacts`.
2. `update_wiki`: grounded write to a note document with required citations.
3. `reconcile_cell`: derive, compare, skip, or CAS-correct.
4. Direct parser fixtures for spreadsheet ingestion.

Still optional:

1. Promote `parse_file` into `ROOM_TOOLS` for fully agent-driven parsing.
2. Add live GTM and finance provider jobs with row-level trace assertions.
3. Add browser E2E for public/private chat, drag-file references, and cross-artifact edits.

## Running

```bash
npx vitest run tests/workflowEvals.test.ts
npm run eval:professional
```

The real-model matrix should use workflow-specific live evals, not only the variance ladder.
