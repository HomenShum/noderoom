# Eval — Three Users, One New Room, Concurrent Collaboration

**What it proves:** the product's core differentiator — three real browser users in a **brand-new** room, chatting, editing the **same spreadsheet** concurrently, and driving the **public AI agent**, with every change reactively converging across all three views and **no clobbering** under concurrent edits. Verified through the rendered DOM **and** per-view screenshots.

**Why it matters:** the earlier audit ([docs/audit/QA_FINDINGS.md](../audit/QA_FINDINGS.md)) flagged real-time multi-user no-clobber collab as the highest-value thing that *no automated test proved*. This is that test.

---

## Environment
- **Live Convex backend** (real reactivity + real LLM for `/ask`) — memory mode can't share state across browsers, so this must be live.
- **Brand-new room each run** via the new URL entry: `?create=CODE` (host creates room + a shared `Q3 variance` sheet), `?room=CODE` (others join), `?name=NAME` (identity). The default (no params) still joins the seeded `Q3DEMO` room.
- **Cost note:** Act 3 runs one real `/ask` against the project's keys. Bounded to a single agent run.

## Personas
| User | Role | URL |
|---|---|---|
| **Maya** | Host (creates the room) | `/?create=EVAL-xxxx&name=Maya` |
| **Dev** | Member | `/?room=EVAL-xxxx&name=Dev` |
| **Sam** | Guest | `/?room=EVAL-xxxx&name=Sam` |

## Acts (concurrent timeline)
1. **Join** — Maya creates `EVAL-xxxx` (+ seeds the `Q3 variance` sheet); Dev and Sam join by code. *Pass:* all three land in the same room; member roster shows 3 people in every view.
2. **Chat (concurrent)** — each posts a public message. *Pass:* all three messages render in **all three** chat feeds (reactive fan-out).
3. **Shared-sheet edits (parallel, no conflict)** — Dev edits `r_opex__variance`, Sam edits `r_gp__variance` (different cells, at once). *Pass:* both values appear in all three views; versions converge.
4. **Shared-sheet edit (same cell, conflict)** — Maya and Dev both write `r_rev__variance` near-simultaneously. *Pass:* CAS picks one winner; the loser's optimistic value reverts; **all three views show the same final value** (no clobber, no torn state).
5. **Public agent** — Maya sends `/ask reconcile Q3 revenue`. *Pass:* the Room NodeAgent's agent message + its cell edits (e.g. `r_gp__variance`, `r_ni__variance`) appear in **all three** views.
6. **Private agent + isolation** — Maya asks her private NodeAgent (`runPrivateAgent`); it reads the room and replies in **Maya's private channel only**. *Pass:* a private agent reply appears for Maya; neither her question nor the reply is visible to Dev/Sam.

## Visual verification
Per-view screenshots are captured to `docs/eval/three-user-shots/` at the end of Acts 2, 4, and 5 (`{act}-maya.png` / `-dev.png` / `-sam.png`) and inspected to confirm the three views are consistent.

## Pass criteria (summary)
- 3/3 users in one new room · all chat fan-out visible in all views · parallel edits both land · same-cell edit converges to one value everywhere · agent edits propagate to all views · private channel isolated.

## Private agent (wired — the gap this eval first surfaced, now closed)
- `convex/agent.ts:runPrivateAgent` — a per-user consult: reads the room as bounded context, makes ONE model call (`tools: []`, so it never mutates canonical state), and posts the reply to the requester's **own** private channel via the trusted internal `messages.postPrivateAgentReply` (which also ensures each member — not just the host — has a private agent session). Output stays private until promoted. Distinct from `runRoomAgent` (which edits the shared sheet publicly). Frontend: any private-panel message in live mode triggers it (`store.askPrivateAgent` → `Chat.tsx`).

## How to run
```
E2E_LIVE=1 npx playwright test three-user-collab.spec.ts
```
Requires `.env.local` with `VITE_CONVEX_URL` (live Convex) + provider keys for the `/ask` step. Screenshots land in `docs/eval/three-user-shots/`.
