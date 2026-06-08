# Production Guarantee Matrix

Generated from `docs/qa/production-matrix.json` on 2026-06-08.

**Release rule:** A feature is production-ready only when deterministic tests, live/backend smoke where applicable, traceability, privacy boundaries, and documented failure behavior are all present.

## Continuous Append Protocol

- Add one row to `features[]` for every new user-facing feature, agent tool, provider route, or production invariant.
- Keep old rows unless the feature is removed; update status and evidence instead of silently deleting history.
- Run `npm run qa:matrix` after editing the source, then `npm run qa:matrix:check` in CI to catch README/doc/SVG drift.
- Do not promote a live model route until the relevant ladder rungs pass in a live run and the result is recorded.

## Feature Matrix

| Area | Status | Claim | Production gate | Evidence | Next review |
|---|---|---|---|---|---|
| Files + spreadsheet | Yellow | Users can upload/view files and work with parsed spreadsheets in the same room. | Parser fixtures, provider parser adapter tests, live file preview smoke, and Convex raw-file canonicalization. | `tests/spreadsheetParser.test.ts`, `tests/providerParserAdapter.test.ts`, `docs/PROFESSIONAL_SPREADSHEET_WORKFLOWS.md` | Add live Convex File Storage upload/download E2E once deployment auth is finalized. |
| Public/private chat + agent | Green | Public chat, private chat, public room agent, and private agent route messages to the right scope. | Scope separation tests, room member proof, and browser smoke for public/private panels. | `tests/roomEngine.test.ts`, `tests/agentRuntime.test.ts`, `docs/AGENT_RUNTIME.md` | Add browser E2E for message routing once a Playwright harness is committed. |
| Trace + proposals | Green | Room trace supports approve/reject, host accept-all, and host-gated auto-accept with remembered consent. | Host-only controls, proposal resolution tests, UI consent modal, and no silent direct-write bypass. | `tests/roomEngine.test.ts`, `src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx` | Add audit assertion that accept-all records every accepted proposal id. |
| Research + ops workflows | Yellow | GTM, finance, parser, wiki, and cross-file operation workflows are covered by deterministic professional evals and live provider smoke. | Deterministic workflow evals pass, provider parser smoke is green, and model routes are ladder-gated before interactive promotion. | `tests/professionalWorkflows.test.ts`, `evals/professionalWorkflows.ts`, `docs/eval/live-provider-agent-ladder-2026-06-08.md` | Add dedicated live GTM and finance provider jobs with row-level trace assertions. |
| Notes + spreadsheet agent | Green | The agent can read spreadsheets, write notes/wiki updates, reconcile cells, and keep cross-artifact evidence links. | Cross-file RoomTools test, grounded wiki write test, and CAS conflict checks. | `tests/workflowEvals.test.ts`, `tests/wikiSkill.test.ts`, `docs/AGENT_WIKI.md` | Add LLM-generated wiki update eval with private-data leakage checks. |
| Wall | Green | Users can create and delete post-its through versioned room operations. | Create/delete operation tests and browser smoke for Wall tab. | `tests/roomEngine.test.ts`, `src/ui/panels/Artifact.tsx` | Add multi-user wall edit conflict browser test. |
| Multi-user production paths | Yellow | Multiple users can join, see reactive state, use public/private scopes, and avoid clobbering through locks/CAS/proposals/drafts. | Room auth proof, Convex codegen/typecheck, duplicate-operation idempotency, load/concurrency smoke, and deployment observability. | `tests/idempotencyRuntime.test.ts`, `tests/lockTtl.test.ts`, `docs/ARCHITECTURE.md` | Add concurrent browser/session load test and production SLO dashboard. |
| Long-running /free jobs | Yellow | Free-auto provider work can run as sliced jobs that checkpoint before platform limits and resume from durable state. | Forced multi-slice test, crash-after-checkpoint resume, duplicate stale lease rejection, and live /free smoke. | `tests/agentJobsSource.test.ts`, `docs/LONG_RUNNING_AGENTS.md`, `docs/eval/free-auto-ladder.md` | Add duplicate enqueue idempotency, stricter budget clamps, per-tool abort propagation, durable provider-step journaling, model health/quarantine, and real forced multi-slice Convex job-runner tests. |
| Provider parser | Green | Provider file/cache ids stay separate from Convex raw file ids while extraction writes evidence-bearing CellPayloads. | Adapter separation tests, live provider smoke, redacted errors, and artifact evidence checks. | `tests/providerParserAdapter.test.ts`, `tests/providerParserLive.test.ts`, `docs/STACK.md` | Add production provider Files API binary upload actions for PDFs/images/decks. |
| QA system | Green | The QA matrix, README cockpit, and visual graphs are generated from one appendable source of truth. | Matrix schema tests and qa:matrix --check drift detection. | `docs/qa/production-matrix.json`, `scripts/qa-matrix.ts`, `tests/qaMatrix.test.ts` | Require each new user-facing feature PR to append or update one matrix row. |

## Live Model Ladder Gate

Source: `docs/eval/live-provider-agent-ladder-2026-06-08.md`

Gate: Interactive collaboration routes must pass L1-L4 for lock/CAS/draft safety.

| Model route | Provider | L1 | L2 | L3 | L4 | Recommended use |
|---|---|---:|---:|---:|---:|---|
| `gemini-3.5-flash` | Gemini | PASS | PASS | PASS | PASS | eligible for interactive collaboration promotion after repeated runs |
| `gpt-5.4-mini` | OpenAI | PASS | PASS | FAIL | PASS | parser/read-only/background until conflict rung passes |
| `claude-haiku-4-5` | Anthropic | PASS | PASS | PASS | FAIL | parser/read-only/background until blocked-range rung passes |
| `openai/gpt-4o-mini` | OpenRouter | PASS | PASS | PASS | FAIL | parser/read-only/background until blocked-range rung passes |
| `gpt-5.4-nano` | OpenAI | PASS | FAIL | FAIL | FAIL | research benchmark winner candidate only when collaboration safety is not required |
| `gpt-5.4` | OpenAI | PASS | FAIL | PASS | PASS | requires rerun because L2 time-budget failure blocks promotion |

## Commands

```bash
npm run qa:matrix
npm run qa:matrix:check
npm run typecheck -- --pretty false
npx tsc --noEmit --project convex\tsconfig.json --pretty false
npm test
npm run ladder
npm run provider-parser:smoke
npm run build
```

## Visuals

![QA coverage graph](eval/qa-coverage.svg)

![Live model ladder graph](eval/model-ladder-matrix.svg)

