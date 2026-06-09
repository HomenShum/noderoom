# NodeRoom — architecture

## The one idea everything rests on: the uniform element model

Every artifact — spreadsheet, note, post-it wall — is a **bag of elements**, and an element is just:

```ts
interface Element { id: string; version: number; value: unknown; updatedAt: number; updatedBy: Actor }
```

A spreadsheet cell (`B2`), a note block (`n1`), and a sticky (`s1`) are all elements. That uniformity
is the whole architecture: **locks, optimistic-concurrency (CAS), drafts, and smart-merge are ONE
generic mechanism over elements**, not three per-artifact implementations.

## The collaboration lifecycle (point 8)

```
  human / agent edit
        │
        ▼
  RoomEngine.applyEdit(op{ elementId, value, baseVersion, opId })
        │
        ├─ opId already applied? ──────────────► idempotent no-op (success)
        ├─ element locked by someone else? ────► { ok:false, reason:"locked", by }   ◄── lock tool
        ├─ agent edit & auto-allow OFF? ───────► Proposal (approve/reject)            ◄── auto-allow
        └─ applyOpInternal: CAS
                 ├─ version !== baseVersion ───► { ok:false, conflict, expected, actual }  (as DATA)
                 └─ apply: value set, version++, trace "edit_applied", emit()

  ── meanwhile, a blocked agent ──────────────────────────────────────────────
  awareness(roomId)         → sees others' active locks + sessions + recent traces
  readRange(lockedIds)      → reads the locked range as CONTEXT (locked ≠ invisible)
  createDraft(ops, lockId)  → queues changes AROUND the lock, tagged blockedByLockId

  ── on releaseLock(lockId) ───────────────────────────────────────────────────
  for each pending draft blocked by / overlapping the lock:
      resolver({ draft, current, committed }) → { ops, resolution }     ◄── SmartResolver seam
          • element untouched since draft     → apply cleanly      ("clean")
          • holder made the same change       → no-op              ("clean")
          • value diverged from committed work → flag for review   ("needs_review", NOT clobbered)
      apply resolved ops (CAS) · draft.status = merged | conflict · trace
```

**Key invariant (tested):** committed work is never overwritten by a stale draft. The deterministic
`SmartResolver` ships in `merge.ts`; a real LLM resolver implements the same signature and can *merge*
two diverged values instead of flagging them.

## Engine ↔ Convex mapping (production)

The in-memory `RoomEngine` is the deterministic implementation of `convex/schema.ts`. Porting is a
**transport** change:

| Engine (spike) | Convex (production) |
|---|---|
| `RoomEngine` Maps | tables: `rooms`, `members`, `artifacts`, `elements`, `locks`, `drafts`, `proposals`, `agentSessions`, `messages`, `traces` |
| `engine.subscribe()` + `useSyncExternalStore` | reactive `useQuery` subscriptions (the stream) |
| `applyEdit` (CAS) | `applyCellEdit` mutation — per-element `version` check; **conflict returned as data, not a thrown `ConvexError`** (a throw rolls back the whole mutation) |
| `proposeLock` / `releaseLock` | `locks` table mutations; release triggers a merge action |
| `mergeDraft` → deterministic resolver | a `"use node"` action calling an LLM resolver |
| `opId` / `clientMsgId` idempotency | `withIndex().unique()`-then-insert (Convex has no DB unique constraint) |
| scripted agents | `pi-agent-core` loop in a `"use node"` action; tools = `read_range` / `propose_lock` / `edit` / `create_draft`; conflicts come back as tool errors → the model re-reads + retries |

**Why app-level CAS, not just Convex OCC:** Convex's internal OCC serializes physical writes and
auto-retries low-level conflicts, but two clients that both read `v1` and write different values will
*both* succeed (last-writer-wins). The per-element `version` + the explicit CAS check is what prevents
the stale-baseline clobber — that's the correctness story.

## Production layer by access pattern

NodeRoom should not store every kind of data in one place. The production
architecture separates the system by access pattern:

| Layer | Owns | Does not own |
|---|---|---|
| Realtime DB / Convex | canonical room state, messages, artifacts, elements, versions, locks, drafts, proposals, traces, permissions | large raw file bytes, public CDN caching, ephemeral presence-only state |
| Object storage | uploaded XLSX/CSV/PDF/image files, generated exports, screenshots, trace bundles, benchmark artifacts | live spreadsheet cell state, locks, version counters, private chat state |
| Hot cache / KV | presence, room tail, recent version-keyed sheet ranges, semantic answer cache, idempotency windows, rate-limit counters | canonical finance data or private notes without version and visibility keys |
| Serverless actions / workers | parsing, OCR/layout extraction, retrieval, model calls, embeddings, eval runs, export generation | long-lived truth without database checkpoints |
| CDN / edge | static assets, public docs, public screenshots, explicitly published read-only artifacts | active private rooms, authenticated spreadsheet data, private agent chats |

The short version: CDN delivers, object storage holds blobs, Convex/realtime DB
holds truth, hot cache holds version-keyed ephemeral state, and serverless
compute runs bursty side effects. Add explicit load balancing only when the
system owns custom websocket gateways, MCP servers, or long-running worker
fleets.

For spreadsheet artifacts, this matters. The uploaded workbook can live in
object storage, but the collaborative working model is structured state: rows,
cells, versions, formula dependency records, locks, drafts, and append-only
operation traces. Cache ranges, not entire private workbooks, and key every
range by artifact id, visibility, version, row range, and column range.

## Long-running job lifecycle

Long-running execution is a property of `agentJobs`, not a separate agent
runtime. `/ask` creates the same durable job root as `/free`; it runs an
immediate first slice for interactive UX, then checkpoints into Workflow if the
slice exhausts budget. `/free` only starts the job with the free-auto model
policy.

```text
agentJobs create/handoff mutation
  -> insert agentJobs row
  -> run first slice inline or start freeAutoWorkflow
  -> workflow sleeps until nextRunAt
  -> Workpool runs one runFreeAutoJobSlice action
  -> claimSlice(jobId, leaseId)
  -> runAgent with the job modelPolicy
  -> finishSlice records agentJobAttempts + cursor/handoff + nextRunAt
  -> workflow polls state and resumes, or terminal status stops it
```

Built guarantees:

- Each slice uses a default 9-minute budget under Convex's 10-minute cap, with
  a 30-second reserve and a lease that outlives the slice.
- `finishSlice` records attempts and checkpoints in the mutation that updates
  job state; legacy scheduler continuation is only used for old
  `runtime="scheduler"` jobs.
- A lease prevents two workers from running the same job at the same time.

Important production distinction:

- A lease is not enqueue idempotency. A double-click can still create two
  independent jobs unless `startFreeAuto` claims or reuses a deterministic job
  idempotency key.
- Runtime exactly-once journaling is proven in tests, but the Convex `/free`
  runner still needs a durable provider-step journal keyed by a stable job step
  id to avoid re-billing after a crash immediately after a provider call.
- Model calls receive deadline abort signals; tools are checked before
  execution, but stricter production cap-safety should thread deadline signals
  through tool implementations too.

## NodeAgent job contract

The `/ask` and `/free` split has converged on one durable NodeAgent contract:
every agent request first creates or reuses an `agentJobs` row, then the first
action slice either completes quickly or checkpoints into the same
Workflow/Workpool continuation path. The detailed target
design, including `NodeAgentRequest`, `NodeAgentResult`, notebook graph tables,
the action/query/mutation operation ledger, leases, tool permissions, mutation
receipts, and embedding sync, lives in
[`docs/NODEAGENT_ARCHITECTURE.md`](NODEAGENT_ARCHITECTURE.md).

## UI layer

- **Runtime mirror:** `src/app/roomStore.ts` exposes the engine via `useEngineRev()` (a
  `useSyncExternalStore` over `engine.subscribe`) — the local stand-in for a Convex reactive query.
- **Shell:** `RoomShell` is a flex layout that toggles 1→4 panels (left rail · center chat+artifact ·
  right private agent).
- **Chats:** the **public room feed is custom** (assistant-ui's thread model is 1:1 user↔assistant, so
  a multi-author room is off-label). The **private `/ask` thread** is where `@assistant-ui/react`'s
  `ExternalStoreRuntime` + tool UIs fit — already built in the sibling **NodeAgent** repo.

## Latency posture (mechanism verified; numbers unmeasured)

For the live (Convex-wired) version, grounded in current sources:

- **Human-driven actions** (type, send, optimistic cell edit) → **~0ms, sub-frame** via optimistic
  local patch — Linear-grade *felt* responsiveness (Linear publishes no numeric SLA; its goal is "a
  synchronous experience with asynchronous data", and its mechanism is local-first).
  - *Validity bound (unmeasured):* the ~0ms is a **mechanism** claim (no server round-trip on local
    apply), not a measured number. It holds at small room size. Today the optimistic cell/note/post-it
    edit `setQuery`s the whole `rooms.full` object (O(room) work per commit), so the felt latency
    degrades as a room grows — revisit with the granular-subscription split. See
    [docs/audit/QA_FINDINGS.md](audit/QA_FINDINGS.md) (P1-8) for the measurement + refactor trigger.
- **Collaboration echo** (your edit visible to others) → **~30–150ms** same-region (estimate, not a
  Convex-published number) — "live", not "instant".
- **Agent `/ask`** → first token **~0.7–1.5s** (non-reasoning models; *never* a reasoning/thinking SKU,
  which blows TTFT to 14–108s) — LLM-category latency made legible by `isRunning` + streaming, not by
  being fast.

**The hardening that makes it real:** batch streamed deltas (~30–100ms / rAF), memoize message
conversion + stable keys, virtualize long threads, and reconcile optimistic messages by a stable
`clientMsgId` (never by text).
