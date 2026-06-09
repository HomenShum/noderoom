# NodeRoom — Conference / Hackathon Demo Run-of-Show

> **The one rule:** demo in **memory mode**. It is a fully deterministic, offline-capable build of every
> feature — no backend, no API keys, no wifi. The "demo gods" cannot break it. Live multiplayer (real
> Convex) is an optional upgrade for the wow-moment *only if you've rehearsed it on the venue network*.

---

## 0. Two ways to run

| Mode | URL | What you get | Risk | Use it for |
|---|---|---|---|---|
| **Memory (default)** | `…/?mode=memory` | The seeded Q3 diligence room; the agent, lock→draft→merge, research enrichment, chat, wall — all **scripted & instant**, fully offline | **None** | The self-serve QR for attendees; your safe stage fallback |
| **Live Convex** | `…/` (with `VITE_CONVEX_URL` set + seeded `Q3DEMO` room) | True multi-user: edits land live across devices; real LLM `/ask` | wifi/backend/keys | The multiplayer wow beat — **only if rehearsed on the venue network** |

A small **`● demo`** badge in the top bar tells everyone (and you) when you're in the safe scripted build.

---

## 1. Setup checklist

**Night before**
- [ ] `npm run build` is green. Deploy the static build (memory mode works with **no env vars** — if `VITE_CONVEX_URL` is unset, the app *is* memory mode).
- [ ] Open the deployed URL on the **actual laptop you'll present from**; click **Enter the Q3 diligence room**; confirm the guided tour auto-starts and every panel renders.
- [ ] Print/slide a **QR code to `…/?mode=memory`** for attendees (guarantees each of them gets the reliable build).
- [ ] Record a **60–90s screencast** of the happy path (tour → `/ask` → Run collaboration) as fallback #1; export 4–5 **screenshots** as fallback #2.
- [ ] (Live mode only) seed the `Q3DEMO` Convex room and verify two browsers see each other's edits **on the venue wifi**.

**30 minutes before**
- [ ] Laptop charged + **mobile hotspot on as primary network**.
- [ ] Browser: clean profile, **zoom to ~125%** for back-row readability, notifications off.
- [ ] Reset the tour so it greets a fresh audience: open dev console → `localStorage.removeItem('noderoom:tour:v1')` (or just use a fresh/incognito window).
- [ ] Test the projector + sound. Have the screencast file open in a background tab.

---

## 2. The guided walkthrough (in-app)

A dependency-free spotlight tour. It **auto-starts on a visitor's first entry** to the demo room and covers, in 8 short steps: the room layout → public chat + `/ask` → human+agent no-clobber (Run collaboration) → the audit trace → the spreadsheet/notes/wall tabs → the private NodeAgent → a "now you try" CTA.

- **Skip / Back / Next / Done**, a step counter, and progress dots. **Esc** skips; **→/Enter** next; **←** back.
- Closing it (any way) sets a flag so a returning visitor is never nagged. The **`?`** button in the top bar replays it anytime.
- This is what lets an attendee who scans the QR **self-serve** — they don't need you to explain it.

---

## 3. 90-second HOOK (the part that must land)

> **(0:00–0:20 — the pain)** "When a team works in a shared doc *with* an AI, two things break: people clobber each other's edits, and the AI quietly changes things no one can trace. NodeRoom fixes both."
>
> **(0:20–0:55 — the quick win)** *(in the public chat, type)* `…/ask reconcile Q3 revenue` *(send)*. "The Room NodeAgent locks the cells it's working on, edits them, and you watch the variance fill in — live, no spinner. That instant feel is optimistic UI."
>
> **(0:55–1:30 — the wow)** Click **Run collaboration**. "Now a human and the agent edit the *same* sheet at once. The agent locks a range, I draft around it, and on unlock it **smart-merges** — compare-and-swap, so nobody's work is silently overwritten. Every change, human or agent, is in the audit trace on the right." *(Live mode: hold up a second device / point at an attendee's QR-joined screen and show the edit already there.)*

---

## 4. 5-minute DEEP DIVE (outcomes first, one beat each)

1. **No-clobber collaboration (≈90s)** — Run collaboration again; narrate lock → draft → smart-merge; "two writers, zero lost work." Point at a cell's lock/draft badge.
2. **Proposals & trust (≈60s)** — note the **Auto-allow** switch is *off* by default, so agent edits arrive as **proposals** in the trace that the host approves/rejects. Approve one; show it apply. (If a cell changed underneath, the approve **surfaces the conflict** instead of a false "applied.")
3. **Research enrichment (≈45s)** — open the **Company research** tab; click **Enrich pending**; watch Anthropic/Ramp/Mercury/Brex fill with sourced summary/funding/headcount + citations.
4. **Private agent + the wall (≈45s)** — the **Wall** tab (drag a post-it); the **private NodeAgent** panel — "reads the room, but its output stays yours until you Promote it."
5. **Close (≈30s)** — "Human + AI, in one room, with a no-clobber spine and a full audit trail." Show the QR: "scan to try it yourself."

---

## 5. If the demo gods strike

1. **Don't debug on stage.** If anything stalls, say *"let me show you this running"* and cut to the **screencast**.
2. If video fails too → **screenshot slides**, narrate the same arc.
3. If only the network is flaky → you're already in **memory mode**, which needs no network. Just keep going.
4. Worst case, hand someone the QR to `…/?mode=memory` and let the **in-app tour** do the talking.

---

## 6. Q&A bait (the technical depth, if they ask "how")

- **Optimistic UI, honestly.** "Local edits apply instantly and reconcile when the server confirms — and on failure they don't silently vanish: a rejected send/edit shows a *failed* state with retry, not a disappearing bubble." (Convex `withOptimisticUpdate` + honest `{ok,reason}` plumbing.)
- **CAS no-clobber.** "Every cell carries a version; a write only lands if the version still matches. Concurrent edits can't silently overwrite each other — the loser sees a conflict, not a lie." (`artifacts.ts` compare-and-swap + lock→draft→smart-merge.)
- **Durable long-running agents.** "The `/free` agent checkpoints to durable Convex rows and resumes across the 10-minute action limit — a crash or a dropped connection resumes at the last step, with an exactly-once step journal so it never double-pays a provider."
- **Auditable by construction.** "Every human and agent action is an append-only, hash-chained trace row with per-cell provenance — you can replay exactly what changed and who changed it."

---

## 7. Verify before you trust the word "ready"

```
npm run build           # green
npm test                # unit/eval suite green
npm run test:e2e        # Playwright: chat + guided tour in a real browser
```
Then open the deployed URL, click **Enter the Q3 diligence room**, and confirm the tour greets you and `/ask` fills the sheet. If the live URL doesn't show those, it isn't shipped — regardless of what the build log said.
