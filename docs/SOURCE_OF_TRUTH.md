# NodeRoom — source of truth (design-intent ↔ repo reality)

One page. If a slide, README, or design note names something this table doesn't, the table wins.

**The wedge (one sentence):** NodeRoom is the live room where humans and AI agents do startup-banking diligence together — multiple people ask, multiple agents research with cited sources, findings stream into a shared sheet, **no write silently clobbers another**, and every agent change is traceable and reviewable.

## ✅ Source-of-truth landed (2026-06-14)
`src/nodeagent/**` is now the canonical source tree. The old `src/agent/**` tree was removed after the repo import graph moved to nodeagent, and the previous `src/shared/formulaEngine.ts` / `src/engine/semanticRebase.ts` entrypoints were folded into nodeagent-owned modules.

## Vocabulary reconciliation
Design-intent names now live in `src/nodeagent/**`. Convex remains the durable backend, but frontend code, tests, scripts, and evals should import nodeagent modules directly.

| Design-intent name | Repo reality | Status |
|---|---|---|
| `src/nodeagent/{core,models,skills,guardrails}` namespace | canonical implementation under `src/nodeagent/**` | aligned |
| **Pi Agent Core / pi-ai** runtime | custom `runAgent` loop in `src/nodeagent/core/runtime.ts` on the **AI SDK**, run inside a Convex `"use node"` action | aligned to repo reality |
| **Linkup** search SDK + `linkupLogs` | `src/nodeagent/skills/search/fetchSource.ts` — SSRF-hardened bounded URL fetch (https-only, private-IP reject, 5s/200KB caps, egress allowlist) | roadmap dep, current bounded fetch is live |
| OpenRouter **adaptive routing matrix** (extract/speed/deep/code tiers) | two env knobs — `AGENT_MODEL` (interactive) + `AGENT_RESEARCH_MODEL` (research, deepseek-v4-flash) + `openRouterFreeModels.ts` ranking | divergent naming — simpler reality, no formal matrix |
| MCP server exposing `nodeagent_*` tools | none — tools are guarded by Convex permissions + schema; `.mcp.json` has only the standard Convex MCP | absent — **do not build** (no consumer) |
| `.agent/` (AGENT.md / routing_matrix.json / rebase_rules.md) | truth lives in `src/nodeagent/models/prompts/systemPrompt.ts`, `src/nodeagent/skills/spreadsheet/cellMutator.ts`, and `docs/NODEAGENT_ARCHITECTURE.md` | absent — **do not create** (would duplicate + drift) |
| Convex Workflow + Workpool durable jobs | `@convex-dev/workflow` + `@convex-dev/workpool`, wired in `convex.config.ts` / `agentWorkflows.ts` / `agentJobs.ts` | **built + live-proven** |
| Formula engine | `src/nodeagent/core/formulaEngine.ts` (test-covered, imported by UI/engine) | **built + tested** |
| Semantic Rebase (Compare → Reason → Swap) | `SmartResolver` (`merge.ts`) + `drafts.mergeBlockedDrafts` (deterministic half). LLM resolver / durable packet tables / validators are **open**. | **built (deterministic) + target (LLM)** |
| Downstream connectors (Linear/Notion/Gmail/Slack/LinkedIn) + per-company auto-charts | none — shown as "ready-to-hand-off" cards only | **roadmap** (correctly labeled in deck + proof ledger) |

## What's real and strongest (don't undersell these)
- **No-clobber wedge** — per-cell CAS rejects stale writes as data; agent edits in review mode become host-approvable proposals; durable traces. Proven: `tests/noClobberWedge.test.ts` (sequenced) + live `e2e/three-user-collab.spec.ts`. **built + tested + live-proven.**
- **Finance 3-statement solve** — 5/5 on deepseek-v4-flash, all 13 checks, base/distractor/concurrent-edit. **built + tested + live-proven** — the strongest proof in the repo.
- **Professional-workflow runtime** — 21/21 GTM + finance catalog + 21/21 live-runtime with production locks + evidence. **built + tested + live-proven.**
- **Company deep-research loop** (`companyResearchPlan`) — per pending/stale row: read → `fetch_source` ×2 → source-backed CellPayload (evidence/confidence/freshness) → `needs_review` on weak sources, with duplicate-prevention upsert. **built + tested.**
- **Private streaming agent** — `convex/streaming.ts` + `/stream-private-reply` (token-by-token, persisted). **built + tested.** (Not public token streaming — do not claim that.)

## Authority docs (read these, in order)
1. [ARCHITECTURE.md](ARCHITECTURE.md) — layer map + the managed-write contract.
2. [NODEAGENT_ARCHITECTURE.md](NODEAGENT_ARCHITECTURE.md) / [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — the real `runAgent` harness.
3. [architecture/CONVEX_AS_LEDGER.md](architecture/CONVEX_AS_LEDGER.md) — Convex-as-ledger boundaries + B1/B2 scaling.
4. [AGENT_EVAL.md](AGENT_EVAL.md) — how the agent is evaluated (SpreadsheetBench · BankerToolBench · HALO · eval:diff gate).
5. [demo/STARTUP_DILIGENCE_PROOF_LEDGER.md](demo/STARTUP_DILIGENCE_PROOF_LEDGER.md) — the war-room claim ledger.
6. [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) · [GAPS_NOT_DONE.md](GAPS_NOT_DONE.md) · [WEDGE.md](WEDGE.md) — readiness, gaps, the frozen wedge.
7. [showcase/noderoom-diligence-deck.html](showcase/noderoom-diligence-deck.html) — the slide deck.

## Do NOT (the real, current guardrails)
- **Do not recreate legacy agent entrypoints.** New agent work belongs under `src/nodeagent/**`; legacy path reintroduction is blocked by `tests/nodeagentImportGuards.test.ts`.
- **Do not bypass Convex as the durable backend.** `src/nodeagent/**` owns the agent implementation surface; Convex still owns durable jobs, permissions, locks, writes, streams, and audit persistence.
- **Still genuine roadmap (do not build now):** 5 *live* OAuth connectors (Linear/Notion/Gmail/Slack/LinkedIn) — `downstreamPublish` prepares hand-off drafts, but live OAuth needs the user's accounts + creds · per-company auto-charting beyond the runway chart · a net-new spreadsheet runtime.

## Verification snapshot (2026-06-14 ~13:27 PDT)
`tests/nodeagentAlignment.test.ts` ✅ · `tests/nodeagentImportGuards.test.ts` ✅ · `tsc --noEmit` **0 errors** ✅ · production import graph on `src/nodeagent/**` ✅ · legacy migrated files removed ✅.
