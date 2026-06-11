# Design QA handoff plan — every component, every interaction, every live visual

A self-contained execution plan for a full granular design/interaction audit of NodeRoom. It
generalizes the method that shipped 14 convention-cited fixes on 2026-06-11 (workflow
`design-mental-model-audit`: 3 research agents + 2 audit agents + vision-judge loop + live-DOM
verify — evidence in [`docs/eval/GIF_JUDGE.md`](../eval/GIF_JUDGE.md)). An executor — human or
agent — should be able to run this plan cold.

**The loop, proven:** research conventions → audit code against them → fix with citations →
capture real pixels → gemini-3.5-flash judges the shipped artifact → deploy → grep the live
bundle. Every phase below is that loop scoped to one slice of the app.

---

## Phase 0 — Ground rules (non-negotiable)

1. **Judge shipped artifacts, not intentions.** Screenshots/GIFs are decoded from what users get
   (the judge decodes `.gif` bytes; state captures are real Playwright pixels). Never send a GIF
   to Gemini as an image — it reads only frame 1 (probed 2026-06-11).
2. **Never weaken a rubric to pass** (HONEST_SCORES). Judge variance is ±0.4; scores 6.6–7.0 are
   "at the bar". After ~3 oscillating rounds on one item, document the plateau and move on.
3. **Every fix cites its convention** — a named open-codesign skill, brand ref, shadcn rule, or
   pattern-study finding. "Looks better to me" is not a justification.
4. **Live-DOM verify before claiming shipped**: new bundle hash + grep a concrete signal in the
   raw production JS (this protocol caught a second `null` bug and a stale prod bundle on the
   first run).
5. **Hot-file discipline**: `src/ui/panels/Artifact.tsx` and `src/app/styles.css` are co-edited
   by parallel agents — re-read immediately before every edit; never revert others' changes.
6. **Floor before every commit**: `npx tsc --noEmit` · `npx vitest run` · `npx playwright test` ·
   `npm run qa:matrix:check`. Deploy: `npx vercel deploy --prod` from the repo root.

---

## Phase 1 — Convention research (4 parallel agents, ~30 min)

Reuse the FINDINGS schema (topic / guidance-with-numbers / source) from the prior run. The
2026-06-11 research already covered: **buttons & hierarchy, inline accept/reject, color roles,
touch targets** — do not re-research those; their findings are encoded in the fixes of commits
`51721f8`/`2c74d9f`. New ground to cover, one agent each:

| Agent | Sources | Extract |
|---|---|---|
| R1 tables & grids | open-codesign `data-table.jsx`, `chart-rendering`, `loading-skeleton` skills; shadcn table/data-table docs; Linear/Notion brand refs | Row heights, hover/selection grammar, sticky headers, empty/loading states, cell editing affordances, column alignment rules |
| R2 chat & composer | open-codesign `app-shell-navigation`, `empty-states`, `craft-polish`; Slack/Discord/Linear composer patterns (WebSearch) | Composer affordances, send states, message hover actions, optimistic/failed-send rendering, slash-command hint UX |
| R3 motion & feedback | open-codesign `craft-polish`, `loading-skeleton`, `surface-elevation`; Emil Kowalski / Linear motion writing (WebSearch) | Transition durations/easings by element size, optimistic-update feedback, skeleton vs spinner rules, reduced-motion contract |
| R4 onboarding & overlays | open-codesign `empty-states`, `mobile-mock`; tour patterns (Linear/Figma first-run, WebSearch) | Spotlight tour conventions, dismissibility, focus trapping, z-index/scrim discipline, "skip" affordance expectations |

Each agent fetches `apps/desktop/resources/templates/skills/*.md` and `brand-refs/*/DESIGN.md`
from `github.com/OpenCoworkAI/open-codesign` (raw.githubusercontent) plus live docs. Output:
structured findings with sources. Merge into one `researchBrief` for Phase 3.

---

## Phase 2 — The inventory (what "every granular component" means)

Generated from code 2026-06-11 — regenerate before executing (grep `<button|<input|onClick` per
file). Each row is an audit unit; the counts are the coverage denominator.

| Surface (file) | Components | Interactive elements |
|---|---|---|
| `src/ui/Landing.tsx` | hero, join-inline, name field | 3 buttons, 2 inputs |
| `src/ui/RoomShell.tsx` | top bar, panel toggles, theme, room-code copy, auto-allow switch, leave, help | 12 buttons, 1 input |
| `src/ui/LeftRail.tsx` | file rows (clickable + static), upload, drag-to-chat | 2 buttons, 1 input, 2 drag |
| `src/ui/Chat.tsx` | Bubble (hover actions, edit-in-place, promote), composer + hints, job telemetry (cancel/retry), StreamedBody | 19 buttons, 2 inputs |
| `src/ui/panels/Artifact.tsx` | Wiki · Research (import, enrich, detail) · EditableCell · GenericSheet · ExcelGridSheet (formula bar, selection, merges) · Sheet (variance) · InlineProposal · Note (TipTap) · FileViewer · Wall · Sticky (drag, delete) · CollabBar · TraceStrip · ProposalRow · TraceRow | 23 buttons, 3 inputs, 26 click, 1 drag |
| `src/ui/GuidedTour.tsx` | spotlight, next/skip/replay | 4 buttons |

**State dimensions per element** (the granularity axis): default · hover · focus-visible ·
active/pressed · disabled · busy/loading · error · empty · and where applicable: locked ·
draft · conflict · proposal-pending. Cross-cut with: **theme** (dark/light) ×
**pointer** (fine/coarse) × **width** (1860 / 1280 / 768 / 375) × **reduced-motion**.
Full matrix ≈ 70 elements × ~6 applicable states × 4 cross-cuts — sampled, not exhaustive:
every element gets default+hover+focus in dark/1860; the cross-cuts get one representative
sweep per surface.

---

## Phase 3 — Code audit (6 parallel agents, one per surface row, ~40 min)

Prompt template (proven in `wf_9b8b9ab5-afb` — reuse its AUDIT schema with
id/file/line/severity/current/problem/proposed):

> You are auditing `<surface file>` of the NodeRoom app (repo root `<abs path>`). Read it
> END-TO-END plus every CSS block in `src/app/styles.css` its classNames touch. Audit each
> interactive element against these conventions: `${researchBrief}` + the encoded prior findings
> (flat primary, one-primary-per-view, ✓/✗ never ban-circle, value-carries-color, 24px inline /
> 44px touch floors, semantic --danger/--warning roles, looks-clickable-must-act, sign-aware
> value colors). For EVERY element check all applicable states (hover/focus/disabled/busy/error/
> empty). Concrete numbered fixes: exact current snippet, violated convention with source, exact
> proposed replacement. Stay inside the design DNA (dark room chrome, terracotta accent, plain
> CSS — translate conventions INTO this system).

Severity: P0 = founder-visible defect or honesty violation · P1 = convention violation with
user impact · P2 = polish. Cap 12 findings/agent, highest-impact first.

---

## Phase 4 — Live state capture (the "live usage visuals feels" half)

Build `e2e/state-captures.spec.ts` (pattern: `capture-previews.spec.ts`, memory mode, real
runtime). For each surface: drive to each state and screenshot to
`docs/qa/state-captures/<surface>/<state>--<theme>--<width>.png` + a `manifest.json`
(surface, state, what-must-be-true). Techniques:

- hover: `locator.hover()` then screenshot; focus: keyboard `Tab` to the element
  (focus-visible only triggers via keyboard); active: `mouse.down()` + screenshot + `mouse.up()`
- disabled/busy/error/empty: drive the real flows (empty paste → import error; run collab in
  review mode → proposal states; lock via collab → locked cells; kill textarea → empty)
- themes: click the theme toggle; widths: `page.setViewportSize`; reduced-motion:
  `page.emulateMedia({ reducedMotion: "reduce" })`; coarse pointer: audit CSS `@media (pointer:
  coarse)` blocks code-side (Playwright can't emulate pointer coarseness reliably)
- **Motion feel** can't be judged from stills: record the 6 interaction flows as GIFs through
  the existing dedupe encoder (composer send, cell edit→commit, proposal approve, tab switch,
  tour step, sticky drag) — these join the `qa:gif` suite permanently.

## Phase 5 — Vision judging

Extend the proven judge into `scripts/judge-state-captures.ts`: send each surface's capture set
(≤12 images + the manifest's what-must-be-true lines) to gemini-3.5-flash. Rubric per set:
**state_legibility** (is each state visually distinct and self-explanatory?), **affordance
honesty** (does clickable look clickable, inert look inert, disabled explain itself?),
**consistency** (same control grammar across surfaces?), **contrast** (both themes), **polish**.
Same bar: avg ≥ 7, no dimension < 5; verdicts to `docs/qa/state-judge/<surface>.json`. Motion
GIFs go through the existing `npm run qa:gif`.

## Phase 6 — Fix loop and ship

1. Merge Phase 3 + Phase 5 findings into one P0/P1/P2 list; dedupe against the open-items
   register below.
2. Fix P0s and P1s (convention citation in every commit message), P2s as time allows.
3. Re-capture + re-judge only the affected sets; re-record affected workflow GIFs.
4. Floor → commit → push → `npx vercel deploy --prod` → live bundle grep (new hash + one
   concrete string per fix) → update `GIF_JUDGE.md` scoreboard from disk truth.

---

## Hand-back contract (what done looks like)

- `docs/qa/state-captures/**` + manifests — the full visual record
- `docs/qa/state-judge/*.json` + GIF verdicts — every set judged, scoreboard regenerated
- Fixes shipped with convention citations; floor green; live bundle verified (hash + signals)
- A residuals list: every plateau, every deferred P2, every "needs product decision" — named,
  not hidden

## Open-items register (don't rediscover these)

1. Lock badges still wear the CTA accent — full fix is holder-presence colors (plumbing: pass
   `lk.holder` color through `.xl-cell.locked` / `.lockbadge` / `.xl-flag` as a CSS var).
2. `app-manual-edit` GIF plateaued at 6.2 (tiny-story density) — needs a tighter recording.
3. Landing name field renders below the CTAs that consume it + placeholder-as-label (P2).
4. `r-fresh.stale` dark-theme line is a redundant no-op after tokenization (cosmetic).
5. Glide Data Grid stays the gated Phase-4 grid contingency (see `docs/UI_EXCEL_PAPER.md`).

## Budget

Prior run: 5 agents ≈ 830k tokens ≈ 13 min wall. This plan: ~10 agents research+audit (Phases
1+3 parallel ≈ 1.5–2M tokens), Phase 4 build ≈ 2–3 h once, judging ≈ $0.05/run (Gemini Flash),
fix loop dominated by re-capture cycles (~5 min each). Run Phases 1–3 in one Workflow
invocation; Phases 4–6 are iterative local work.
