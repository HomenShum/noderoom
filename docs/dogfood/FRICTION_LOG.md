# Friction log — append-only

## 2026-06-09 - Walkthrough capturer found a real returning-visitor bug

| Stoplight | Moment | Expected | What happened | Disposition |
|---|---|---|---|---|
| 🔴 | Reload (or revisit) a live room after the tour was already seen | The 4-panel workspace | **Chat-only layout** — panels initialized from `live && !isCompact` where `live` (=isHost) is still false at mount while Convex queries load; only the first-run tour ever forced panels open, so every RETURNING visitor got chat-only | Fixed same day: panels now init from viewport only (`RoomShell.tsx`); deployed + live-verified |

Found mechanically by the README-walkthrough capturer's reload path (`scripts/walkthroughs/capture.ts`,
seedResearchRoom) — a state no demo run or first-visit eval ever exercised. The capture pipeline is
itself a dogfood instrument: it walks cold-user paths frame by frame and freezes the UI state on
every failure (`zz-fail.png` forensics).

## 2026-06-09 - LIVE verification of the three red fixes (noderoom.live + deployed Convex)

| Fix | Live evidence | Status |
|---|---|---|
| Undo (Ctrl/Cmd+Z) | Two SEPARATE browser contexts, fresh prod room: hand edit → Undo → reverted in the host **and** in the member view (member sheet presence-asserted before the claim) — real CAS round-trip, not memory mode. | ✅ proven |
| In-cell approve/reject | Live `/ask` with auto-allow off: 2 inline chips rendered at the cells, **coalesced (no duplicate chips per cell)**, inline approve applied `+24.0%` host-side. Strict live Act 9 then passed in room `EVAL-MQ7DB1BZ`: all three browsers saw the `r_rev__note` proof proposal, Dev/Sam had view-only `host` chips, and Maya's inline approval cleared/applied the value everywhere. | ✅ proven cross-browser live |
| Re-import upsert | Deterministic mutations on the deployed backend: add "Acme Corp" → set sourced `summary` → re-import same company/domain → **1 row group** (no `acme_1`), `owner` updated to the new value, **sourced summary survived**. | ✅ proven |

Probe lessons (so the next run doesn't repeat them): use one browser context per persona (shared
localStorage makes page 2 reuse page 1's session); assert an element EXISTS before any
"doesn't-contain-X" claim (negative predicates pass vacuously on a missing sheet); section every
probe with its own try/catch or one failure erases all other evidence. 2 of 4 live `/ask` runs
produced nothing (provider flake) — review-mode acts stay best-effort like eval Acts 5/7.

## 2026-06-09 - Resolution pass for three red findings

| Finding | Resolution | Evidence |
|---|---|---|
| No undo | Added a visible spreadsheet Undo control plus Ctrl/Cmd+Z routing through the same CAS mutation path. | `src/app/store.tsx`, `src/ui/panels/Artifact.tsx` |
| Proposal approval away from the cell | Added inline approve/reject controls on cells with pending proposals; trace strip remains the audit and bulk-accept path. Review-mode agents now treat pending approval as a handoff and duplicate pending writes are coalesced. | `src/ui/panels/Artifact.tsx`, `src/app/styles.css`, `src/agent/plans.ts`, `src/engine/roomEngine.ts` |
| Re-import duplicates accounts | Changed research import to update existing rows by company/domain identity and preserve sourced research fields. | `src/engine/roomEngine.ts`, `convex/artifacts.ts`, `tests/roomEngine.test.ts` |

Format (Stripe practice, Google stoplight — see [INTUITIVENESS_QA.md](./INTUITIVENESS_QA.md) §3B):
log **while doing a real task**, never retrospectively. Every entry must end as a filed issue
or a written won't-fix reason.

> 🟢 delightful / worked first try · 🟡 frustrating, found a way · 🔴 would have given up if this weren't my job

---

## 2026-06-09 — Convention-parity sweep (persona: close-review host + GTM list owner)

**Context:** first run of the intuitiveness instrument; code-level sweep against the
muscle-memory benchmark (Excel/Sheets, Slack, Docs, HubSpot).

| Stoplight | Moment | Expected (because…) | What happened | Disposition |
|---|---|---|---|---|
| 🟢 | Esc mid-cell-edit | Excel: Esc cancels | Cancels, restores prior value | — |
| 🟡 | Enter on cell commit | Excel: commit + move down | Commits, stays put | Won't-fix for 5-row sheet; revisit on bigger grids |
| 🟡 | ↑ in chat composer | Slack: edits my last message | Nothing; must hover → pencil | Fix queued |
| 🟡 | Paste a 3×2 range onto the sheet | Sheets: fills 6 cells | Single-cell input only | Defer — research import is the bulk path (reason logged) |
| 🔴 | Made a bad edit, want it back | Sheets: Ctrl+Z | No undo anywhere; hand-revert | Fix queued — versions already exist server-side, surface them |
| 🔴 | Approve the agent's proposed cell edit | Docs: Accept sits next to the change | Must scan the bottom activity strip, find it, approve | Fix queued — in-context approve chip at the cell; keep strip for "Accept all" |
| 🔴 | Re-paste the same account list | HubSpot: updates existing records | Creates `acme_1` duplicate rows | Fix queued — dedupe by company key on import |
