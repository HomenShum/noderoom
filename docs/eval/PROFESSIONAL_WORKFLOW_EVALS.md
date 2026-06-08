# Professional Workflow Evals

This document turns the reviewed local CSV/XLSX corpus into a practical NodeRoom
eval plan. It is intentionally redacted: the repo stores workflow shape,
headers-level signals, and fixture strategy, not private row values.

## Reviewed File Shape

Local profiler result from the user-provided manifest:

| Signal | Count |
|---|---:|
| Files reviewed | 70 |
| CSV files | 23 |
| XLSX files | 47 |
| GTM/company research | 46 |
| Finance/ops | 11 |
| Eval harness | 2 |
| Analytics/optimization | 3 |
| Legacy agent outputs | 3 |
| Mixed/uncategorized | 5 |
| Header-level PII signals | 47 |
| Files with sampled formulas | 16 |
| Files with merged cells | 18 |

The dominant work is company research: PitchBook uploads, ParselyFi outputs,
healthtech/JPM lists, sector classification, and company reports. The second
cluster is finance/ops: cost exports, timecards, timesheets, business income and
expense, and transaction-style exports. That is exactly the surface NodeRoom is
meant to support: spreadsheet-first professional workflows with evidence,
review, and safe mutation.

## What The Suite Proves

The professional suite extends the L1-L6 collaboration ladder from synthetic Q3
variance into real workflow shapes:

```text
file upload -> schema detection -> artifact refs -> agent run
  -> evidence-bearing CellPayload writes
  -> lock/CAS/draft/no-clobber
  -> wiki/report update
  -> trace/eval result
```

For large or slow work:

```text
/free goal -> durable job -> workflow/workpool slice
  -> compact context -> checkpoint
  -> resume -> final artifact/wiki update
```

## Eval Cases

The typed catalog lives in `evals/professionalWorkflows.ts`.

| Case | Workflow | Primary Assertions |
|---|---|---|
| `gtm-pitchbook-company-match-enrich` | Match uploaded companies against PitchBook-style results | preserve CRM fields, cite source rows, flag ambiguous matches |
| `gtm-healthtech-sector-classification` | Classify healthtech/JPM/PitchBook company sectors | CellPayload evidence, needs_review for weak evidence, bulk `/free` checkpointing |
| `gtm-intent-classifier-golden` | Score query/company classification fixtures | allowed labels, macro-F1, cited reasons, ambiguity review |
| `gtm-amo-signal-scorer` | Apply AMO scoring rubric to company rows | allowed tier bands, evidence for non-unknown tiers, aggregate score consistency |
| `gtm-jpm-market-map-joins` | Join company/product/partnership workbook tabs | no entity conflation, cited joins, unknowns for missing fields |
| `gtm-sbb-one-column-extraction` | Segment one-column extracted content into entities | boundary accuracy, line-span evidence, malformed block review |
| `gtm-company-deep-report` | Produce a company brief from multi-sheet reports | clickable citations, conflict callouts, no private context leak |
| `gtm-pii-masking-and-public-private-boundary` | Summarize contact/event files safely | mask public PII, preserve private boundary, audit redaction |
| `finance-cost-reconciliation` | Reconcile model/vendor spend and output variances | skip correct cells, CAS-correct wrong cells, cite source rows |
| `finance-accountant-template-population` | Fill a fixed income/expense form from source transactions | preserve layout, cite mapped categories, flag unmapped categories |
| `finance-timesheet-invoice-review` | Review timecards/timesheets with formulas and merged layout | preserve formulas, detect exceptions, cite row evidence |
| `finance-transaction-activity-summary` | Summarize account/brokerage transaction exports | aggregate without line-item leakage, preserve signs/blanks |
| `eval-template-to-harness-run` | Convert NodeBench-style templates into harness cases | each case has state, task, tools, expected state, trace, budget |
| `eval-ui-action-execution-map` | Convert UI action mapping into browser/runtime checks | action, execution layer, artifact state, and trace checkpoints |
| `analytics-weighted-ranking` | Rank options with adjustable weights | update only dependent score/rank cells, cite weight set |
| `analytics-workout-progress-dashboard` | Join workout logs to exercise metadata | preserve unit semantics, avoid raw-log disclosure |
| `legacy-output-migration` | Migrate old generated outputs into room wiki | idempotent wiki sections, clickable source refs, public PII masking |

## Harness Engineering Lessons

- **Header detection is not enough.** Several workbooks have banners, merged
  cells, search-link rows, or multi-sheet layouts. The parser must identify the
  real data region and preserve coordinates.
- **Professional output must be evidence-bearing.** ENRICH, CLASSIFY, RESOLVE,
  RECONCILE, and REPORT writes should produce `CellPayload` values with source
  artifact id, row/column/page evidence, confidence, and status.
- **Raw files stay canonical.** Convex/NodeRoom artifact ids are the durable
  system of record. Provider file ids are cache metadata only.
- **PII is common.** Public summaries must avoid emails, phones, addresses,
  contact names, account identifiers, messages, and transaction details unless
  the actor and channel are authorized.
- **Formulas and merged cells need conservative mutation.** Formula cells should
  not be overwritten with scalar text by default; dependency-expanded locks
  should protect derived cells when parent inputs change.
- **Large sheets are context-engineering tests.** The 9,000+ row classification
  shape should run through chunking, semantic search, compaction, checkpoints,
  and resolved-model audit, not one giant prompt.
- **Interview-ready evals need outcome and trajectory checks.** A case passes
  only when the final artifact is correct and the trace proves safe reads,
  locks/CAS/drafts, evidence, privacy, and budget behavior.

## Production Support Map

| Requirement | Current NodeRoom Support | Next Deep Review |
|---|---|---|
| CSV/XLSX upload and view | Browser parser and artifact rendering | Convex File Storage as canonical raw-file backend for every upload |
| Spreadsheet semantic context | Cell/chunk/dependency index | Add fixture coverage for large sparse and multi-sheet workbooks |
| Evidence-bearing writes | `CellPayload`, provider parser adapter, research workflow tests | Require all production ENRICH/CLASSIFY/RESOLVE writes to use the same payload contract |
| Cross-file work | Multi-artifact tools and artifact refs | Add real redacted multi-file fixtures from PitchBook/ParselyFi shapes |
| Long-running free models | `/free` workflow/workpool slices, checkpoints, resolved model audit | Add bulk classification smoke with tiny slice budget and duplicate-slice test |
| Parser/OCR/layout | Provider-first parser adapter plus LiteParse fallback smoke | Add PDF/DOCX/PPTX/image OCR fixtures when those files are available |
| Wiki | Grounded update tool and self-updating wiki skill rules | Add agent-generated wiki run from professional fixtures |
| Privacy | Public/private room boundary and PII-aware eval cases | Add redaction tests for fake contact/event/transaction fixtures |

## Interview Notes

Use this language:

> I took real spreadsheet workflow evidence and converted it into a harness
> backlog. The important move is not committing private data. It is extracting
> the workflow shape: schema detection, source references, evidence-bearing
> writes, no-clobber mutation, privacy boundaries, long-running handoff, and
> eval assertions.

The strongest examples to discuss:

- GTM sales: PitchBook company matching and healthtech sector classification.
- Finance: cost reconciliation and timesheet/invoice review.
- Harness engineering: converting NodeBench eval templates into typed,
  trace-checked cases.
- Context engineering: making a 9,000+ row sheet work through semantic chunks,
  context compaction, and workflow checkpoints.

## Verification

Run the professional catalog checks:

```bash
npm test -- tests/professionalWorkflows.test.ts
```

Run the broader baseline:

```bash
npm run typecheck -- --pretty false
npm test
npm run ladder
```
