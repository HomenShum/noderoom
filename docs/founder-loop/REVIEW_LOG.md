# Founder Self-Direct Loop — NodeRoom

> Meta-task: act as the founder + senior staff product engineer. Drive the app, find issues
> and taste-mismatches the way a real user would, root-cause them, fix, verify live, record.
> 10 loops, each a sharper/different angle. Seeded by Homen's screen-recording review
> (`6-14-2026-deep-review.txt` + Gemini 3.5 Flash video judge).

Branch: `founder-loop-fixes` · started 2026-06-14.

---

## Loop 0 — Diagnosis (seed)

Source of issues: Homen recorded himself using the app (`20260615-0348-37.6627000.mp4`, 104s),
flagged 5 problems. Confirmed by `gemini-3.5-flash` video review
([mp4-workflow-review.json](../eval/agent-improvement-loop/mp4-workflow-review.json)) +
two parallel-subagent diagnosis workflows + independent code reads.

| # | Issue (founder's words) | Root cause (file:line) | Verdict |
|---|---|---|---|
| 1 | "joined a new room but it was not a fresh blank state room" | `convex/rooms.ts:332-337` — `createStarterRoom` auto-seeds **6 artifacts** (Company research sheet, Diligence memo, Risk/opportunity wall, Runway/milestones sheet, Open questions/workplan, Q3 variance). | Confirmed. **Contradicts documented spec** (deep-review L5181-5300: "A new room starts blank. NodeAgent does not."). |
| 2 | "agent did not accomplish the workflow, it stopped at the budget limit" | `convex/agent.ts:127-128` — non-research runs default to **10 steps**, then return a partial requiring the user to manually type "continue". (Background job runner *does* auto-resume — `agentJobRunner.ts:293` — only the foreground room agent stalls.) | Confirmed. Want: prioritize completion over budget for MVP demo (bounded, not unbounded). |
| 3 | "room is crowded with too much needed to understand" | 4 simultaneous panels (left rail + work-surface tabs + chat + trace log). Amplified by the 6 seeded artifacts from #1. | Confirmed (Gemini: minor; founder: priority). |
| 4 | "too many buttons to learn for users" | 11 default controls (Gemini inventory): Spreadsheet, Notes, Wall, Run, Import accounts, Request assistance, Publish chat, Invite, +doc, +task, Send. Spec wants **3** first-run CTAs. | Confirmed. |
| 5 | "i do not see the streaming responses from our agent" | Streaming (`@convex-dev/persistent-text-streaming`) is wired **only to the private consult agent**. The public Room NodeAgent: (a) calls Gemini `:generateContent` (non-streaming, `convexModel.ts:285,492`), (b) persists no deltas during the run, (c) posts one final message with no `streamId` (`agent.ts:486-496`), so `Chat.tsx:999` never mounts `StreamedBody`. Three independent defeaters. | Confirmed. |

Bonus (provider routing): live room agent interactive path = `gemini-3.5-flash` (Google direct,
cost-optimized), not "top latest OpenRouter models." Research path = `deepseek/deepseek-v4-flash`
(OpenRouter, but a cheap flash). Intended per deep-review §13: adaptive routing through OpenRouter.

### 10-loop plan (angles)

1. Fresh blank room — stop auto-seeding (issue #1)
2. Blank-state onboarding CTA — 3 obvious starts, demo behind a button (#1/#4)
3. Completion over budget — bounded auto-continue (#2)
4. Visible Room-agent streaming (#5)
5. Top-latest OpenRouter model routing (provider quality)
6. Density reduction — progressive disclosure of trace/panels (#3)
7. Affordance reduction — consolidate the 11 buttons (#4)
8. Trust & honesty signals — agent status, model shown, no fake success (senior-PE)
9. Empty / error / degraded states
10. Self-recorded walkthrough + Gemini self-review (close the meta-loop)

---

## Loop 1 — Fresh blank room ✅

**Angle:** issue #1 — "joined a new room but it was not a fresh blank state room."

**Tested as user:** clicked "Create blank room" on the live app (port 5273). It **threw a Convex
`ArgumentValidationError`** — a *shipped P0*: the client sent `seedArtifacts: blankLiveRoomArtifacts()`
(an 8-row sheet + Notes + Wall) but the deployed `rooms.create` validator only accepts
`{authToken, autoAllow?, code, hostName, title}`. So blank-room creation was **broken for every user**,
and even when it worked it wasn't blank. (This is the "dev Convex deploy ≠ Vite" lag class.)

**Root cause:** [src/ui/App.tsx:137-145](../../src/ui/App.tsx) — the create path seeded artifacts via a
field the deployed validator rejects. Two bugs in one: a broken P0 + a "blank isn't blank" smell.

**Fix:** dropped `seedArtifacts` from the create call → a genuinely blank room (0 artifacts), and the
call now matches the deployed validator exactly (P0 resolved with zero deploy dependency). Deleted the
now-dead `blankLiveRoomArtifacts()` helper + `LiveSeedArtifact` type.

**Verified live:** `?room=NRTQW1OELWS&name=Founder` → "Blank NodeRoom", status strip `SOURCES 0 artifacts`,
"Founder created the room", no error. (Prior console errors were all the single pre-fix request.)

**Founder insight:** the crowding (#3) and button overload (#4) the recording showed were largely
**driven by the demo seed** — a blank room is far calmer. So fixing #1 de-risks #3/#4. But the blank room
is now an empty black void with no guidance → that's exactly Loop 2.

---

## Loop 2 — Blank-state onboarding ✅

**Angle:** issues #1 + #4 — Loop 1's blank room was a black void. The deep-review spec
(L5284-5300) prescribes a blank-state with exactly **three obvious starts**, not an empty technical shell.

**Root cause:** [src/ui/panels/Artifact.tsx:121](../../src/ui/panels/Artifact.tsx:121) returned
`<div className="r-art-body" />` (literally nothing) for a 0-artifact room — no guidance.

**Fix:** added a `BlankRoomState` component rendered when `arts.length === 0`, with 3 real one-click CTAs:
- **"Ask the agent to build something →"** — focuses the chat composer (`data-testid="chat-composer"`).
- **"+ Add a blank sheet"** — `store.uploadArtifact(...)` creates a live sheet work surface.
- **"Load the sample diligence workspace →"** — navigates to the seeded demo (`/?demo=…`), so the demo
  is **opt-in**, not the default push (the root of issue #1).

**Verified live:** blank room now shows the 3 CTAs (no void). Clicked "Add a blank sheet" → a real
Spreadsheet rendered (r1–r8 × A/B/C), `SOURCES 1 artifacts`, trace "Founder added Sheet 1",
`edit_applied`. Typecheck green.

**Founder note:** this is the inversion the recording was missing — the user lands in calm, blank space
and *chooses* to summon data (chat / sheet / sample), instead of being dropped into a pre-filled war room.

---
