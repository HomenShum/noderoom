<!-- Provenance: QA/UI workflow wf_b8bf60f5-61d (2026-06-09): 6 agents (live e2e probe, layout, a11y, perf, research, synthesis), 665k tokens. Status notes added post-implementation. -->

<!-- STATUS-UPDATE 2026-06-09 (post-implementation): BOTH P0s are FIXED and hard-assert-verified —
     panels render as fixed overlays <=980px with visible toggles (src/app/styles.css) and show-state inits from
     matchMedia (src/ui/RoomShell.tsx isCompact); e2e/responsive-qa.spec.ts passes 4/4 viewports with hard asserts
     (toggle >=24px, toggle tap -> visible artifact-panel, no overflow 375-1860). Also done: touch targets,
     chat overflow-wrap, research min-width + paging, proposals slice, stale-badge contrast, a11y labels/keyboard,
     optimistic toggle/proposal updates, memo batch. STILL OPEN: two-pane 641-980 tier (cut by its own
     only-if-small condition), room-code-on-phone modal, two-client conflict GIF (needs E2E_CONVEX_URL). -->

# NodeRoom QA/UI Fix Plan — synthesized from 4 audits (responsive e2e probe, static layout, a11y/interaction, performance) + reference-app research

**Repo:** `D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom` · **Date:** 2026-06-09
**Constraint compliance:** zero existing source files edited during the audit; every cited `file:line` re-verified against the working tree this session; the only new artifact is the already-added additive probe `e2e/responsive-qa.spec.ts`. ~80 dirty files from a parallel agent and the overnight eval loop were left untouched.
**Altitude rule applied:** no redesigns, no component libraries. Every fix below is the smallest change that addresses the root cause (most are single CSS rules or one-hook memoizations).

## Verified baseline (evidence, no fix needed)

- Existing e2e suite: **7 passed / 0 failed / 3 skipped in 27.9s** (skips are `reactivity.backend.spec.ts` A/B + `three-user-collab.spec.ts`, gated on `E2E_CONVEX_URL` by design per `playwright.config.ts:10-12`).
- New probe `e2e/responsive-qa.spec.ts`: **4/4 green** at 375x812 / 768x1024 / 1280x800 / 1860x900. Zero horizontal overflow at every viewport (`documentElement.scrollWidth <= width+1`); chat composer visible at all 4; artifact-tabs bounding box fully inside viewport at 1280/1860. Screenshots: `test-results/responsive/{phone-375x812,tablet-768x1024,laptop-1280x800,desktop-1860x900}.png`.

## Root cause analysis (why the P0 exists)

One CSS line is the upstream cause of the three worst findings:

```css
/* src/app/styles.css:404 */
@media (max-width: 980px) { .r-panel.left, .r-panel.artifact, .r-panel.right, .r-resize { display: none; } .r-panel.center { flex: 1; } .r-toggle-group { display: none; } }
```

It deletes 3 of the 4 product surfaces **and** the only recovery affordance (the toggle group, `src/ui/RoomShell.tsx:174-177`) at the same breakpoint. React state still works — `openArtifact()` at `RoomShell.tsx:55-58` correctly sets `show.artifact = true` when a chat ref-chip or LeftRail file is tapped (wired at `:193,195,199`) — but the CSS unconditionally overrides it, turning those taps into silent no-ops. Industry pattern check (Slack iPad/phone, Figma UI3, Linear mobile, Notion): production multi-panel apps **re-route** panels at small widths (bottom tabs, overlays, sheets); none delete them. Probe screenshots `phone-375x812.png` / `tablet-768x1024.png` show only the public chat with no path back.

---

## P0 — broken/unusable

### P0-1 · 3 of 4 panels + their toggles unreachable below 981px
- **Where:** `src/app/styles.css:404`; toggle group `src/ui/RoomShell.tsx:174-177`; default show-state `RoomShell.tsx:28`.
- **Evidence:** CSS quoted above; probe annotations `no-path-to-artifact` at both small viewports; screenshots above. Artifact tabs (Wiki/Spreadsheet/Research/Note/Wall, `src/ui/panels/Artifact.tsx:67-72`), files/people rail (`src/ui/LeftRail.tsx`), and private agent (`src/ui/Chat.tsx:190`) all unreachable.
- **Smallest fix (3 edits, one concern):**
  1. In the 980px media query, **delete** `.r-toggle-group { display: none; }`.
  2. In the same query, replace panel `display:none` with overlay positioning so a mounted panel renders over chat: `.r-panel.left, .r-panel.artifact, .r-panel.right { position: fixed; inset: 60px 8px 8px; z-index: 50; }` (panels are already conditionally mounted via `show` at `RoomShell.tsx:193-199`, so the toggles instantly become a working panel switcher).
  3. Initialize `show` to `{ left: false, artifact: false, priv: false }` when `matchMedia('(max-width: 980px)').matches` at `RoomShell.tsx:28`, so chat is the default single pane and panels appear one at a time.

### P0-2 · `openArtifact()` silent no-op — ref-chips and file taps do nothing on small screens
- **Where:** `src/ui/RoomShell.tsx:55-58` (state set), `src/app/styles.css:404` (state overridden).
- **Evidence:** verified this session — the function flips `show.artifact` but CSS `display:none` wins below 981px.
- **Smallest fix:** resolved by P0-1 edit #2 (no logic change needed — state flow is already correct). Lock with the e2e assert in P1-11.

---

## P1 — degraded experience

1. **Research table 800px min-width** — `styles.css:328` (`min-width: 800px`), colgroup totals 1072px (`Artifact.tsx:275-278`). Fix: `@media (max-width: 640px) { .r-research { min-width: 0; } .r-research-detail { grid-template-columns: 1fr; } }` (`:342`); the existing click-to-expand detail row already carries overflow data.
2. **Touch-target pass (one media block fixes 5 findings)** — `.r-iconbtn` 32px (`styles.css:68`), `.r-tab` ~27px (`:202`), `.r-mini-btn` 24px (`:379`), `.r-postit-delete` 22px + hover-only reveal (`:305`), `.r-resize` 7px pointer-drag-only (`:100`, handler `RoomShell.tsx:224-233`). Fix: single `@media (pointer: coarse)` block — iconbtn/tab to 44px, mini-btn min-height 40px, postit-delete `opacity:1` + 28px, resize `display:none`. WCAG 2.5.8 floor is 24px; Apple HIG 44pt; Material 48dp.
3. **Research rows keyboard-dead** — `Artifact.tsx:302`: `<tr onClick=...>` with `aria-selected` but no `tabIndex`/`onKeyDown`. Fix: `tabIndex={0}`, Enter/Space → same `setExpanded`, add `aria-expanded`.
4. **Post-it contentEditable missing name + key handling** — `Artifact.tsx:709-710`. Fix: `role="textbox"`, `aria-label="Edit post-it text"`, Escape → blur (existing `onBlur` at `:710` already commits). *Correction to input audit: contenteditable elements are tabbable by default — no `tabIndex` needed.*
5. **Chat text no wrapping rule** — `styles.css:145`. Long URLs/code overflow the flex column. Fix: `overflow-wrap: anywhere;` on `.r-msg .text`.
6. **Landing squashed at 375px** — `.r-feature-grid` `repeat(3, 1fr)` (`styles.css:394`) + 56/32 padding (`:385`) leaves ~100px cards. Fix: `@media (max-width: 640px) { .r-feature-grid { grid-template-columns: 1fr; } .r-landing { padding: 32px 16px; } }`.
7. **Tour card unclamped + anchors to hidden elements** — `.r-tour-card` no max-width (`styles.css:417`); tour auto-opens for first-time visitors (`RoomShell.tsx:42-48`) and steps target selectors that are `display:none` below 981px (`:76-110`). Fix: `max-width: calc(100vw - 24px);` + e2e check that hidden-anchor steps fall back to center placement at 375px.
8. **Contrast on tinted chips** — `.r-fresh.stale` is `#a15b2d` on `rgba(217,119,87,.1)` (`styles.css:353`); `.faint` (`:51`, `#9ca3af`/`#66717c`) used inside accent-tint chips (`:152`). Fix: bump stale text to clear AA 4.5:1 per theme; use `.muted` instead of `.faint` on tinted backgrounds.
9. **Missing optimistic updates on visible-state mutations** — verified `store.tsx`: `.withOptimisticUpdate` exists only on `applyCellEdit`/`sendMsg`/`editMsg` (`:319/:334/:343`); missing on `toggle` (auto-allow, `:339`) and `resolveProposalMutation` (`:349`), so the switch and proposal cards lag a server round-trip in convex mode. Fix: add optimistic updates to those two, matching the existing pattern. (Scope discipline: skip the job mutations — they have honest in-flight UI already, `Chat.tsx:203-214`.)
10. **Research sheet renders all rows unpaginated** — `Artifact.tsx:283-324` maps every `rowId`; the GenericSheet paging pattern already exists at `:469-470,501`. Fix: reuse the same `pages` state + \"Show next N\" footer button. *Correction to input audit: GenericSheet itself is already bounded — only Research lacks paging.*
11. **Regression gate** — extend `e2e/responsive-qa.spec.ts` (additive file, allowed) to hard-assert at 375/768px: (a) a >=24px navigation affordance to each of the 4 panels exists, (b) tapping a chat ref-chip yields a visible `[data-testid=artifact-panel]`, (c) no horizontal overflow (already asserted). Flip the current `no-path-to-artifact` annotations to failures once P0-1 lands.

---

## P2 — polish

1. **Top-bar mid-token wrap (641-980px)** — `r-`/`86w` and `Auto-`/`allow` wrap at the hyphen; screenshot `tablet-768x1024.png`. Fix: `white-space: nowrap; flex-shrink: 0;` on `.r-roomcode` (`styles.css:61`) and `.r-pill-auto` (`:79`).
2. **640px condensation deletes the room code** — `styles.css:408` hides the share/join mechanism on the device most likely to join by code. Fix: relocate behind a tap on the room title (reuse `.r-modal`) instead of `display:none`.
3. **Icon buttons title-only accessible names** — `RoomShell.tsx:175-177` (toggles), `:189` (leave), `Chat.tsx:205,210` (job cancel/retry). Fix: explicit `aria-label` each. *Correction: `RoomShell.tsx:187` tour button already has `aria-label="Take the guided tour"` — that input finding was a false positive.*
4. **Post-it 168px ≈ 45% of a 375px screen** — `styles.css:302`. Fix: `@media (max-width: 480px) { .r-postit { width: 128px; } }`.
5. **Dense-data readability** — wiki metrics force 4 columns (`styles.css:254`); `.r-cell-meta` 9px (`:220`). Fix: one `@media (max-width: 768px)` block: metrics 2-col, cell-meta 10px.
6. **Hot-path inline allocations (micro-memoization batch)** — Sticky drag style rebuilt per render (`Artifact.tsx:706-707`), 12-entry detail array per row inside the Research map (`:290-299`), Bubble avatar style per message (`Chat.tsx:271`), `columnsOf`/`pageSize` per render (`Artifact.tsx:467-469`). Fix: `useMemo` each with real deps.
7. **Unbounded proposal render** — `Artifact.tsx:773` renders all proposals while traces are capped at 40 (`:760`). Fix: `proposals.slice(0, 20)` + \"+N more\".
8. **Medium-tier refinement (after P0 verified)** — between 641-980px render chat + ONE toggled panel side-by-side instead of overlay (M3 medium / Slack semi-compact). Explicitly deferred: enhancement, not a blocker.

---

## Corrections to the input audits (false positives caught during verification)

| Claim | Reality |
|---|---|
| Tour button `RoomShell.tsx:187` missing aria-label | Has `aria-label="Take the guided tour"` — verified |
| contentEditable post-it \"cannot be reached via Tab\" | contenteditable elements are focusable/tabbable by default; the real gaps are accessible name + Escape handling |
| GenericSheet renders unbounded rows | Paging exists (`Artifact.tsx:469-470,501`); only the Research table lacks it |
| GuidedTour needs aria-modal fix | `aria-modal="false"` is intentional and correct (non-focus-trapping spotlight); only optional `aria-live` polish |

## Suggested order & verification

1. **P0-1/P0-2** (styles.css:404 + RoomShell.tsx:28) → run extended `e2e/responsive-qa.spec.ts` → screenshots at 375/768 showing artifact overlay reachable via toggles and ref-chips.
2. **P1 CSS batch** (items 1,2,5,6,7,8 — all additive media-query/one-line rules in styles.css) → re-run probe, zero-overflow assert must stay green.
3. **P1 interaction batch** (items 3,4 — Artifact.tsx) → keyboard e2e: Tab to research row, Enter expands.
4. **P1 perf batch** (items 9,10 — store.tsx/Artifact.tsx, convex mode) → manual: auto-allow switch flips instantly; 600-row paste stays responsive.
5. **P2** when touched.

All fixes wait until the parallel agent's ~80 in-flight files settle — every item above is small enough to rebase trivially.