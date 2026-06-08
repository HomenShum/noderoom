# NodeRoom agent evaluation

Read this before you explain how we know the agent is *correct*, not just *working*. The harness in `docs/AGENT_RUNTIME.md` defines the contract; this defines how we hold it to that contract — deterministically, in CI.

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
cases without committing private rows.

---

## 1. Who uses the agent

You can't write good evals until you name who's on the other side of the table. Six personas, each with one thing they care about:

| Persona | Invokes the agent to… | Cares most about |
|---|---|---|
| **Founder / deal lead** (host) | recompute a column, footnote outliers, while teammates type in the same cells | nothing they typed gets silently overwritten |
| **Analyst teammate** (human co-editor) | pull NetSuite numbers in by hand *while* the agent runs | the agent treats their live edits as a moving target (CAS re-read), never clobbers their commit |
| **Guest / anon viewer** | read-only / low-trust participant | the agent never leaks private-channel context to them; `say()` stays correctly scoped |
| **Private NodeAgent owner** | run a private agent that works *around* a lock the public agent holds | drafts merge deterministically and never apply onto a diverged baseline |
| **Runtime engineer** | swap the model seam or the backend seam | a regression gate that proves the no-clobber contract still holds after a prompt/tool/backend change |
| **Eval / QA owner** | run the golden suite in CI | task-completion + no-silent-clobber rate tracked over time; new goldens curated from real traces |

---

## 2. What they do (use cases)

The agent's whole job is the lock → CAS → release / draft protocol on the three artifacts. The use cases are the protocol under different pressure:

1. **Recompute the variance column** — lock the range → read → CAS-edit → release.
2. **Selective footnote** — "footnote any variance over 15%" → edit only the matching `__note` cells (argument correctness).
3. **CAS re-read under a live human edit** (no lock) — a colleague commits between your read and write; survive via re-read + retry.
4. **Lock prevents the race** — claim the exact range first; the concurrent human write is *blocked*, so you see zero conflicts.
5. **Locked range → draft → smart-merge** — the range is already held; draft around it instead of waiting; merge on release only if the baseline is unchanged.
6. **Note artifact** — resolve the open question in the note (same protocol on a `kind:"note"` single `doc` element).
7. **Wall artifact** — add/reposition a sticky (structured `{text,x,y,color}` value through the same CAS write path).
8. **Multi-turn refinement** — turn 1 recompute; turn 2 footnote — must re-read fresh versions, not reuse turn-1 baselines.
9. **Sustained concurrent room** — agents + humans hammering the variance column; measure no-clobber across many interleavings.

---

## 3. The golden-case shape

A golden case is an **input** paired with the **desired output** — and for an agent, "output" is both the final state *and* the path it took. Defined in `evals/cases.ts`:

```
input    = { goal, room_seed (artifact + element values + versions), concurrency_script, maxSteps }
expected = {
  final_state:     per-element { value, minVersion }          // outcome
  trace_invariants: ordered + unordered assertions over the   // trajectory
                    AgentTraceEvent[] — baseVersion provenance,
                    lock-before-edit, draft-on-denied-lock,
                    release-after-edit, conflict→re-read
  forbidden:       clobbers · ignored conflicts · edits on others' locks
  budget:          exhausted === false
}
```

Both halves are scored **deterministically** — outcome by `engine.getArtifact()` / `snapshot()`, trajectory by filtering the `trace`. **No LLM judge is needed for the core gate** (an LLM-as-judge is reserved only for the P2 narration-quality check). The runner is `evals/runEval.ts`; inputs reuse the real `demoRoom` rows (`r_rev/r_cogs/r_gp/r_opex/r_ni`, editable `__variance`/`__note`).

---

## 4. Golden references (the desired I/O pairs)

### Single-turn

**S1 · recompute-variance (happy path, with lock).**
Input: `goal = "recompute Q3 variance from the NetSuite export"`, seed `r_rev__variance=''[v1]`, `r_cogs__variance=''[v1]`, no concurrency, `maxSteps=14`.
Expected final: `r_rev__variance={value:"+24%", minVersion:2}`, `r_cogs__variance={value:"+27.5%", minVersion:2}`.
Invariants: `propose_lock([r_rev__variance,r_cogs__variance])` **before** any `edit_cell`; every `edit_cell.baseVersion` came from a preceding `read_range` of *that* cell; `release_lock` after the last edit; `conflicts==0`; `exhausted=false`.

**S2 · selective footnote (argument correctness).**
Input: `goal = "add a footnote to any variance over 15%"`, seed `r_rev__variance="+24%"[v2]`, `r_cogs__variance="+9%"[v2]`, `r_gp__variance="+21.7%"[v2]`.
Expected: `r_rev__note` and `r_gp__note` set; **`r_cogs__note` unchanged** (9% < 15%).
Invariant: reads precede the note edits; **no `edit_cell` touches `r_cogs__note`** — the agent targeted only the right cells.

### Multi-turn

**M1 · two-turn refinement in one thread.**
Turn 1: "recompute Revenue and COGS variance" → claim → edit → release (`+24%[v2]`, `+27.5%[v2]`).
Turn 2 (fresh `runAgent` on the **same** room): "now also footnote anything over 20%".
**The invariant that matters:** every turn-2 `edit_cell.baseVersion` is sourced from a **turn-2** `read_range` — never reused from turn-1 context. `context.ts` rebuilds the JIT table each run, so stale-baseVersion reuse is a real, detectable regression. The room *is* the shared state across turns — no conversation memory required.

### Long-running

**L1 · sustained concurrent room (the headline stress test).**
The public agent holds a lock on `[r_rev__variance, r_cogs__variance]` and commits; the private agent is asked to set a contended range; two humans inject timed edits during the window. Behavior under test: a blocked agent **does not wait** — it reads the locked range as context and `create_draft`s; while locked the cells stay unchanged; on `release_lock` the draft smart-merges (clean-apply if baseline unchanged, no-op if equal, **flag-without-applying if diverged**).
Measured over the window: (1) **sustained no-silent-clobber = 1.0**; (2) draft-merge correctness (clean / no-op / flag verdict per draft); (3) **lock-scope tightness** — `|locked|` never exceeds `|edited|`; (4) **liveness** — every participant makes progress, no dead-wait, `exhausted=false`. Run the same interleaving with **N random orderings** of the injected edits and assert no-clobber holds for *every* ordering — that's the duration axis, not one happy path.

---

## 5. The metrics

Outcome metrics say *what* happened; trajectory metrics say *how*. A planning agent can make every individual tool call look reasonable while following a bad plan — so we score both.

| Metric | Kind | What it asserts | Target |
|---|---|---|---|
| **No-silent-clobber rate** ⭐ | outcome + trace | every applied `edit_cell` had a preceding `read_range` of that cell at the same version; no committed value overwritten without an intervening read | **1.0** |
| Task completion | outcome | final element values + versions match `expected.final_state` | 1.0 on goldens |
| Conflict-recovery rate | trajectory | of `edit_cell` calls that returned `{conflict:true}`, fraction followed by a re-read + successful retry | 1.0 |
| Protocol adherence | trajectory | lock-before-edit · baseVersion provenance · release-after-edit · `draft` on denied lock (not wait/retry-loop) · no edit on another holder's locked cell | per-invariant pass-rate |
| Lock-scope tightness | trajectory | `editedCells / lockedCells` — don't lock the whole sheet to edit two cells (starves teammates) | 1.0 |
| Tool / step efficiency | trajectory | steps vs the golden minimum; redundant-read / over-lock rate | flag at > 2× min |
| Budget safety | outcome | `AgentResult.exhausted === false` — finished inside `maxSteps`, didn't loop | always |
| Narration scope | trajectory (light judge) | one `say()` at start + finish; a public agent posts publicly, a private agent only to its owner — no private context leaks | pass |
| Latency & cost | operational (real-model only) | wall-clock + tokens + tool calls; not gating on the scripted path | track |

**CI gate:** a golden PASSES only if task completion = 1.0 **and** every required invariant holds **and** `exhausted = false`. No-silent-clobber failing is an automatic fail regardless of task completion — *completing by clobbering is the worst outcome, not a partial win.*

`evals/runEval.ts` runs **6 golden cases** deterministically and scores task completion + the protocol invariants. It executes all three shapes: **single-turn** (S1-style lock/CAS), **multi-turn** (M1 — runs each turn on the same room and asserts the shared cell's version strictly increases per turn, proving fresh re-reads), and **long-running** (L1 — a property test that runs N interleavings of an injected concurrent edit and asserts no-silent-clobber holds for *every* ordering). It grows toward the full metric table above.

---

## 6. Context compaction (long-running runs)

A long-running agent's message history is dominated by **old `read_range` results** — fat JSON arrays, each superseded by the next read. Left alone, the context window fills with dead weight. The fix, matched to the top production patterns:

- **Anthropic Claude — "context editing":** clear stale tool results from the window; keep the system prompt, the latest state, and recent turns. (Plus the *memory tool* and *compaction* = summarize old turns.)
- **Nous Research Hermes:** structured tool-call turns — we preserve the turn shape so the model stays coherent.

NodeRoom implements this in `src/agent/compaction.ts` (`compactMessages`), wired into `runtime.ts` (the model sees a compacted view each turn; the full history is kept for audit):

- **Trigger** — when the estimated context exceeds `maxChars` (~`chars/4` tokens).
- **Preserve** — message 0 (the task + initial snapshot), the last `keepRecent` turns verbatim, and every message **envelope** (so the assistant↔tool pairing the API requires is never broken).
- **Elide** — replace the *content* of old `read_range` tool results with a one-line stub (they're stale). An optional `summarize` seam swaps the stub for an LLM running-summary (the Claude "compaction" pattern).

Tested in `tests/compaction.test.ts`: it shrinks the history, preserves every envelope, and an agent run with compaction enabled still completes the task.

---

## 7. Curating new goldens

The suite grows from two sources, both standard practice:
1. **Anonymized production traces** — replay a real room trace, freeze the desired final state, add it as a golden.
2. **Dueling-LLM synthesis** — generate candidate goals, run two models, diff the trajectories, and promote the disagreements into goldens (they're where the contract is ambiguous).

Never delete a failing golden to make the suite green — fix the harness.

---

## File map

| Concern | File |
|---|---|
| Golden cases (the I/O pairs) | `evals/cases.ts` |
| Eval runner + scoring | `evals/runEval.ts` |
| Context compaction | `src/agent/compaction.ts` |
| Compaction + runtime tests | `tests/compaction.test.ts`, `tests/agentRuntime.test.ts` |
| The harness being evaluated | `src/agent/` (see `docs/AGENT_RUNTIME.md`) |
