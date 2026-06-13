# Why NodeAgent — Design Rationale, Trade-offs, and the Self-Improving Loop

> The companion "why" to [`NODEAGENT_ARCHITECTURE.md`](./NODEAGENT_ARCHITECTURE.md) (the "what") and
> [`LONG_RUNNING_AGENTS.md`](./LONG_RUNNING_AGENTS.md) (the durability mechanics). This doc exists so
> that a reviewer — human or a coding agent (Codex / Claude Code) — can understand *every* decision
> from first principles, see how it differs from the past projects, and see how the system improves
> itself without a team.

---

## 0. The thesis in one sentence

**NodeAgent is a server-side, durable, self-improving agent for multi-user rooms: every change goes
through a Convex mutation with a permission check, a version check, a receipt, and a hash-chained
trace — so the work is safe, auditable, and *replayable*; and because it is replayable, the agent
improves its own harness from real traces via HALO and a coding agent.**

Everything below is a consequence of that sentence.

---

## 1. The founder constraint that forces the whole design

This is built by one person. Two facts follow, and they drive every choice:

1. **A solo founder cannot hand-verify every trace for every professional workflow.** An IB diligence
   run, a GTM enrichment, a middle-market credit memo, a corporate-finance variance reconciliation —
   each produces dozens of tool calls. One person cannot read them all, every day, forever.
2. **But those workflows are *researchable online.*** Interview-prep guides, job descriptions, and
   tutorials for IB analysts, GTM/sales ops, middle-market banking, marketing, and corporate-finance
   analysts *are the public spec* for what "good" looks like. The internet is the subject-matter
   expert.

So the system has exactly two jobs that a solo founder cannot do by hand but a machine can:

- **Make every run auditable without a human reading it** → the trace substrate (ledger + receipts +
  hash-chained steps).
- **Turn a researched workflow into an eval, then self-improve against it** → the HALO loop.

The trace substrate + the HALO loop is *the only way one person ships professional-grade agent
workflows across many domains.* The internet is the SME, the eval is the contract, the loop is the
labor.

---

## 2. Every "Why" (each architecture decision, from first principles)

Each entry: **the choice → the why → the trade-off → what it fixes vs a past project.**

### Why Convex (not Streamlit, not a client GraphStore)
- **Why.** The product is *multi-user, real-time, durable.* Convex gives reactive sync (clients
  subscribe to queries and update automatically), server-owned state, and transactional mutations in
  one runtime. You write progress to tables; the UI catches up by itself — no hand-rolled
  websocket/SSE reconnection logic.
- **Trade-off.** A 10-minute hard cap on actions, and a strict mutation/action split you must design
  around (see ping-pong). You trade raw flexibility for durability + reactivity you'd otherwise build
  by hand.
- **vs ParselyFi (Streamlit).** Streamlit re-runs the whole script on every interaction; state lives
  in `st.session_state`; it is single-user and not durable. Great for a batch dataframe tool, wrong
  for a shared room where two people and an agent edit the same cell at the same time.
- **vs a Next.js + SSE client GraphStore.** That engine kept the graph **on the client** and
  streamed agent steps over SSE. SSE is a one-way transcript; reconnection, multi-user reconciliation,
  and durability were all manual. Convex makes the *server row* the source of truth and the network
  layer disappears.

### Why server-side mutations, never `client_action`
- **Why.** In the client-side GraphStore engine the agent emitted `client_action` events and the **browser applied
  them to the local graph.** That makes the client the command executor — which breaks the moment you
  have (a) two clients, (b) a refresh mid-run, or (c) an audit requirement. In NodeRoom the browser
  only *submits intent and subscribes to durable state*; the executor is Convex.
- **Trade-off.** Slightly more latency per write (a server round-trip) vs a local optimistic apply.
  We buy that back with optimistic UI *for human edits only* (below).
- **What it fixes.** No "the server assumed the client applied the change" class of bug; the canonical
  rows are always the truth.

### Why the action↔mutation "ping-pong"
- **Why.** Convex mutations are deterministic + transactional but cannot call models/networks; actions
  can call models but are *not* transaction boundaries and are capped at 10 minutes. So the loop
  alternates: `mutation (state) → action (model/tools) → mutation (state)`, yielding after each slice.
- **Trade-off.** More moving parts than one long `for` loop. You get durability + a 10-min-proof
  long-running agent in exchange.
- **What it fixes.** A monolithic 11-minute action gets killed with all progress lost. The ping-pong
  makes a 40-minute job into five ~8.5-minute slices, each checkpointed. **We don't beat the 10-min
  limit; we design around it.**

### Why one `agentJobs` contract (unify interactive `/ask` and background `/free`)
- **Why.** *Any* job can become long-running — a public `/ask` can hit a deadline, a notebook
  restructuring can touch hundreds of nodes, a wiki refresh can parse files. The UI should not care
  whether the first slice finished or checkpointed. One durable job contract; the fast path just
  completes in slice 1.
- **Trade-off.** Even a 2-second answer pays for a durable job row. Worth it: one lifecycle, one
  audit shape, one place the HALO loop reads.

### Why CAS + "conflict-as-data" (the no-silent-clobber spine)
- **Why.** Humans and the agent edit the same cells concurrently. Convex's OCC retries a *write race*
  but happily commits a write whose **baseline is stale** — that's the clobber. So every write checks
  `baseVersion`; a stale write returns `{ conflict: true, actual }` **as a tool result, not an
  exception**, and the model re-reads and retries.
- **Trade-off.** The agent must thread versions and handle conflicts (more prompt + tool surface).
  That discipline *is* the product's safety guarantee.
- **What it fixes.** The single most important function in the system (`applyAgentCellEdit`) makes
  "no silent clobber" true for agent *and* human edits through the same path.

### Why coordinate-level leases, not document locks
- **Why.** Locking a whole sheet or wiki for a multi-minute agent job destroys collaboration — every
  human keystroke would collide and roll back. Instead we lease only the *specific* coordinates the
  agent touches (cell `B2`, wiki block `b_3`, range `A1:B10`), with a TTL so a crashed holder can't
  block a cell forever.
- **Trade-off.** A second conflict-control concept beside the lock tool (to be reconciled — see the
  open question in `NODEAGENT_ARCHITECTURE.md`). The payoff is real concurrent human+agent editing.

### Why draft-first + approval for risky operations
- **Why.** The model is non-deterministic and the state is shared. Moving/deleting many nodes,
  changing public visibility, or writing a wiki page from mixed public/private evidence should never
  auto-commit. Those tools write a *draft operation* and the job waits for a host/owner; the apply
  mutation re-checks versions (if the baseline diverged, the draft needs rebase, not a blind write).
- **Trade-off.** Latency + a human in the loop for high-risk ops. Correct: high blast-radius changes
  earn a review.

### Why the operation ledger + hash-chained steps (the replayability that powers HALO)
- **Why.** Three reasons, and the third is the whole point:
  1. **Countability** — every action/query/mutation/model/tool/scheduler ping writes an
     `agentOperationEvents` row, so the system can answer "how many pings did this job cost?" without
     parsing prose logs.
  2. **Tamper-evidence** — `agentSteps` are hash-chained (`recordHash`/`prevStepHash`), so a trace
     can't be silently rewritten.
  3. **Replayability** — each step records the *tool-registry version* it ran under, so an eval (and
     a coding agent) can replay exactly what the model was allowed to do. **This is the HALO input.**
- **Trade-off.** Write amplification (many ledger rows per job). Mitigation: counters always
  increment; full payloads are hashed/sampled above a threshold; the loop reads *failures*, not every
  op.

### Why idempotency (`claimOrReuse`)
- **Why.** A double-clicked "Enrich" or a client retry must not launch a *second* concurrent run that
  races the first's CAS/locks and double-bills. An **atomic** claim-or-reuse mutation (one
  serializable transaction) makes the second submit attach to the first run instead of starting a new
  one — no TOCTOU window.
- **Trade-off.** A deterministic key + an index. Cheap insurance against a real correctness + cost
  hole.

### Why the eval ladder (L1–L6) + workflow evals + judge
- **Why.** "Good" must be *deterministic and re-runnable*, or the agent can't be safely auto-improved.
  The L1–L6 ladder grades the collaboration primitive (read → CAS → draft → no-clobber → range →
  long-horizon); the workflow evals grade real product flows (GTM enrich, parser extract, cross-file,
  wiki, finance reconcile); the LLM judge grades semantic quality with grounding. Together they are
  **the regression ratchet** — every fixed failure becomes a permanent eval, so the system can never
  regress on it.
- **Trade-off.** Maintaining the suite. It is also the thing that makes self-modification *safe*.

### Why the free-auto durable background path
- **Why.** Free routes are slow AND not uniformly correct — match the recorded evidence, not the
  flattering memory: the first live ladder run (`docs/eval/free-auto-ladder.md`) had the router alias
  pass L1–L3 with escalating 20–100s+ latency and TIMEOUT on L4; the current QA matrix (README,
  generated) records the alias at **L3 FAIL + L4 TIMEOUT**, while expanded top *concrete* free
  candidates do pass L3. So free-auto is *wrong* as the live collaboration default on both latency and
  correctness grounds — but *right* as a budgeted, resumable **background worker** whose per-rung
  results are re-verified by the ladder, per concrete route, not assumed from the alias. Fast paid
  models stay the interactive default.
- **Trade-off.** Two model lanes to reason about. The honest framing: don't make free-auto fast,
  make it *durable.*

### Why HALO self-improvement (the meta-why)
- **Why.** You can't train the model — you rent it. The only place you compound is the **harness**
  (prompts, tool registry, leases, compaction, validators, budgets), which is also where most failures
  live. And a solo founder can't read traces. So the coding agent (Codex / Claude Code) becomes the
  headcount: it diagnoses harness-level failures from traces and implements the fix, gated by the
  eval ratchet.
- **Trade-off.** A self-modifying agent is a footgun without guardrails (§5). With the regression gate
  + hard gates, it's a flywheel.

- **HyperAgents boundary.** HyperAgents-style systems add a meta-agent/task-agent generate loop and
  parent/variant selection. NodeRoom now borrows that measurable part without borrowing the unsafe
  part: `npm run halo:self-improve:smoke` repeats deterministic runtime cases N=5, `npm run
  halo:variant:select` scores competing harness variants and writes `selectedParent`, `npm run
  halo:convex-context:smoke` mirrors real Convex job context into the same metric shape, and `npm run
  halo:live-path:calibrate` records live provider path thresholds. Code edits still go through Codex,
  tests, the architecture budget, commit-message path coverage, and review; arbitrary model-generated
  code is not executed as product truth.

---

## 3. Live collaboration: NodeRoom (Convex) vs the past projects

| Dimension | ParselyFi (Streamlit) | Client-side GraphStore (Next.js + SSE) | **NodeRoom (Convex)** |
|---|---|---|---|
| Users | single-user | mostly single-user (client-local graph) | **multi-user rooms, public + private** |
| State owner | `st.session_state` (ephemeral) | the **browser** (local graph) | **server (Convex tables) = source of truth** |
| Network | request/response re-run | one-way **SSE** transcript | **reactive query subscriptions (auto-sync)** |
| Agent executor | a batch LLM pass over rows | the **client** applies `client_action` graph cmds | **Convex mutations** (client only submits intent) |
| Concurrency | none (one user) | last-write-wins, client-side | **per-cell CAS + conflict-as-data + coordinate leases** |
| Durability | none | SSE transcript only | **durable job + slices + checkpoints (10-min-proof)** |
| Long-running | a blocking batch | a single streamed loop | **`agentJobs` ping-pong via `@convex-dev/workflow`** |
| Audit | none | local graph memory nodes | **operation ledger + receipts + hash-chained steps** |
| Self-improvement | manual | manual | **HALO loop → Codex/Claude Code, eval-gated** |

The throughline: **ParselyFi proved the *workflows* (dataframe enrichment, entity resolution,
reconciliation). The client-side graph prototype proved the *graph vocabulary*
(nodes, relations, relation types). NodeRoom keeps both but moves execution to a
server-authoritative, durable, auditable, *self-improving*
Convex engine** — because that's the only shape that survives multiple users, the 10-minute cap, and a
team of one.

---

## 4. The HALO self-improvement loop — and how the Codex / Claude Code handoff works

HALO (Hierarchical Agent Loop Optimization) improves the *harness from execution traces*. NodeRoom
already owns the two expensive halves (the trace substrate and the eval/judge gate); the loop is three
connectors on top.

> **Already in the repo:** `npm run agent:improve` is the runner (deterministic, plus `--live` /
> `--full-live` / `--ui-media` lanes) — see the README "Agent improvement loop" section and
> [`eval/agent-improvement-loop.md`](./eval/agent-improvement-loop.md). **This doc is the *why*
> behind that runner**: the rationale for every decision the loop depends on.

```
                      ┌──────────────────────────────────────────────────────────┐
                      │                     THE NODEAGENT HALO LOOP                │
                      └──────────────────────────────────────────────────────────┘

 (research)   deep-research a professional workflow online  ─┐   IB diligence · GTM sales · MM banking
              (JD / interview-prep / tutorial → rubric)      │   · corp-finance variance · marketing
                                                             ▼
 (run)        agentJobs run (prod) + evals/ladder + workflow evals
                                                             │
 (trace)      agentOperationEvents (countable) + agentSteps (hash-chained, registry-versioned)
              + agentRuns/agentJobAttempts (resolvedModel, stopReason, tokens, cost, ms) + receipts
                                                             │
 (feedback)   3 sources:  Traces  +  Human (agentFeedback 👍/👎/correction)  +  LLM judge score
                                                             │
 (eval-gen)   failures + corrections  ──LLM──▶  new eval candidates (persona+goal+boolean checks)
              with confidence: candidate | research_validated | contested | human_verified
              and gateMode: none | advisory | blocking
                                                             │
 (arch-fit)   decide whether existing Convex queries/actions/mutations, tools, prompts, or harnesses
              already handle the workflow before adding code
                                                             │
 (diagnose)   HALO pass: cluster recurring HARNESS-level failures over recent failed traces,
              rank changes (prompt / tool registry / lease / compaction / budget)
                                                             │
 (handoff)    write  halo_handoff.md  (see format below)
                                                             ▼
 (implement)  spawn Codex (codex-rescue, gpt-5.5/xhigh)  OR  Claude Code  on a branch
                                                             │
 (re-gate)    re-run L1–L6 ladder + workflow evals + CI (Typecheck/Runtime smoke/Build)
                                                             │
 (decide)     green + target metric improved → keep/merge ;  any regression → revert ;  log to ledger
                                                             │
                                                             └────────────────▶  loop
```

### Why this is *traceable* for self-eval / self-diagnose / self-handoff
The handoff only works because every job is a **replayable trace**: `agentSteps` (what the model
tried) + `agentOperationEvents` (every infra ping) + the **tool-registry version** each step ran under
+ `agentMutationReceipts` (before/after versions). A coding agent can therefore *reproduce the exact
failing run*, not guess from prose. That is the property the whole substrate exists to provide.

### The `halo_handoff.md` contract (what Codex / Claude Code receives)
A handoff must be self-contained so the coding agent needs nothing but the repo + this file:

```md
# HALO handoff — <date> — target: <one harness change>

## Failure (grounded)
- eval/job: <ladder L6 | workflow:finance | job:abc123>
- failing trace: <agentSteps ids / ladder run log path>  (verbatim, not summarized)
- observed: <e.g. "L6 0/3 — compaction drops the read-before-edit invariant at step 14">

## Ranked change (the ONE thing to do)
- harness target: <src/agent/systemPrompt.ts | tools.ts registry | compaction.ts | budget>
- proposed diff intent: <specific, e.g. "add an explicit read-immediately-before-edit instruction
  to the long-horizon section; keep all other instructions byte-identical">
- why it should work: <cites the failing step>

## Validation (the gate — non-negotiable)
- MUST pass:  npm run typecheck  &&  npx tsc -p convex  &&  npx vitest run  &&  npx tsx evals/ladder.ts
- target metric:  L6 majority-vote 0/3 → ≥2/3, no regression on L1–L5 or the 5 workflow evals
- if any check is red → revert the branch; do NOT merge.

## Hard gates (propose-only — never auto-apply)
- honesty contract (HONEST_STATUS/SCORES), auth, billing, data deletion, the lock/CAS/draft no-clobber path
```

### Continuous workflow expansion (research → eval → implement → loop)
This is how one founder ships IB-grade *and* GTM-grade *and* MM-banking-grade workflows:

1. **Research** the workflow online (the deep-research harness): pull the JD / interview-prep / tutorial,
   extract the *rubric* — what a good analyst actually produces (a credit memo's sections, a diligence
   red-flag list, a GTM account-tiering logic, a variance bridge), and record where sources disagree.
2. **Analyze architecture fit before evals.** Ask whether existing Convex queries/actions/mutations,
   agent tools, prompts, validators, and harnesses can already do the workflow. If yes, write the eval
   against the current architecture. If no, name the missing smallest piece.
3. **Generate eval candidates** from the rubric (persona + goal + deterministic boolean checks) with an
   explicit confidence level: `candidate`, `research_validated`, `contested`, or `human_verified`.
   Enforcement is separate: `gateMode` is `none`, `advisory`, or `blocking`.
4. **Run** the agent against them; the judge + boolean checks score it; failures feed HALO only when
   the eval is trusted enough for that purpose.
5. **Implement** the smallest harness change (new composite tool, prompt section, validator, or mutation
   path) via the coding agent only if existing versions cannot handle the case.
6. **Re-gate** and, if green, the workflow **joins the library**. The library grows itself.

The internet supplies the spec, the eval supplies the contract, the loop supplies the labor.

---

## 5. The guardrails that make self-modification safe (non-negotiable)

A self-improving agent without these is a liability, not a flywheel:

- **The regression gate is the kill switch.** A harness change merges only if the *full* ladder +
  workflow evals + CI pass. HALO *proposes*; the coding agent *implements on a branch*; the gate
  *decides*. **Never auto-merge a harness change to prod.**
- **Hard-gated forever.** The honesty contract (`HONEST_STATUS`/`HONEST_SCORES`), auth, billing, data
  deletion, and the lock/CAS/draft no-clobber path are **propose-only** — a human approves. The loop
  tunes prompts/tools/context/budgets, *not* the safety spine.
- **Anti-Goodhart.** Auto-generated evals are not trusted just because they run. They start as
  candidates, become research-validated when backed by sources, stay contested when credible sources
  disagree, and only active gates can block merges. The loop may never weaken an eval or a score to
  "pass."
- **Bounded cadence + kill criteria.** Cap harness changes/day; stop after K consecutive
  no-improvement rounds and escalate (per `scripts/improvement-loop/` + the `self_improvement_loop`
  rule).

---

## 6. The core product sentence (carry this into any review or interview)

> NodeAgent is a server-side job engine for rooms. It works across notebooks, wiki pages, spreadsheets,
> and files, but **every durable change passes through a Convex mutation with permission checks, version
> checks, receipts, and traces.** Fast jobs and long jobs share the same `agentJobs` contract — the only
> difference is whether the first slice completes or checkpoints. And because every run is a replayable
> trace, the agent improves its own harness from real failures via HALO and a coding agent, gated by an
> eval ratchet that can never silently regress.
