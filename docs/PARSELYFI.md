# ParselyFi → NodeRoom: the Tabular Research Harness

**ParselyFi (2024)** was a Streamlit finance-data assistant: upload a spreadsheet of
companies, parse rows, review them, mark Pending/Complete/Skip, then batch-enrich the
pending ones with sourced research while tracking progress, token cost, and history.

**NodeRoom already rebuilt ParselyFi's hard parts on a safe agent runtime** — and the
parts ParselyFi held by hand in Streamlit `session_state` (cost, history, status) are now
durable, versioned, tamper-evident backend records. The takeaway was never "port 20
features"; it was: *ParselyFi was the workflow without rails; NodeBench is the rails;
NodeRoom is the workflow on the rails.*

## What was built (the one net-new wedge — all three parts)

The **Tabular Research Harness** — a company-research surface where the agent enriches
*pending* rows with *sourced* research, status-gated, through the same lock → CAS → release
contract, fully audited. It rides entirely on existing infra (engine, locks, per-element
CAS, traces, `agentRuns`, `agentSteps`).

| Wedge | What | Files |
|---|---|---|
| **Company surface** | a "Company research" sheet with account, website, status, tier, intent, owner, CRM status, summary, funding, headcount, recent signal, two sources, and freshness; a Research tab with paste/import, requeue, and CRM CSV export | `engine/demoRoom.ts`, `convex/seed.ts:seedResearch`, `ui/panels/Artifact.tsx:Research` |
| **Status + freshness state machine** | per-row `pending -> running -> complete`; completed rows persist, and `Requeue complete` flips them back to pending for re-research; each transition is CAS'd + locked + traced | `agent/plans.ts:companyResearchPlan`, `agent/context.ts:buildResearchContext` |
| **Multi-source enrichment** | a bounded `fetch_source` tool (SSRF-guarded, 5 s timeout, 200 KB cap); the agent cites only pages it actually fetched and writes both `source` and `source2` | `agent/tools.ts`, `convex/convexRoomTools.ts:fetchSource` |

The harness is **additive** — the snapshot grew a generic `cells` map and the runtime an
optional `contextBuilder`, so the variance demo + all prior tests stay green. Same `runAgent`
loop, same tools; only the context renderer + planner differ.

## Verified end-to-end

- **No-keys (scripted):** `tests/researchHarness.test.ts` — companies enriched, status
  pending->complete, `summary/funding/headcount/recent_signal` filled, `source` + `source2`
  populated, `last_researched` written, **no clobber**, one lock cycle per company; status-gated
  (complete rows skipped).
- **Fresh workflow evidence:** `docs/screenshots/live-research-*.png` captures pending rows,
  structured multi-field enrichment, two source links, freshness badges, BYO account paste,
  requeue, CRM CSV, and host proposal review. `docs/eval/pain-verdicts.json` is the Gemini
  multimodal judgment over those frames plus the L1-L6 ladder trace.

## Still out of scope
S3/Supabase file manager, binary file preview, multi-table dashboards, and credentialed
Salesforce/HubSpot push are still outside this spike. The current GTM handoff path is
paste/import plus CRM CSV export.

## Interview line
> ParselyFi taught me the spreadsheet/dataframe workflow; NodeBench taught me the agent
> runtime. NodeRoom is where they meet: a human drops in companies, the agent enriches the
> pending ones with sourced research through a lock→CAS→release contract, and every decision
> is cost-tracked, hash-chained, and replayable — the workflow, finally on rails.
