# Gaps Not Yet Done

Last updated: 2026-06-13

NodeRoom is production-shaped, but it is not yet fully production-proven. The
core harness exists: versioned room artifacts, bounded agent tools, lock/CAS
mutation, draft recovery, long-running `/free` job state, provider adapters,
artifact traces, a QA matrix, and professional workflow eval fixtures. The gaps
below are the remaining work needed before claiming full production scale for
GTM sales, finance, banker, and multi-file research workflows.

## Operating Principle

Do not claim a feature is production-complete until it has:

- a durable backend contract,
- a UI path a non-developer can operate,
- automated regression coverage,
- live or fixture-backed eval evidence,
- trace evidence for user-visible agent actions,
- security and privacy checks for public/private room boundaries,
- a rollback or recovery story.

## P0: Public Release And Deployment Proof

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Public GitHub readiness | Public repo, license, `.gitignore`, `package.json` non-private flag, README CTA, and CI now exist. | Run a clean-clone secret scan and verify ignored local artifacts remain untracked before each public release. | Public repo exists, no `.env.local`, logs, `node_modules`, `dist`, `.serena`, local-only artifacts, or generated scratch files are tracked. |
| Convex deployment/codegen | Local Convex code is typechecked and `_generated/api.d.ts` is committed, but deployment/codegen has had analyzer fragility in past reviews. | Reproduce clean `npx convex codegen` and deployment smoke from a fresh checkout. | `npx convex codegen`, Convex typecheck, app typecheck, tests, and a live Convex smoke pass without manual edits. |
| Environment docs | `.env.example` exists. | Document required provider keys, Convex env vars, safe demo defaults, and production-only secrets. | A fresh contributor can run demo mode and knows exactly what is needed for live mode. |
| CI | `.github/workflows/ci.yml` now runs QA matrix check, app typecheck, Convex typecheck, unit tests, deterministic ladder eval, and build on push/PR. | Add secret scanning, dependency-audit triage, and optional live-smoke gates with protected secrets. | CI passes from a clean clone and blocks stale QA docs or broken deterministic gates. |
| Dependency audit | `npm audit --omit=dev --json` currently reports 8 production findings: 6 low AI SDK provider-utils issues and 2 moderate ExcelJS/uuid issues; available fixes are semver-major or downgrade paths. | Triage whether each finding reaches shipped code, then upgrade, replace, isolate, or document accepted risk with compensating controls. | `npm audit` is clean or documented with accepted risk and compensating controls. |

## P0: Long-Running `/free` Reliability

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Atomic continuation | `/free` starts through `@convex-dev/workflow`/Workpool, interactive `/ask` pauses can start the same continuation runner, and legacy scheduler fallback remains for old jobs. | Prove a forced crash/cancel between checkpoint and continuation still resumes, including the legacy scheduler fallback path or a watchdog for due jobs. | Forced crash-after-checkpoint test resumes without operator intervention. |
| Idempotent enqueue | `agentJobs` and `agentRuns` idempotency keys exist and are covered by runtime/source tests. | Browser double-click/live retry smoke that proves no duplicate final writes or duplicate billing paths. | Same room/request id enqueues once or dedupes safely in the live UI. |
| Stale lease handling | Job slice leases are checked before `finishSlice`, with unit coverage. | Live duplicate-worker simulation at the workflow boundary. | Duplicate scheduled slice with stale lease exits without writes. |
| Slice budget clamps | Per-run/per-slice token and USD clamps exist with reserve time for checkpointing. | Live tiny-budget multi-slice smoke through Workflow/Workpool. | Multi-slice test with tiny budgets completes through resume, not timeout. |
| Provider-step journal | `agentModelStepJournal` records and replays completed model steps. | Adapter-level idempotency keys where providers support them, plus crash-before-record behavior documented as retryable. | Crash-after-provider-call recovery does not call the provider again when a completed response was journaled. |
| Model health/quarantine | Free-auto discovery and fallback exist. | Track latency, rate limits, failures, fallback count, and quarantine unhealthy free models. | Router avoids unhealthy free models and records why. |
| Live `/free` eval | Manual live ladder evidence exists. | Add a polling evaluator that starts a real `/free` job, polls attempts, and asserts terminal state plus trace evidence. | Live `openrouter/free-auto` smoke records resolved model, attempts, final artifact state, and no clobber. |

## P0: Files, Parser, OCR, And Evidence

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Canonical file storage | UI and agent workflows support files conceptually. | Every upload lands in Convex File Storage first. Provider file ids remain cache metadata only. | Raw file id is the durable artifact id; provider file id can be dropped and rebuilt. |
| File upload/view E2E | Spreadsheet and file references are part of the product story. | Browser E2E for upload, file list, click-to-view, drag file to chat, and agent reference selection. | User can upload, view, cite, and drag files into chat across public and private contexts. |
| Provider file adapters | Gemini/OpenAI/Claude/OpenRouter parser adapters exist as design direction. | Live binary upload/cache adapters for PDFs, DOCX/PPTX, images, screenshots, and spreadsheets. | Adapter returns structured evidence with provider id, file id, page/sheet/row/box metadata, and provenance. |
| Local parser lane | LiteParse dependency is installed. | Production worker lane for PDF, DOCX/PPTX, images, OCR, screenshots, layout, and bounding boxes. | Redacted fixture tests prove local extraction writes evidence-bearing artifacts without provider egress. |
| Evidence-bearing cells | `CellPayload` direction is established. | Ensure ENRICH/CLASSIFY/RESOLVE always writes value, status, confidence, source artifact, and citation/evidence. | Spreadsheet agent writes are never bare scalars in production workflows. |

## P0: Professional Workflow QA

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Official BankerToolBench / SpreadsheetBench readiness | A generated official-readiness report now tracks BankerToolBench, SpreadsheetBench V1, and SpreadsheetBench V2 contracts and is wired into HALO / `agent:improve`. SpreadsheetBench V1/V2 now have local official-bundle ingest with agent-facing inputs separated from evaluator-only gold/scorer metadata, plus a local workbook scorer that compares candidate workbooks to evaluator-only gold for values, formulas, and optional style fingerprints. Real smoke reports cover the V1 verified-400 bundle and V2 public example bundle. The gate still reports 0/3 ready by design. | Implement model execution/export sandboxing, workbook export/reopen packaging, full official formula/format/chart grading policy, BTB MCP tool adapters, Docker/Harbor execution, and weighted rubric scoring. | `npm run benchmark:official:readiness -- --strict` passes and at least one official adapter records model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables without answer lookup or evaluator mutation. |
| GTM sales workflows | Local CSV/XLSX corpus has been profiled and converted into eval backlog. | Row-level evals for company classification, enrichment, CRM preservation, source citation, and PII masking. | Fixture evals pass and one live provider smoke completes with trace evidence. |
| Finance/banker workflows | Finance and timesheet workbook shapes are identified. | Reconciliation evals for formulas, locked cells, source rows, rounding, and sensitive-value redaction. | Agent preserves formulas/layout and only writes bounded evidence-bearing cells. |
| Multi-file research | Cross-file workflow need is documented. | Eval for using several uploaded artifacts as context without leaking private files into room public traces. | Public/private source boundaries are asserted in tests. |
| QA matrix continuity | `docs/qa/production-matrix.json` and generated docs exist. | Require every new feature to append/update the QA matrix and generated README visualization. | CI fails if matrix docs are stale. |

## P1: UI Operations

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Job controls | Status chips exist. | Add cancel, manual retry, attempt details, latest resolved model, stop reason, next run time, duration, tokens/cost, and linked agent run. | A host can operate a long-running job without reading logs. |
| Auto-accept UX | Accept/reject proposal flow exists. | Host opt-in modal for auto-accept/accept-all, scoped to safe proposal classes, with remember-my-preference. | Auto-accept never applies blocked, stale, or policy-failed proposals. |
| Spreadsheet/agent interaction | Spreadsheet, trace, notes, and chat are wired. | Browser E2E for spreadsheet row selection -> ask agent -> proposed cells -> accept -> trace -> note/wiki reference. | Agent and spreadsheet remain synchronized under concurrent human edits. |
| June 2026 workroom shell | Binder -> Work Surface -> Copilot -> Signal Tape/Status Strip is implemented in the MVP shell; center-stage split mode now has memory-mode browser proof. Remaining work: richer binder click-throughs, live/Convex shell proof, Gemini UI judge proof, and status drilldown tests. | Add live browser specs, media judge walkthrough, richer binder source/proof/policy click-throughs, and status drilldown tests. | Browser specs prove binder navigation, center split source/proof mode, right-side Copilot steering, thin bottom status, no overflow, and no private-data leakage in ambient events. |
| Wall operations | Wall exists. | Create/delete/edit post-it E2E, including multi-user conflict handling. | Two users can create/delete without ghost posts or stale UI. |
| Resizable containers | Desired by user. | Persist panel widths per user/room and keep accessible keyboard reset. | Users can give more space to spreadsheet or chat without breaking layout. |

## P1: Workflow/Workpool Productionization

The scheduler path is acceptable as an MVP because it proves the state-machine
shape, but production should use a durable workflow/workpool layer once
deployment is clean.

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Workflow adapter | `@convex-dev/workflow` and `@convex-dev/workpool` are dependencies. | Wire a production adapter while keeping `agentJobs` as the user-facing system of record. | Workflow ids are runtime metadata; NodeRoom artifact/job ids remain durable. |
| Retry/backoff/concurrency | Basic attempts exist. | Centralize retry policy, concurrency limits, and crash recovery. | Backpressure protects providers and Convex while jobs still make progress. |
| Step journal | Attempts are persisted. | Durable per-step journal for model calls, tool calls, parser calls, and artifact commits. | Replays are explainable and exactly-once where side effects matter. |

## P1: Observability, Audit, And Retention

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Trace size limits | Traces exist, and a bounded telemetry-retention cron now prunes old `traces`, `agentSteps`, and `agentOperationEvents` without touching product data or spend ledgers. | Add per-run trace size caps, summarization/compaction for oversized payloads, and export hooks. | Long jobs do not bloat Convex documents or UI payloads, and retained/exported traces remain explainable. |
| Provider telemetry | Resolved model is recorded in key paths. | Track attempted models, final model, latency, token/cost, fallback count, error class, and retry reason. | Model routing decisions can be audited after the fact. |
| Provenance fields | Evidence direction exists. | Add `valueBefore`, `contextSnapshotRef`, `promptHash`, `modelVersion`, and `harnessVersion` where appropriate. | A disputed cell can be traced back to source, prompt, model, and room state. |
| SLO dashboard | QA matrix has visual docs. | Add operational dashboard for pass rate, p95 latency, job completion, provider health, and queue age. | Demo and production health are visible without opening logs. |

## P1: Security And Privacy

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Secret hygiene | `.gitignore` excludes local env and logs. | Run secret scan before every public push. | No provider keys or local tokens are committed. |
| Public/private boundaries | Product has public room and private agent lanes. | E2E tests for no private chat/file leakage into room trace, wiki, wall, or public artifacts. | Privacy boundary failures block release. |
| Provider egress policy | Provider parser adapters are planned. | Per-file/workflow routing policy: local-only, provider-allowed, redacted-provider, or blocked. | Sensitive files cannot be sent to external providers accidentally. |
| Upload abuse limits | Upload is part of product direction. | File type, size, count, scan, and rate limits. | Bad uploads fail safely and visibly. |

## P2: Agent-Generated Wiki And Documentation Loop

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Self-updating wiki | Deterministic wiki/update rules and skill docs exist. | LLM-backed wiki agent that updates only from room-visible evidence and preserves a fixed TOC. | Wiki update eval proves stable TOC, clickable artifact refs, and no private leakage. |
| Interview notes freshness | Interview notes and README are strong learning artifacts. | Keep new production lessons appended as the system evolves. | Every major harness/context engineering change updates README, interview notes, or the gap register. |
| Architecture diagram freshness | Architecture docs and diagrams exist. | Keep diagrams regenerated when provider/parser/job architecture changes. | README architecture stays accurate after code changes. |
| Audience-fluency proof artifacts | Audience context YAML, an affluent/private-investment episode brief, rendered episode, deterministic content-fluency gate, and Gemini media judge output exist. | Close current media-judge P1 defects, run trust-signal/content-fluency review, and keep the checklist in the generated QA matrix. | `npm run content:fluency:check` passes, media judge has no unresolved P0/P1 defects, and review output verifies context accuracy, restraint, discretion, provenance, and proof quality. |
| Demo/media evidence quality | Episode-level Gemini judges exist, and a batch media judge now covers README GIFs, workflow previews, and episode renders. | Run the batch judge after every capture/render refresh and feed P0/P1 findings into the QA matrix or gap register. | `npm run media:gemini-judge -- --all` produces a current `docs/eval/MEDIA_JUDGE.md` with no unresolved P0 media defects. |

## Release Checklist

- Run `npm run qa:matrix:check`.
- Run `npm run typecheck -- --pretty false`.
- Run `npx tsc --noEmit --project convex/tsconfig.json --pretty false`.
- Run `npm test`.
- Run `npm run ladder`.
- Run `npm run build`.
- Run `npm run media:gemini-judge -- --all` when walkthrough/demo media changes.
- Run `npm run benchmark:official:readiness`; require
  `npm run benchmark:official:readiness -- --strict` only when claiming
  BankerToolBench or SpreadsheetBench readiness.
- Run a secret scan excluding ignored local files.
- Verify public repo contents from a clean clone.
- Run a live Convex smoke before claiming production deployment.

## Summary Verdict

The most important remaining work is not adding more prompts. It is hardening
the harness around the model: durable workflow steps, atomic continuation,
file/provider evidence, public/private data boundaries, live evals, and
operator-facing job controls. Once those gates pass, NodeRoom can credibly claim
production-scale support for GTM sales, finance, banker, and multi-file research
workflows.
