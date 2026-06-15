# NodeRoom Open Design Redesign Direction

Reusable visual direction for the next NodeRoom redesign pass, following the
Open Design nine-section `DESIGN.md` contract shape.

## 1. Visual Theme & Atmosphere

NodeRoom should feel like a calm multiplayer diligence room, not a generic AI
chat app, not a trading terminal, and not a consumer game. The first impression
should be: structured, credible, collaborative, and alive.

The target blend:

- Notion: calm workspace, quiet object structure, progressive disclosure.
- Quadratic: spreadsheet-native AI, explainable analysis beside the grid.
- Attio: company-centric object intelligence and workflow state.
- Duolingo: visible progress and completion feedback, heavily restrained.
- Figma: multiplayer presence tied to exact objects.
- Open Design: artifact-first generation, explicit design contract, critique loop.

The product should make the next useful action obvious while keeping the room
stable. Intelligence changes emphasis, not the core workflow.

## 2. Color

Use a quiet professional palette with one warm agent accent and explicit state
colors. Avoid decorative gradients, purple-blue dominance, beige/tan dominance,
and one-hue interfaces.

Core roles:

- App background: deep neutral graphite for focus, or warm off-white for light mode.
- Primary surface: one step above background, with low-contrast borders.
- Work surface: highest clarity, with spreadsheet/artifact content carrying focus.
- Agent accent: restrained terracotta/orange, used for agent locks, coach cues,
  and primary AI actions.
- Review warning: amber only when human review is needed.
- Success: green only for completed/approved/exported states.
- Error/risk: red only for failed checks, missing evidence, or blocked actions.
- Info/source: blue only for source-backed evidence and references.

Rules:

- Spend color only on real state.
- Never color every chip by category at rest.
- In a calm state, the room should read mostly neutral.
- If everything is colorful, the design has failed.

## 3. Typography

Use a sober UI stack:

- UI/body: Inter or the existing app font stack.
- Mono/data/source locators: JetBrains Mono or the existing mono stack.
- Numerics: tabular numerals for financial tables, run metrics, runway months,
  valuation, ARR, burn, and confidence.

Rules:

- No viewport-scaled font sizes.
- Letter spacing should remain 0 in app UI.
- Use weight and placement for hierarchy, not oversized headings inside panels.
- Dense panels should use compact headings, not hero-scale type.
- Long evidence and research text should clamp to one or two lines until opened.

## 4. Spacing & Grid

Use a compact 4px/8px rhythm:

- 4px: inline gaps, tight metadata.
- 8px: default element gap.
- 12px: panel internal spacing.
- 16px: larger groups.
- 24px: major layout separation.

The redesign should reduce visual noise through alignment before adding more
surface styling. Repeated controls, cells, cards, and toolbar buttons need
stable dimensions so hover states and dynamic labels do not shift layout.

## 5. Layout & Composition

Keep the room workflow stable:

1. Join or create room.
2. Add companies, files, and context.
3. Agent gathers evidence.
4. Artifacts update.
5. Banker coach reviews.
6. Humans approve, reject, or ask for changes.
7. Findings export or downstream to other systems.

Primary surfaces:

- Left rail: room/session orientation, people, active objects, and files.
- Center chat: human conversation and agent requests.
- Work surface: artifact, spreadsheet, report, proposal, or chart.
- Coach panel: next useful diligence review cue, evidence, and approval state.

Resting view should show roughly 12 to 14 meaningful controls, not 25 plus. Any
control that is not useful now should be hidden, merged, or revealed only when
the relevant state exists.

## 6. Components

Room header:

- Keep room identity, invite/share, presence, and one session control.
- Move theme, tour, and secondary toggles out of the always-on path.

Progress spine:

- Show the workflow stage as a quiet, compact status line.
- Example: `Intake ready -> Evidence running -> Coach review -> Export ready`.
- Use the Duolingo lesson-path idea only as clarity of progress, not as game UI.

Work surface:

- Spreadsheet/table data should be compact and scannable.
- Use sticky headers, single-line truncation, and structured chips.
- Evidence-backed cells must be inspectable.
- Agent locks and human edits should be visible at the exact cell/range.

Banker coach:

- One main cue at a time.
- Evidence cards open source artifacts side-by-side.
- Proposal refs from chat must resolve to the target artifact and focused cell/block.
- Review actions should be explicit: accept, reject, ask for more evidence.

Chat:

- Chat steers the work; artifacts render the work.
- Artifact refs should be compact chips with clear error states for stale refs.
- Streaming responses should show useful intermediate state without flooding the UI.

Downstream handoff:

- Show only when a draft/export exists.
- Group destinations by outcome, not logo grid.
- The resting room should not show Slack/Notion/Gmail/Linear/LinkedIn buttons
  before there is anything to send.

## 7. Motion & Interaction

Motion should explain state changes:

- Agent started, evidence found, proposal created, review accepted, export ready.
- Prefer short 120ms to 220ms transitions.
- Use focus pulses only for exact-object navigation, such as jumping to a locked
  cell or source evidence.
- Respect `prefers-reduced-motion`.

No decorative motion. No animated background. No celebration loops in diligence
workflows. Completion feedback should be quiet and confidence-building.

## 8. Voice & Brand

Voice is terse and professional:

- Use nouns and verbs.
- Avoid hype, mascots, jokes, or marketing phrases inside the product.
- Show evidence and state before explanation.
- Banker coach copy should read like a competent associate/reviewer, not a
  generic assistant.

Good labels:

- `Evidence missing`
- `Review proposal`
- `Open source`
- `Export draft ready`
- `Runway assumptions changed`

Bad labels:

- `Unlock your workflow`
- `Magic insight`
- `Supercharge diligence`
- `Amazing AI recommendation`

## 9. Anti-patterns

- Do not add a command palette as the primary fix for clutter.
- Do not clone Open Design, Notion, Duolingo, Quadratic, Attio, or any other
  reference literally.
- Do not copy logos, mascots, pricing claims, proprietary screens, or exact UI.
- Do not make NodeRoom playful in the Duolingo sense; borrow progress clarity only.
- Do not hide trust state that is actionable after a run, such as missing evidence
  or pending review.
- Do not show downstream integrations before a draft exists.
- Do not show all agent telemetry at rest.
- Do not make charts decorative; every chart needs data provenance.
- Do not let chat become the only output surface.
- Do not let agent learning silently mutate approved artifacts.
