# Gaps Not Yet Done

Last updated: 2026-06-10

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
| Public GitHub readiness | Project has public-facing docs and `package.json` is marked non-private. The local folder was not a Git repo before release prep. | Initialize repo, ensure generated/local/private files stay ignored, add license, run a secret scan, publish public repository. | Public repo exists, no `.env.local`, logs, `node_modules`, `dist`, `.serena`, or local-only artifacts are tracked. |
| Convex deployment/codegen | Local Convex code is typechecked, but deployment/codegen has had analyzer fragility in past reviews. | Reproduce clean `npx convex codegen` and deployment smoke from a fresh checkout. | `npx convex codegen`, Convex typecheck, app typecheck, tests, and a live Convex smoke pass without manual edits. |
| Environment docs | `.env.example` exists. | Document required provider keys, Convex env vars, safe demo defaults, and production-only secrets. | A fresh contributor can run demo mode and knows exactly what is needed for live mode. |
| CI | Local checks have been run. | Add GitHub Actions for matrix validation, app typecheck, Convex typecheck, tests, ladder eval, and build. | CI passes on the first public branch from a clean clone. |
| Dependency audit | `npm install --package-lock-only` reports 13 current audit findings: 6 low, 6 moderate, 1 critical. | Triage whether each finding reaches shipped code, then upgrade or replace affected packages without breaking Convex, Vite, parser, and provider paths. | `npm audit` is clean or documented with accepted risk and compensating controls. |

## P0: Long-Running `/free` Reliability

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Atomic continuation | Jobs checkpoint and schedule follow-up slices. A crash between checkpoint and scheduling can still strand work unless watchdog coverage is proven. | Move next-slice scheduling into the same durable mutation or add a watchdog scanner over due jobs. | Forced crash-after-checkpoint test resumes without operator intervention. |
| Idempotent enqueue | `/free` can create durable job rows. | Prevent duplicate user clicks from creating duplicate final writes or duplicate billing paths. | Same room/request id enqueues once or dedupes safely. |
| Stale lease handling | Leases exist. | Prove two workers cannot both own the same slice result. | Duplicate scheduled slice with stale lease exits without writes. |
| Slice budget clamps | Budgeted slices exist. | Clamp model/tool budgets well under Convex action limits and reserve time for checkpointing. | Multi-slice test with tiny budgets completes through resume, not timeout. |
| Provider-step journal | Attempts are persisted. | Record provider call intents/results before and after external calls to avoid duplicate paid calls after crashes. | Crash-after-provider-call recovery does not call the provider again unless the previous call is marked retryable. |
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
| Audience-fluency proof artifacts | Audience context YAML, an affluent/private-investment episode brief, and a deterministic content-fluency gate exist. | Render the audience-specific episode from fixture data, run Gemini/video content review, and keep the trust-signal checklist in the generated QA matrix. | `npm run content:fluency:check` passes, the private-investment episode is rendered, and judge output verifies context accuracy, restraint, discretion, provenance, and proof quality. |

## Release Checklist

- Run `npm run qa:matrix:check`.
- Run `npm run typecheck -- --pretty false`.
- Run `npx tsc --noEmit --project convex/tsconfig.json --pretty false`.
- Run `npm test`.
- Run `npm run ladder`.
- Run `npm run build`.
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
