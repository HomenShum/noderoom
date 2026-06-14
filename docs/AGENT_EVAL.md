# NodeRoom agent evaluation

Read this before you explain how we know the agent is *correct*, not just *working*. The harness in `docs/AGENT_RUNTIME.md` defines the contract; this defines how we hold it to that contract Ã¢â‚¬â€ deterministically, in CI.

The one thing this whole framework exists to protect: **a human or another agent is never silently clobbered.** Everything below is in service of making that measurable and keeping it at 1.0.

It's runnable:

```
npm run eval          # the golden suite, scripted model (deterministic, no keys)
npm run eval:real     # the same suite against the real Anthropic model
```

Professional workflow evals are tracked separately in
`docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md` and
`evals/professionalWorkflows.ts`. That suite converts real reviewed CSV/XLSX
workflow shapes into redacted GTM, finance, parsing, wiki, and long-running
cases without committing private rows. Private gold packs such as the
three-statement modeling test run only when the local workbook path is provided.
Not every feature starts with a file: the same suite now tracks `chat_only`,
`upload`, `selected_artifact`, `mixed_room_state`, and `external_retrieval`
intake modes so a user can start from a sentence in chat, a selected artifact,
or a room full of existing context Ã¢â‚¬â€ plus `pasted_content` for forwarded
emails/transcripts, whose claims carry `quoted_third_party` provenance, below
user-said. Every intake mode now has at least one declaring case (enforced by
test), and every chat-started case declares an output contract (which surface
the result lands on; person facts private-by-default). The proof boundary is
mechanical: `evals/harnessStatus.ts` maps each harness requirement to a real
entry point or an honest `contract` status, while
`evals/professionalCatalogProofs.ts` verifies every catalog case has intake,
output-surface, provenance, trajectory, privacy/long-running/private-gold, and
requirement-evidence checks. Current deterministic catalog proof is 21/21 with 0 unproofed cases (`npm run eval:professional:catalog-proofs`). Current live-provider catalog proof is also 21/21 for `deepseek/deepseek-v4-flash` (`npm run eval:professional:live-catalog -- --real deepseek/deepseek-v4-flash --require-full`). Current live-provider runtime smoke is 21/21 through `PRODUCTION_ROOM_TOOLS` and runtime-managed locks (`npm run eval:professional:live-runtime -- --strict`). The proof ledger separates that runtime execution from deeper domain blockers: 5 cases are full `live_provider`, 16 are `partial_live_provider`, and 0 remain catalog-only.

The live company-research benchmark is a separate router/cost harness:

```bash
npm run benchmark -- nex-agi/nex-n2-pro:free,ibm-granite/granite-4.1-8b,deepseek/deepseek-v4-flash,z-ai/glm-4.7-flash --no-merge --companies=1 --model-timeout-ms=120000 --model-reserve-ms=10000 --row-hard-timeout-ms=150000
npm run benchmark:charts
```

The supported route bakeoff is generated from a route/scenario registry:

```bash
npm run eval:model-matrix -- --json-out docs/eval/model-eval-matrix-plan.json
npm run eval:model-matrix:live
npm run eval:finance-model
npm run eval:finance-model -- --gold "C:\path\to\modeling-test.xlsx"
```

`docs/eval/MODEL_EVAL_MATRIX.md` defines the supported OpenRouter/native routes
and the scenario split: v3 research synthesis plus L1-L7 collaboration safety.
Passing one lane is not promotion for the other lane. New feature evals are
ranked in `docs/eval/FEATURE_EVAL_BACKLOG.md` and must earn a route proof before
they become product claims.

Its current verified artifact is `docs/eval/results.json`
(`company-research-v3-composite-synthesis`). It records route snapshots,
pricing-at-run, failure ownership, and per-row trace refs
(`docs/eval/traces/benchmark/`). v3 is a **two-call composite**: the harness's
`fetch_row_sources` owns lock/fetch and returns fenced snippets, the model
synthesizes the research fields in its own words, and `write_row` validates
with zod and owns CAS writes/citations/freshness/status/release. A content
floor in `STRUCTURED_FIELDS` rejects disclaimer-shaped non-answers and
from-memory text with no derivation from the fetched evidence Ã¢â‚¬â€ the two
strategies that gamed earlier generations (v2's "9/9" was a deterministic
template grading itself and was invalidated on review; see the README's
"Why v3 exists"). Latest verified v3 run: a 2026-06-11 OpenRouter cheap/free
catalog smoke attempted 28 current tool-capable free or very low-cost routes;
18 cleared 9/9. Fastest free clearer was `nex-agi/nex-n2-pro:free` at $0 and
6.2s; cheapest paid clearer was `ibm-granite/granite-4.1-8b` at $0.0009.
Treat a 9/9 as proof for the background research workflow only. Interactive
collaboration still needs the L1-L7
lock/CAS/draft ladder below Ã¢â‚¬â€ L7 (RESUME) is the rung that gates checkpointed
background jobs: a forced slice death mid-task, a human revision landing while
the agent is dead, and a cold-context continuation that must finish only the
remaining targets without touching completed or human-revised cells.

---

## 0. The user Ã¢â€ â€™ agent case checklist

Every eval in this repo serves one of **six interaction modes** Ã¢â‚¬â€ the distinct ways a user puts
NodeAgent to work. Ã¢Å“â€¦ = executable behavioral proof today. Ã°Å¸Â§Â¾ = deterministic catalog proof:
intake/output/provenance/trajectory/privacy contracts are fully specified, but runtime/live promotion
is still separate. Ã°Å¸â€Å“ = designed, sequenced, not yet built. This is the single inventory; if a case
isn't on this list, we don't claim coverage of it.

### Mode 1 Ã¢â‚¬â€ "Do it for me" (autonomous solve)

- Ã¢Å“â€¦ Recompute the variance column with lock Ã¢â€ â€™ CAS Ã¢â€ â€™ release (`evals/cases.ts` S1)
- Ã¢Å“â€¦ Selective footnote Ã¢â‚¬â€ touch only matching cells, argument correctness (S2)
- Ã¢Å“â€¦ Note resolution + wall sticky through the same CAS path (use cases 6Ã¢â‚¬â€œ7)
- Ã¢Å“â€¦ GTM tabular research enrichment Ã¢â‚¬â€ pending rows, sourced, status-gated (`tests/researchHarness.test.ts` + the v3 cheap/free live smoke, 18/28 routes 9/9, source fetches + content floor + judge)
- Ã¢Å“â€¦ Executable professional workflow subset Ã¢â‚¬â€ GTM runtime enrichment, messy spreadsheet parsing, cross-file note write, grounded wiki update, and deterministic finance reconciliation (`tests/workflowEvals.test.ts`)
- [live] Professional workflow runtime smoke - 21/21 cases in `evals/professionalWorkflows.ts` pass deterministic catalog proof, 21/21 pass the live-provider catalog planner, and 21/21 now execute through the live room runtime with `deepseek/deepseek-v4-flash`, `PRODUCTION_ROOM_TOOLS`, evidence payload writes, and runtime-managed locks. IBM Granite remains a catalog cross-check at 19/21; GLM Flash and Nex free remain narrow catalog smokes.
- [live] Chat-first GTM intake - **live provider runtime** - "just spoke with X / company Y raised $Z" graded through the real room runtime (`evals/chatIntakeRuntime.ts`, `npm run eval:chat-intake:live -- --managed-locks`): production-managed `write_locked_cell_results` / `write_locked_cells`, runtime coordination evidence (`lockHeldDuringWrite`, `releaseOrTtlFallback`, `noSilentClobber`), capture-first before the single clarifying question, chat claims stay manual evidence, CAS duplicate prevention, ambiguous "Caldera" held at needs_review without guessing, private channel only, and no model-visible lock/unlock calls. The deterministic rung still runs with a naive-saboteur negative control (`tests/chatIntakeRuntime.test.ts`). The pasted-content and background-job cases now have the generic live-runtime smoke; richer domain-specific runners remain separate.
- Ã¢Å“â€¦ Credit analysis Ã¢â‚¬â€ MM-banking ratio cascade + **cell-mapping rejection** (misbound inputs must be refused, `evals/creditEval.ts`)
- Ã¢Å“â€¦ **3-statement modeling test Ã‚Â· Solve mode** Ã¢â‚¬â€ private workbook full solve **measured, not single-pass**: `deepseek/deepseek-v4-flash` 5/5 model-owned runs across base/distractor/concurrent-edit room variants (16/16 linked cells each, no answer-key leakage, median 105.0s, p95 $0.1068/run); free `nex-agi/nex-n2-pro:free` is promoted only through the income rung (`docs/eval/FINANCE_MODEL_EVAL.md`)
- Ã°Å¸â€Å“ **SEC model build flagship** Ã¢â‚¬â€ tiered: XBRL fact tie-out Ã¢â€ â€™ derived ratios with formulas Ã¢â€ â€™ statement linkage + cited assumptions page
- Ã°Å¸â€Å“ Benchmark v4 Ã¢â‚¬â€ N-document targeted research with the comprehensive company-profile field set (business model, moat, SWOT, funding)
- Ã°Å¸â€Å“ File-drop ingestion Ã¢â‚¬â€ 10-K PDF / XLSX dropped in the room Ã¢â€ â€™ extracted to the sheet with per-cell citations; receipts Ã¢â€ â€™ formatted expense report
- Ã°Å¸â€Å“ Knowledge-organization pack Ã¢â‚¬â€ find / link / move / restructure notes and wiki nodes (feeds L9 entity resolution)

### Mode 2 Ã¢â‚¬â€ "Do it with us" (live collaboration)

- Ã¢Å“â€¦ Ladder L1Ã¢â‚¬â€œL7 scripted (read-only Ã‚Â· CAS edit Ã‚Â· conflict re-read Ã‚Â· blockedÃ¢â€ â€™draft Ã‚Â· large-range discipline Ã‚Â· long-horizon compaction Ã‚Â· **resume after slice death**)
- Ã¢Å“â€¦ Ladder L1Ã¢â‚¬â€œL4 **live** across the recorded route set (`docs/eval/model-ladder-supported.json`): full passes are `gemini-3.5-flash` and `nvidia/nemotron-3-ultra-550b`; the research champion `deepseek-v4-flash` fails L1/L4 Ã¢â‚¬â€ **proof the two lanes promote separately**
- Ã¢Å“â€¦ Multi-turn refinement with fresh-read provenance (M1) + sustained concurrent room (golden L1)
- Ã¢Å“â€¦ Lock lease fencing, expiry, janitor sweep, host takeover (`tests/lockFencing.test.ts` et al.)
- Ã°Å¸â€Å“ Ladder L5Ã¢â‚¬â€œL7 live across supported routes (config landed at `--levels=1-7`; next matrix run)
- Ã°Å¸â€Å“ **Modeling test Ã‚Â· Collaborate mode** Ã¢â‚¬â€ agent + scripted teammates split IS/BS/CF sections under locks/drafts on shared linkage rows
- Ã°Å¸â€Å“ L8 multi-role + redaction Ã‚Â· L9 entity resolution Ã‚Â· L10 cross-artifact grounded update
- Ã°Å¸â€Å“ Live adversarial-source rung Ã¢â‚¬â€ hostile instructions inside a fetched page during a real route's run (deterministic fence already proven: `tests/promptInjection.test.ts` 4/4)

### Mode 3 Ã¢â‚¬â€ "Work under review" (proposals & approval)

- Ã¢Å“â€¦ Review-mode proposals Ã¢â‚¬â€ auto-allow off Ã¢â€ â€™ inline cell proposals; room-policy briefing regression (born from a real dogfood bug, `docs/dogfood/FRICTION_LOG.md`)
- Ã°Å¸â€Å“ Contractor-time professional approval fixture Ã¢â‚¬â€ cataloged, but not yet a behavioral runner.
- Ã°Å¸â€Å“ L8 formalizes role-gated approve/promote/redact as a graded rung

### Mode 4 Ã¢â‚¬â€ "Advise me privately" (read-only consult)

- Ã¢Å“â€¦ Private NodeAgent reply Ã¢â‚¬â€ one call, **no tools**, never mutates canonical state; private until promoted
- Ã¢Å“â€¦ Privacy boundaries Ã¢â‚¬â€ private draft ops redacted from non-owners; fenced untrusted room content (prompt injection 4/4)
- Ã°Å¸â€Å“ Sensitive-query guardrail Ã¢â‚¬â€ decline specific financial/medical advice **with a stated reason**, routed through the safety lane

### Mode 5 Ã¢â‚¬â€ "Work in the background" (jobs: long-running, resumable, budgeted)

- Ã¢Å“â€¦ Durable job lifecycle Ã¢â‚¬â€ `agentJobs` checkpointing, exactly-once journal replay, `/free` lane smoke (`tests/agentJobsRuntime.test.ts` et al.)
- Ã¢Å“â€¦ L7 RESUME scripted Ã¢â‚¬â€ forced slice death + human revision while dead + cold continuation
- Ã¢Å“â€¦ Spend governance Ã¢â‚¬â€ per-slice / per-room-day / global-monthly USD caps with breach attribution (`tests/productionGates.test.ts`)
- Ã°Å¸â€Å“ L7 live across supported routes
- Ã°Å¸â€Å“ Checkpointed batch eval Ã¢â‚¬â€ a 100-row research job as resumable per-row units with partial-success reporting

### Mode 6 Ã¢â‚¬â€ "Teach me" (guided solve) Ã¢â‚¬â€ *entirely to build*

- Ã°Å¸â€Å“ **Modeling test Ã‚Â· Guide mode** Ã¢â‚¬â€ the agent must coach a scripted student through the model **with zero writes to answer cells** (mechanically checkable), hints graded for referencing the right cell/concept, convergence measured. Restraint as a first-class eval axis Ã¢â‚¬â€ no framework benchmark measures it.

**Cross-cutting gates (all running):** eval store + `eval:diff` regression gate (degraded/removed
fail CI) Ã‚Â· supported-route model matrix (research v3 + collab ladder, separate promotions) Ã‚Â· HALO
improvement loop Ã‚Â· Gemini media judge on every published clip.

---

## 1. Who uses the agent

You can't write good evals until you name who's on the other side of the table. Six personas, each with one thing they care about:

| Persona | Invokes the agent toÃ¢â‚¬Â¦ | Cares most about |
|---|---|---|
| **Founder / deal lead** (host) | recompute a column, footnote outliers, while teammates type in the same cells | nothing they typed gets silently overwritten |
| **Analyst teammate** (human co-editor) | pull NetSuite numbers in by hand *while* the agent runs | the agent treats their live edits as a moving target (CAS re-read), never clobbers their commit |
| **Guest / anon viewer** | read-only / low-trust participant | the agent never leaks private-channel context to them; `say()` stays correctly scoped |
| **Private NodeAgent owner** | run a private agent that works *around* a lock the public agent holds | drafts merge deterministically and never apply onto a diverged baseline |
| **Runtime engineer** | swap the model seam or the backend seam | a regression gate that proves the no-clobber contract still holds after a prompt/tool/backend change |
| **Eval / QA owner** | run the golden suite in CI | task-completion + no-silent-clobber rate tracked over time; new goldens curated from real traces |

---

## 2. What they do (use cases)

The agent's whole job is the lock Ã¢â€ â€™ CAS Ã¢â€ â€™ release / draft protocol on the three artifacts. The use cases are the protocol under different pressure:

1. **Recompute the variance column** Ã¢â‚¬â€ lock the range Ã¢â€ â€™ read Ã¢â€ â€™ CAS-edit Ã¢â€ â€™ release.
2. **Selective footnote** Ã¢â‚¬â€ "footnote any variance over 15%" Ã¢â€ â€™ edit only the matching `__note` cells (argument correctness).
3. **CAS re-read under a live human edit** (no lock) Ã¢â‚¬â€ a colleague commits between your read and write; survive via re-read + retry.
4. **Lock prevents the race** Ã¢â‚¬â€ claim the exact range first; the concurrent human write is *blocked*, so you see zero conflicts.
5. **Locked range Ã¢â€ â€™ draft Ã¢â€ â€™ smart-merge** Ã¢â‚¬â€ the range is already held; draft around it instead of waiting; merge on release only if the baseline is unchanged.
6. **Note artifact** Ã¢â‚¬â€ resolve the open question in the note (same protocol on a `kind:"note"` single `doc` element).
7. **Wall artifact** Ã¢â‚¬â€ add/reposition a sticky (structured `{text,x,y,color}` value through the same CAS write path).
8. **Multi-turn refinement** Ã¢â‚¬â€ turn 1 recompute; turn 2 footnote Ã¢â‚¬â€ must re-read fresh versions, not reuse turn-1 baselines.
9. **Sustained concurrent room** Ã¢â‚¬â€ agents + humans hammering the variance column; measure no-clobber across many interleavings.

---

## 3. The golden-case shape

A golden case is an **input** paired with the **desired output** Ã¢â‚¬â€ and for an agent, "output" is both the final state *and* the path it took. Defined in `evals/cases.ts`:

```
input    = { goal, room_seed (artifact + element values + versions), concurrency_script, maxSteps }
expected = {
  final_state:     per-element { value, minVersion }          // outcome
  trace_invariants: ordered + unordered assertions over the   // trajectory
                    AgentTraceEvent[] Ã¢â‚¬â€ baseVersion provenance,
                    lock-before-edit, draft-on-denied-lock,
                    release-after-edit, conflictÃ¢â€ â€™re-read
  forbidden:       clobbers Ã‚Â· ignored conflicts Ã‚Â· edits on others' locks
  budget:          exhausted === false
}
```

Both halves are scored **deterministically** Ã¢â‚¬â€ outcome by `engine.getArtifact()` / `snapshot()`, trajectory by filtering the `trace`. **No LLM judge is needed for the core gate** (an LLM-as-judge is reserved only for the P2 narration-quality check). The runner is `evals/runEval.ts`; inputs reuse the real `demoRoom` rows (`r_rev/r_cogs/r_gp/r_opex/r_ni`, editable `__variance`/`__note`).

---

## 4. Golden references (the desired I/O pairs)

### Single-turn

**S1 Ã‚Â· recompute-variance (happy path, with lock).**
Input: `goal = "recompute Q3 variance from the NetSuite export"`, seed `r_rev__variance=''[v1]`, `r_cogs__variance=''[v1]`, no concurrency, `maxSteps=14`.
Expected final: `r_rev__variance={value:"+24%", minVersion:2}`, `r_cogs__variance={value:"+27.5%", minVersion:2}`.
Invariants: `propose_lock([r_rev__variance,r_cogs__variance])` **before** any `edit_cell`; every `edit_cell.baseVersion` came from a preceding `read_range` of *that* cell; `release_lock` after the last edit; `conflicts==0`; `exhausted=false`.

**S2 Ã‚Â· selective footnote (argument correctness).**
Input: `goal = "add a footnote to any variance over 15%"`, seed `r_rev__variance="+24%"[v2]`, `r_cogs__variance="+9%"[v2]`, `r_gp__variance="+21.7%"[v2]`.
Expected: `r_rev__note` and `r_gp__note` set; **`r_cogs__note` unchanged** (9% < 15%).
Invariant: reads precede the note edits; **no `edit_cell` touches `r_cogs__note`** Ã¢â‚¬â€ the agent targeted only the right cells.

### Multi-turn

**M1 Ã‚Â· two-turn refinement in one thread.**
Turn 1: "recompute Revenue and COGS variance" Ã¢â€ â€™ claim Ã¢â€ â€™ edit Ã¢â€ â€™ release (`+24%[v2]`, `+27.5%[v2]`).
Turn 2 (fresh `runAgent` on the **same** room): "now also footnote anything over 20%".
**The invariant that matters:** every turn-2 `edit_cell.baseVersion` is sourced from a **turn-2** `read_range` Ã¢â‚¬â€ never reused from turn-1 context. `context.ts` rebuilds the JIT table each run, so stale-baseVersion reuse is a real, detectable regression. The room *is* the shared state across turns Ã¢â‚¬â€ no conversation memory required.

### Long-running

**L1 Ã‚Â· sustained concurrent room (the headline stress test).**
The public agent holds a lock on `[r_rev__variance, r_cogs__variance]` and commits; the private agent is asked to set a contended range; two humans inject timed edits during the window. Behavior under test: a blocked agent **does not wait** Ã¢â‚¬â€ it reads the locked range as context and `create_draft`s; while locked the cells stay unchanged; on `release_lock` the draft smart-merges (clean-apply if baseline unchanged, no-op if equal, **flag-without-applying if diverged**).
Measured over the window: (1) **sustained no-silent-clobber = 1.0**; (2) draft-merge correctness (clean / no-op / flag verdict per draft); (3) **lock-scope tightness** Ã¢â‚¬â€ `|locked|` never exceeds `|edited|`; (4) **liveness** Ã¢â‚¬â€ every participant makes progress, no dead-wait, `exhausted=false`. Run the same interleaving with **N random orderings** of the injected edits and assert no-clobber holds for *every* ordering Ã¢â‚¬â€ that's the duration axis, not one happy path.

---

## 5. The metrics

Outcome metrics say *what* happened; trajectory metrics say *how*. A planning agent can make every individual tool call look reasonable while following a bad plan Ã¢â‚¬â€ so we score both.

| Metric | Kind | What it asserts | Target |
|---|---|---|---|
| **No-silent-clobber rate** Ã¢Â­Â | outcome + trace | every applied `edit_cell` had a preceding `read_range` of that cell at the same version; no committed value overwritten without an intervening read | **1.0** |
| Task completion | outcome | final element values + versions match `expected.final_state` | 1.0 on goldens |
| Conflict-recovery rate | trajectory | of `edit_cell` calls that returned `{conflict:true}`, fraction followed by a re-read + successful retry | 1.0 |
| Protocol adherence | trajectory | lock-before-edit Ã‚Â· baseVersion provenance Ã‚Â· release-after-edit Ã‚Â· `draft` on denied lock (not wait/retry-loop) Ã‚Â· no edit on another holder's locked cell | per-invariant pass-rate |
| Lock-scope tightness | trajectory | `editedCells / lockedCells` Ã¢â‚¬â€ don't lock the whole sheet to edit two cells (starves teammates) | 1.0 |
| Tool / step efficiency | trajectory | steps vs the golden minimum; redundant-read / over-lock rate | flag at > 2Ãƒâ€” min |
| Budget safety | outcome | `AgentResult.exhausted === false` Ã¢â‚¬â€ finished inside `maxSteps`, didn't loop | always |
| Narration scope | trajectory (light judge) | one `say()` at start + finish; a public agent posts publicly, a private agent only to its owner Ã¢â‚¬â€ no private context leaks | pass |
| Latency & cost | operational (real-model only) | wall-clock + tokens + tool calls; not gating on the scripted path | track |

**CI gate:** a golden PASSES only if task completion = 1.0 **and** every required invariant holds **and** `exhausted = false`. No-silent-clobber failing is an automatic fail regardless of task completion Ã¢â‚¬â€ *completing by clobbering is the worst outcome, not a partial win.*

`evals/runEval.ts` runs **6 golden cases** deterministically and scores task completion + the protocol invariants. It executes all three shapes: **single-turn** (S1-style lock/CAS), **multi-turn** (M1 Ã¢â‚¬â€ runs each turn on the same room and asserts the shared cell's version strictly increases per turn, proving fresh re-reads), and **long-running** (L1 Ã¢â‚¬â€ a property test that runs N interleavings of an injected concurrent edit and asserts no-silent-clobber holds for *every* ordering). It grows toward the full metric table above.

Private answer-key workbooks are handled separately from committed goldens.
`eval:finance-model-private` validates a local three-statement modeling workbook
and its answer-key formulas without storing the workbook or expected values in
git. `eval:finance-model` runs the actual NodeAgent tool workflow: lock the
forecast cells, read versions, CAS-write formulas, release, then grade both the
artifact and trace. Its default committed trace uses an owned synthetic gold
pack for README media; passing `--gold` runs the same workflow against a private
local workbook. Live private runs write full traces under gitignored
`docs/eval/finance-model-runs/` and commit only the redacted
`docs/eval/finance-model-live.json` summary. The current full Solve promotion is
`deepseek/deepseek-v4-flash`: 5/5 model-owned full solves, 16/16 linked forecast
cells each run, no answer-key leakage, median 105.0s, p95 $0.1068/run, and zero
provider-owned failures. That aggregate was recorded with `--runs=5 --record`.

---

## 6. Context compaction (long-running runs)

A long-running agent's message history is dominated by **old `read_range` results** Ã¢â‚¬â€ fat JSON arrays, each superseded by the next read. Left alone, the context window fills with dead weight. The fix, matched to the top production patterns:

- **Anthropic Claude Ã¢â‚¬â€ "context editing":** clear stale tool results from the window; keep the system prompt, the latest state, and recent turns. (Plus the *memory tool* and *compaction* = summarize old turns.)
- **Nous Research Hermes:** structured tool-call turns Ã¢â‚¬â€ we preserve the turn shape so the model stays coherent.

NodeRoom implements this in `src/nodeagent/core/contextCompactor.ts` (`compactMessages`), wired into `runtime.ts` (the model sees a compacted view each turn; the full history is kept for audit):

- **Trigger** Ã¢â‚¬â€ when the estimated context exceeds `maxChars` (~`chars/4` tokens).
- **Preserve** Ã¢â‚¬â€ message 0 (the task + initial snapshot), the last `keepRecent` turns verbatim, and every message **envelope** (so the assistantÃ¢â€ â€tool pairing the API requires is never broken).
- **Elide** Ã¢â‚¬â€ replace the *content* of old `read_range` tool results with a one-line stub (they're stale). An optional `summarize` seam swaps the stub for an LLM running-summary (the Claude "compaction" pattern).

Tested in `tests/compaction.test.ts`: it shrinks the history, preserves every envelope, and an agent run with compaction enabled still completes the task.

---

## 7. Curating new goldens

The suite grows from two sources, both standard practice:
1. **Anonymized production traces** Ã¢â‚¬â€ replay a real room trace, freeze the desired final state, add it as a golden.
2. **Dueling-LLM synthesis** Ã¢â‚¬â€ generate candidate goals, run two models, diff the trajectories, and promote the disagreements into goldens (they're where the contract is ambiguous).

Never delete a failing golden to make the suite green Ã¢â‚¬â€ fix the harness.

---

## File map

| Concern | File |
|---|---|
| Golden cases (the I/O pairs) | `evals/cases.ts` |
| Eval runner + scoring | `evals/runEval.ts` |
| Context compaction | `src/nodeagent/core/contextCompactor.ts` |
| Compaction + runtime tests | `tests/compaction.test.ts`, `tests/agentRuntime.test.ts` |
| The harness being evaluated | `src/nodeagent/` (see `docs/AGENT_RUNTIME.md`) |
