# NodeRoom Open Design Redesign Handoff

## Open Design Prototype

- Project: `noderoom-banker-diligence-redesign`
- Run: `a3c689e5-2b03-4753-a7f4-1198717b1787`
- Preview: <http://127.0.0.1:7456/api/projects/noderoom-banker-diligence-redesign/raw/index.html>
- Source: `C:\Users\hshum\.codex\tools\open-design\.od\projects\noderoom-banker-diligence-redesign\index.html`

The prototype is a dense product work surface for the JPM MMB / startup banking
diligence demo. It covers active room, fresh join, side-by-side evidence,
stale chat reference, and export-ready states from a bottom prototype-state
dock.

Browser verification on 2026-06-15 passed for:

- Resting layout: artifact `920px`, hidden evidence `0px`, banker coach `360px`.
- Evidence open: artifact `500px`, evidence `420px`, banker coach `360px`.
- Fresh join: modal covers the work surface and shows `Join room`.
- Stale ref: `proposal #ref-198` exposes the expired-ref explanation.
- Export ready: chat banner appears, export count flips to `1`, and Slack,
  Notion, and Gmail targets are visible.
- Console: no warning or error logs reported by the in-app browser.

Polish pass on 2026-06-15:

- Reworked the first-pass dark dashboard palette into a lighter finance
  workbench palette: neutral shell, white panels, blue evidence, warm-orange
  agent activity, green approvals, amber review, red missing/expired state.
- Tightened the header, progress spine, table rows, sticky headers, row hover,
  coach cue, evidence cards, chat input, and export banner so each surface has
  a clearer job and hierarchy.
- Moved prototype-state controls out of the chat area and into a smaller
  floating inspector above the chat.
- Removed visible em dash copy from the prototype.
- Rechecked desktop states after polish:
  active `1207 / 0 / 360`, evidence-open `787 / 420 / 360`, fresh join,
  stale ref, and export-ready all pass.
- Rechecked mobile at `375x812`: no horizontal overflow, coach/evidence
  collapse, rows remain visible, and state controls remain above chat.

Manual OD fixes applied after generation:

- Collapsed the evidence grid column in the resting state so the Banker Coach
  stays in the right rail.
- Made evidence-open deterministic with an explicit three-column grid.
- Moved export-ready styling to a body-level state because the banner lives in
  the chat rail, outside `main`.
- Expanded the fresh-room overlay to cover the work surface instead of only the
  artifact pane.

## Files To Read First

- `docs/design/open-design-redesign/DESIGN.md`
- `docs/design/open-design-redesign/design-contract.md`
- `docs/DESIGN.md`
- `docs/design/DESIGN_BENCHMARK.md`
- `src/ui/RoomShell.tsx`
- `src/ui/panels/Artifact.tsx`
- `src/ui/Chat.tsx`
- `src/ui/artifacts/BankerCoachPanel.tsx`
- `src/app/styles.css`

## Implementation Order

1. Clean the resting shell.
   - Hide idle telemetry.
   - Keep only useful room controls.
   - Remove theme/tour/secondary toggles from the always-on path.

2. Make workflow progress visible.
   - Add a compact progress spine for intake, evidence, coach review, approval,
     and export.
   - Show only state that is true now.

3. Make banker coach the trust layer.
   - One main cue at a time.
   - Evidence cards open side-by-side with the source artifact.
   - Accept/reject/ask-for-more are the primary actions.

4. Improve artifact and table clarity.
   - Sticky headers.
   - One-line clamped cells.
   - Source/status chips.
   - Exact-object focus for agent locks and proposal refs.

5. Gate downstream handoff.
   - Hide provider buttons until a draft exists.
   - Show one compact export/draft-ready state first.

6. Verify visually.
   - Fresh room.
   - Join flow.
   - Memory demo room.
   - Startup diligence demo.
   - Side-by-side evidence opening.
   - Stale chat ref error.
   - Mobile at 375px and desktop at 1440px.

## Token And Style Constraints

- Use existing CSS tokens where possible.
- Add tokens only for semantic roles that appear in multiple components.
- One warm agent accent.
- Amber only for pending review.
- Green only for complete/approved/exported.
- Red only for failed/blocked/missing evidence.
- Blue only for source/evidence/link state.
- Letter spacing stays 0.
- Cards stay at 8px radius or less unless preserving an existing system rule.
- No decorative orbs, blobs, generic gradients, or marketing hero patterns.

## Acceptance Notes

The first redesign artifact should prove three things:

1. A new user can join a room and understand where to act.
2. A banker can see progress, evidence, and review state without reading chat.
3. A coach cue can open the exact evidence side-by-side and resolve proposal refs
   from chat without confusion.

Do not start by adding a command palette. Start by subtracting, then improving
state hierarchy, then tightening evidence and progress surfaces.
