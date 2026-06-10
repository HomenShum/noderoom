# Audience workloads — persona-grounded usage and cost model

Research date: 2026-06-10. Method: six parallel research passes over current job descriptions,
day-in-the-life posts, event calendars, and 2025–26 industry reports (UBS GFO, RBC/Campden,
MLH season data), plus a Hacker News meta-analysis of real reported infrastructure bills.
These parameters drive `docs/OPERATING_BUDGET.md` and the deployment-cost comparisons.

## Workload parameters per persona

| Persona | Sessions/wk | Writes/session | Agent tasks/wk | Room size | Burst | Driving rhythm |
|---|---|---|---|---|---|---|
| Conference attendee | 1.2 (annualized) | 12 | 1.5 | 3 | **20×** | Near-dormant ~44 wk/yr; spikes around KubeCon/re:Invent windows (prep spreadsheet → mobile capture bursts → 24–48h team debrief) |
| Hackathon participant | 1 | 40 | 1.5 | 4 | **20×** | Zero baseline; 24–48h weekends of near-continuous 4-person co-editing + heavy AI delegation; MLH season Sept–Nov, Jan–Apr |
| Finance professional | 8 | **80** | 12 | 5 | 5× | Weekday business hours in spreadsheets; monthly close, quarterly earnings spikes; employer already pays $12–30k/seat for terminals |
| Founder | **18** | 25 | **22** | 4 | 6× | Daily power user (build/sell/recruit/investor updates); already stacks $20–40/mo AI subscriptions |
| Affluent / family office | 2.5 | 30 | 4 | 3 | 5× | Low frequency, high stakes: quarterly reviews, decision memos before meetings; price-insensitive, discretion-bound |
| GTM / sales | 6 | 30 | **20** | 5 | 4× | Daily prospecting + CRM hygiene, weekly pipeline reviews, quarter-end spikes; account research is the killer agent use |

**The structural split:** conference + hackathon are extreme-burst **free users** (distribution,
not revenue — MLH mandates free tooling); finance + founder + GTM + affluent are steady
**employer-paid users** (revenue) who also generate ~90% of the load.

## Scenario cost across deployment stacks

| | Event-led (500 MAU, burst-heavy) | Prosumer wedge (1k MAU, steady) | Team product (10k MAU) |
|---|---|---|---|
| Convex (current) | **$25/mo** (usage billing absorbs 20× spikes) | $50–90 | $400–1,000 |
| Vercel + Supabase | $45 | $70–150 | $400–900 + external agent worker |
| Vercel + PlanetScale + managed WS | $200–400 (**worst fit**: provisioned DB sized for peaks idles 44 wk/yr; per-connection realtime bills the spikes) | $250–500 | $900–2,000 |
| Cloudflare Durable Objects | $5–30 (burst-native) | $30–120 | $150–500, but you rebuild transactions/reactivity |

**The line that dwarfs infra:** LLM spend. At the prosumer-wedge mix, ~60k agent tasks/mo costs
$200–16,000/mo depending entirely on routing (v3-composite cheap routes vs premium). Infra is
5–15% of total spend — **model routing is the cost lever, not the database** (see
`docs/OPERATING_BUDGET.md`). With the v3 composite shape measured at $0.0034/task on
`deepseek-v4-flash`, the experiment envelope supports hundreds of power users.

## Bill-shock guardrails (from 16 real reported bills, HN meta-analysis)

- **No-cap platforms convert bugs into debt** (Firebase $72k in hours on a $7 budget; $100k in a
  day; Netlify $104k static-site bandwidth) → NodeRoom enforces per-slice / per-room-day / global
  monthly USD caps in code, armed on dev and prod.
- **The 2026 twist — agent-written infinite loops** (a Durable Object alarm loop burned $400/hr on
  a zero-user project) → spend caps + boundary review on every agent-facing change.
- **AI crawlers bill you with zero users** ($40–50/mo blogs with hundreds of human visitors) →
  keep marketing surfaces static/cached, separate from the app origin.
- **Repricing/renewal is a cost line** (Vercel indie $20→$500/mo with no traffic change; $40k→$120k
  enterprise renewal quote) → Convex's open-source backend is the credible exit path.
- **Per-connection realtime pricing punishes success** (Pusher-style $399/mo per 10k concurrents) →
  a structural reason the bolt-on-websockets stacks lose for this product.

## Per-event economics (the distribution play)

One 200-person hackathon ≈ 660k function calls (~$1.30 marginal on Convex) + $0 LLM on free
routes. A 500-attendee conference activation ≈ $40–200 total *only if* paid routes are enabled.
**Events cost tens of dollars, not thousands — run as many as possible.** The money is never in
the spike; it's in the founder/GTM/finance users the spike converts.
