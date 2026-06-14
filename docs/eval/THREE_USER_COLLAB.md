# Eval - Three Users, One New Room, Concurrent Collaboration

**What it proves:** three real browser users in a brand-new Convex room can chat, edit the same spreadsheet concurrently, use public/private agents, review proposals inline, and converge without silent clobbering. The proof is DOM-based and screenshot-backed, not a memory-mode simulation.

**Why it matters:** this is the product path that separates NodeRoom from a prompt wrapper: human edits, optimistic UI, server-side CAS, reactive fan-out, private agent isolation, and host-reviewed agent proposals all have to work together.

## Environment

- Live Convex backend through `VITE_CONVEX_URL` / `E2E_CONVEX_URL`.
- Provider keys for the `/ask` and private-agent steps.
- Brand-new room each run with an alphanumeric code:
  - Host: `/?create=EVALxxxx&name=Maya`
  - Members: `/?room=EVALxxxx&name=Dev`, `/?room=EVALxxxx&name=Sam`
- The test suppresses the first-run tour before navigation so it does not intercept spreadsheet clicks.

## Personas

| User | Role | URL |
|---|---|---|
| Maya | Host | `/?create=EVALxxxx&name=Maya` |
| Dev | Member | `/?room=EVALxxxx&name=Dev` |
| Sam | Guest | `/?room=EVALxxxx&name=Sam` |

## Acts

1. **Join:** Maya creates the room and seeds the Q3 variance sheet; Dev and Sam join by code. Pass means every view shows all three people.
2. **Public chat:** all three users post messages. Pass means every message fans out to every public chat feed.
3. **Parallel non-conflicting edits:** Dev and Sam edit different variance cells. Pass means both values land in all three views.
4. **Same-cell conflict:** Maya and Dev write the same cell near-simultaneously. Pass means CAS picks one winner and all three views converge to that value.
5. **Public room agent:** Maya asks the public agent to reconcile the sheet. This is real-provider dependent; the run records whether a visible effect appears inside the timeout.
6. **Private agent isolation:** Maya asks her private agent. Pass means her private channel gets the response and Dev/Sam do not see the question or private reply.
7. **Personal agent in room lane:** Maya uses her private panel's room lane. Pass means the shared sheet or public chat changes are visible to all users.
8. **All-artifact visibility:** every view has Spreadsheet, Note, and Wall surfaces.
9. **Review-mode proposals:** host turns auto-allow off, agent files an inline proposal, Dev/Sam see view-only chips, Maya approves, and the approved value fans out to every browser.

## Latest Strict Evidence

- **2026-06-14 PT:** `npm run test:product:live:agent`
- **Result:** 10/10 Playwright specs passed against live Convex + provider calls in 4.3 minutes.
- **Room:** `EVALMQDI9ZP4`
- **Same-cell winner:** `+19pct-Dev`
- **Public room agent:** no visible effect within 150s on this run; recorded as real-provider dependent, not promoted as a hard pass.
- **Private agent:** replied privately.
- **Personal room-lane agent:** acted in the room and was visible to all users.
- **All artifacts:** Spreadsheet + Note + Wall visible in all views.
- **Review mode:** `r_rev__note` proposal approved by host and fanned out to all users.

## Pass Criteria

- The strict product gate passes only when chat, spreadsheet workbook behavior, live Convex reactivity, CAS conflict convergence, semantic rebase review, and three-user review-mode proposal fan-out all pass.
- Real-provider effects that are intentionally best-effort are recorded in the JSON evidence printed by the test. They are not used to hide a failed deterministic collaboration contract.

## How To Run

```bash
npm run test:product:live
npm run test:product:live:agent
```

The second command requires provider credentials. It sets `E2E_LIVE=1` and `E2E_REQUIRE_REVIEW_MODE=1` through `scripts/live-product-gate.ts`, starts the Vite app against live Convex, and runs the three-user strict gate after the deterministic browser/backend gate.
