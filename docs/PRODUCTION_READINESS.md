<!-- Provenance: production-readiness audit + research/judge workflow wf_ac097fb8-b4d (2026-06-10),
     ground-truthed against the tree. The honest answer to "are we production-proven end to end?" -->

# Production readiness — gate by gate

"Production-proven end to end" is not a badge you self-award; it is a **per-gate** claim, and each
gate is only as proven as its strongest evidence. This matrix is the honest accounting: what is
**PROVEN** (a deterministic test exercises the failure mode), what is **IMPLEMENTED** (the control
ships but its proof needs a live deployment), and what still **NEEDS A LIVE AUDIT** (cannot be
settled in `convex-test` alone). NodeRoom is **live beta** until every NEEDS-LIVE-AUDIT row clears.

## Scope of this audit

This file covers the public-room production safety spine: no-clobber writes,
agent job reliability, public abuse controls, and deployment-only audit gates.
It does **not** claim that every product surface is production-complete. Broader
workflow gaps such as upload/view E2E, parser/OCR routing policy, resizable
panels, full browser privacy specs, professional spreadsheet eval expansion,
and SLO dashboards remain tracked in [`GAPS_NOT_DONE.md`](GAPS_NOT_DONE.md).

## Release gate status

`npm run prod:gate` is wired as a strict local release gate. It runs the
moderate-or-higher production dependency audit first, then QA matrix freshness,
content fluency, proof staleness, app and Convex typechecks, unit/runtime tests,
deterministic memory-mode browser product flows, and the production build.
`npm run prod:gate:live` adds the live Convex product gate, and
`npm run prod:gate:live:agent` adds the live provider-agent gate.

As of 2026-06-14, this gate is expected to fail at the dependency-audit step.
`npm audit --omit=dev --audit-level=moderate` reports 14 production advisories:
6 high, 2 moderate, and 6 low. The high/moderate set currently includes
Convex/esbuild and ExcelJS/uuid transitive advisories, with some fixes requiring
upstream releases or semver-major dependency work. Secret scanning also remains
a pre-release manual requirement until a dedicated scanner is added to the gate.

## Still open outside the core public-room gates

| Area | Status |
|---|---|
| Files, parser, OCR, and provider file cache adapters | Designed and partially tested; not yet fully live-audited across PDF, DOCX/PPTX, images, screenshots, OCR, layout, and bounding boxes. |
| Full browser E2E for every surface | Some browser specs exist; the red QA row stays until public/private chat, files, spreadsheet, wall, proposals, and job controls are covered together. |
| Long-running job operations | Workflow/Workpool continuation exists; operator controls, live `/free` polling evals, model quarantine, and provider request-idempotency hardening still need expansion. |
| Professional GTM/finance scale | Fixture catalog exists; more row-level evals and one live provider smoke per critical workflow are still needed. |
| Production observability | Retention exists; dashboards, trace export, trace-size caps, and SLO alerting are not yet complete. |

## The no-clobber spine — PROVEN

| Gate | Evidence |
|---|---|
| Per-element CAS (no silent overwrite) | `convex/artifacts.ts` `applyCellEditCore`; ladder L2/L3 + `tests/lockFencing.test.ts` |
| Affected-range locks, read-only for non-holders | `convex/locks.ts`; ladder L4 |
| Lease-epoch fencing (TTL < slice budget) + renewal | `convex/artifacts.ts`, `convex/lib.ts`; `tests/lockFencing.test.ts` (6/6) |
| Lock TTL janitor (status + session + smart-merge) | `convex/crons.ts` → `locks.sweepExpiredLocks`; tested |
| Host lock takeover (host-only) | `convex/locks.ts` `hostForceReleaseLock`; tested |
| Draft-for-merge / proposal review (host-gated approval, cross-room blocked) | `convex/artifacts.ts` `resolveProposal` (`requireActorProof` + host role) |
| Private-draft `ops` redaction (no cross-member leak) | `convex/rooms.ts` `full`; `tests/lockFencing.test.ts` |

## Core agent reliability — PROVEN offline

| Gate | Evidence |
|---|---|
| Durable slices + exactly-once journal (no double-bill on retry) | `tests/gatewayAndJournal.test.ts`, `tests/agentJobsRuntime.test.ts` |
| Idempotency (no concurrent double-run) | `tests/idempotencyRuntime.test.ts` |
| Per-run + per-slice token **and** USD spend ceilings | `src/nodeagent/core/runtime.ts` `priceStep` wired into `convex/agent.ts` + `agentJobRunner.ts`; `tests/gatewayAndJournal.test.ts` |
| Error-path handoff preserves unexecuted tool calls (resume-cursor integrity) | `src/nodeagent/core/runtime.ts`; `tests/gatewayAndJournal.test.ts` |
| PII/secret outbound redaction | `src/nodeagent/gateway.ts`; tested |

These are offline or deterministic proofs of the core mechanisms. They do not
replace live provider/load evidence for OpenRouter data policy, high-concurrency
lease races, cron SLA, or public abuse behavior under real traffic.

## Abuse & safety surface (public, anonymously-joinable) — PROVEN

| Gate | Evidence |
|---|---|
| **Prompt injection** — room content reaches the model as fenced DATA, never instructions; forged fence-close neutralized | `src/nodeagent/core/worldModel.ts` `fenceUntrusted` + `systemPrompt.ts` TRUST BOUNDARY; `tests/promptInjection.test.ts` (4/4, incl. a behavioral "agent touches only its target despite a hostile sibling cell") |
| **Join rate limit + member cap** (10 joins/min sliding, 32 members/room) | `convex/rooms.ts` |
| **Room-code entropy floor** (server-enforced `[A-Z0-9]{6,12}`, ≈2.2B space) | `convex/rooms.ts` |
| **Cumulative daily USD cap per room** (bounds the SUM across `/ask` runs, not just one run) | `convex/agentRuns.ts` `roomSpendSince` + gate in `convex/agent.ts`; `tests/productionGates.test.ts` |
| **Global monthly USD cap with breach attribution** (`GLOBAL_MAX_USD_PER_MONTH`, default $75 — the $100-experiment gate; the breach error reports distinct rooms so it self-diagnoses as growth vs runaway; bounded read fails closed on truncation) | `convex/agentRuns.ts` `globalSpendSince` + gate in `convex/agent.ts`; `tests/productionGates.test.ts`; env armed on dev **and** prod (`0.50`/slice, `$3`/room-day, `$75`/month) |
| **Live entry/create/join/leave recovery** | `e2e/live-entry.backend.spec.ts` creates a room, verifies starter sheet/note/wall, joins by code, leaves back to the entry screen, and checks duplicate-create / missing-room errors. |
| **Telemetry retention** (traces/agentSteps/operation-events pruned past the window, product data untouched) | `convex/retention.ts` + `convex/crons.ts`; `tests/productionGates.test.ts` |
| Field-length caps (name/title) | `convex/rooms.ts` |

## IMPLEMENTED — control ships, proof needs the live deployment

| Gate | What ships | Why not yet PROVEN |
|---|---|---|
| Free-route data-policy filter | `OPENROUTER_REQUIRE_NO_TRAINING=1` excludes routes that *declare* training (`src/nodeagent/models/openRouterFreeModels.ts` `permitsTraining`) | Whether OpenRouter reliably exposes a per-model training flag — and honors it — is **unconfirmed**. The recommended `.env.example` value is on, while the code default remains off so existing deployments do not silently filter every model if the field is missing. Confirm with OpenRouter, then prove with a live provider audit. |

## NEEDS A LIVE AUDIT — cannot be settled offline

1. **OpenRouter's actual data policy** — confirm the `/free` lane's providers honor a no-training flag; until then the README privacy note (keep sensitive data out of `/free`) is the real control.
2. **Rate-limiting under real concurrency** — Convex doesn't expose client IP, so the cap keys on actor/room; a load test on staging (many concurrent anon joins) must confirm buckets hold.
3. **Cost-injection under live models** — a hostile prompt ("emit 250k tokens") is bounded by the per-run cap, but the cumulative daily cap needs a live run to confirm it trips.
4. **Lock fencing under high concurrency** — 100+ agents racing the same lock at the 5-min TTL boundary needs a load test, not just the isolated unit proofs.
5. **Cron SLA** — the retention + janitor crons assume reliable execution; production must monitor success + alert on a missed run.

## Bottom line

Every gate that *can* be proven offline **is** proven (tests above). The remaining work to retire
"beta" is a live security audit + load test of the five rows in the last section — not new
features. When those clear, this file's header line is the only thing that changes.
