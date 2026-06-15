# NodeRoom -- Visual Design and UX Benchmark

> THESIS: NodeRoom should feel like a calm multiplayer diligence workspace where AI makes the next
> useful action obvious, evidence is always inspectable, and progress through the workflow is visible
> -- without adding more controls.

ASCII-only on purpose (no em-dash / arrow / middot / star glyphs): the doc gets pasted into decks,
READMEs, and Windows-1252 contexts where Unicode punctuation mojibakes. Use `--`, `->`, `|`, `*`.

---

## Organizing principle: stable room, learned emphasis (quiet UI learning)

Keep the room stable; let the intelligence change the EMPHASIS, not the workflow. The diligence spine is
fixed and boring on purpose: `Intake -> Evidence -> Draft -> Coach review -> Human approval -> Export`.
Learning improves judgment, defaults, ranking, and timing INSIDE that spine -- it never adds a stage, a
control, or a command palette.

What the UI should LEARN to do (each makes it quieter, never busier):
* foreground the artifact that matters right now; recede the rest
* surface the evidence relevant to the current claim; hide the irrelevant
* flag which company is blocked, which proposal needs review, which handoff is ready
* learn which warnings are noise and stop showing them
* make the single most-likely-useful next action obvious

What it must NEVER do: add visible controls, add a launcher, or restyle the workflow to look "smarter".
The visible result of learning is FEWER things, better timed -- the design face of the same event-log +
evidence-ledger substrate the harness review describes (persisted CoachCue / EvidenceCard / analytics
events; see [HARNESS_REVIEW.md](../founder-loop/HARNESS_REVIEW.md)). Learning and subtraction are the same
project: the system learns WHAT TO LEAVE OUT.

The blend for NodeRoom: Notion calm structure | Quadratic analytical transparency | Attio entity
intelligence | Duolingo progression restraint | Figma multiplayer presence | Cursor/Claude review-and-merge
discipline | Linear/Vercel/Stripe restraint and state clarity.

### Progression spine (Duolingo restraint, not gamification)
Render the spine as a quiet, completeable progression -- one legible "where is this company/artifact?"
ribbon that REPLACES scattered per-signal status, not adds to it:

`Intake -> Evidence -> Draft -> Coach review -> Approval -> Export`

* each stage feels finishable (a calm check when its contract is satisfied) so complex diligence feels
  bounded -- Duolingo's restraint, none of its streaks / XP / confetti.
* the stages ARE the typed workflow contracts already in the harness (intake -> PlanPreview -> patch/draft
  -> proposal/coach -> approval via CAS -> downstream handoff). The UI just reads their persisted state.
* this is itself a subtraction: one ribbon carries what is now spread across the status tape, the room
  trace, and the coach panel (drive it from `signalStatus.ts` / `statusText()`).

---

## Reference set (priority order, NodeRoom-native)

Every adoption move RE-EMPHASIZES or REMOVES; none adds a control. No command palette anywhere (a Cmd-K
launcher just relocates complexity behind another mechanism to learn -- the opposite of cleanliness).
Each reference is web-verified with one citation.

### 1. Notion -- calm object/block workspace
* Borrow: blocks/objects with progressive disclosure; AI agents that work INSIDE the work context (in the
  page/cell), not in a separate window.
* Avoid: empty-canvas ambiguity -- a high-stakes diligence room must not feel like a blank doc.
* NodeRoom move: keep the work surface block-calm; the blank room stays at 3 starts + one teaching cue, and
  the agent acts in-place on the cell/note it is asked about (reuse the in-cell edit path), never in a popup.
* Cite: https://www.notion.com/product/ai

### 2. Quadratic -- AI-native spreadsheet, method not black box
* Borrow: every AI number is backed by an inspectable, re-runnable method adjacent to the result; "every
  change is yours to approve." Inspect-the-work is the default, not a buried debug mode.
* Avoid: letting the analyst EDIT the AI's method (provenance hole -- "who changed this" is lost) and the
  live multi-connector data grid (egress/SSRF surface).
* NodeRoom move: make the AI-filled CELL the click-target that foregrounds its existing evidence/derivation
  inline and recedes the rest (reuse the color-as-signal recede + EvidenceCarousel). No new "inspect"
  button; the method stays read-only. Export headlines "re-derivable from N approved evidence items."
* Cite: https://www.quadratichq.com/ai/analysis

### 3. Attio -- entity object model with AI fields in context
* Borrow: each company row is a first-class ENTITY with an auto-captured activity timeline -- "all related
  activity in one place," accruing passively; AI attributes shown in the list/record context.
* Avoid: CRM complexity leaking in -- the multi-tab record page and the CRM action toolbar (Compose email /
  Run workflow / Enroll in sequence) would multiply controls against the subtraction bar.
* NodeRoom move: render the timeline as a FOCUS STATE of the trace you already have -- focusing a company
  row (`stageFocus.ts`) filters the single activity stream to that entity and recedes the rest. No tabs, no
  per-row panel. Bounded "Highlights": the room auto-picks 2-3 stage-relevant attributes via
  `signalStatus.ts` (no "+ Add widget" config).
* Cite: https://attio.com/help/reference/managing-your-data/records/create-and-view-records

### 4. Duolingo -- progression and completion restraint (model only)
* Borrow: a single path with exactly one lit "next" step, everything else receding; lightweight completion
  feedback so a long journey feels finishable.
* Avoid: streaks / XP / leagues / confetti -- gamified reward energy corrodes trust in banking diligence and
  pressures analysts to rush a liability surface.
* NodeRoom move: the progression ribbon above (light only the current stage; done stages a small tick;
  reuse `statusText()` for the single next-best-action, e.g. "Evidence: 2 claims still need a source").
* Cite: https://blog.duolingo.com/new-duolingo-home-screen-design

### 5. Figma -- multiplayer presence + exact-object comments
* Borrow: presence is position + identity + activity, shown only while active; comments are tied to an
  EXACT object, and clicking a participant follows them to where they (or the agent) are working.
* Avoid: too many toolbars for NodeRoom's non-designer user.
* NodeRoom move: make the avatar row a follow-handle -- clicking the agent diamond scrolls the work surface
  to the cell range the NodeAgent currently holds a lock on and pulses it (reuse `stageFocus.ts`). Presence
  becomes navigation; no new chrome.
* Cite: https://www.figma.com/blog/multiplayer-editing-in-figma/

### 6. Cursor / Claude Artifacts -- propose, review, inspect (approve before merge)
* Borrow: the agent PROPOSES, the human REVIEWS a clear grouped diff, and changes are inspectable and
  approved BEFORE they land; the artifact is a durable, addressable object distinct from the chat.
* Avoid: making the agent feel like a separate IDE (Cursor), and the answer-page-as-endpoint instead of a
  persistent artifact (Claude/Perplexity) -- NodeRoom needs durable, auditable artifacts.
* NodeRoom move: when the agent finishes a lock->draft->merge cycle, render the merged delta as a grouped,
  accept/reject diff on the sheet ("4 revenue cells reconciled", "2 variance recalcs") -- reuse the existing
  proposal control; nothing lands without the existing human gate.
* Cite: https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/

### 7. Linear / Vercel (Geist) / Stripe -- restraint, color-as-signal, state clarity
* Borrow: Linear -- recede the chrome (full contrast only on the active thing) and crisp state clarity
  (NOT its command palette). Vercel Geist -- neutrals carry the UI; accent is spent only on real state;
  status as a tinted pill. Stripe -- answer "is it okay?" first; detail one click away.
* Avoid: dashboards of equal-weight metrics; optimizing for keyboard power-users at the cost of the
  first-time diligence user.
* NodeRoom move (shipped): the status tape now spends color only on real state (Review goes amber only when
  proposals > 0; chips are transparent muted text at rest). Idle telemetry hides; actionable risk stays.
* Cite: https://linear.app/now/behind-the-latest-design-refresh | https://vercel.com/geist | https://stripe.com

---

## The banker-coach / evidence surface (more central than any palette)

The review-and-trust loop is the heart of a diligence room and matters more than any launcher. Model it as
fixed, inspectable, human-gated stages -- every one RE-USES a surface that already exists or is specd, and
adds no control:

`coach cue -> evidence card -> side-by-side artifact open -> accept/reject proposal -> downstream export`

* coach cue: a `CoachCue` (audience-scoped) surfaces "what to pull / what changed and risky / can I send".
  It is a reviewable artifact, not buried chat (BankerCoachPanel).
* evidence card: each claim carries an `EvidenceCard` with the exact locator (source file -> page / row /
  cell / bbox) and a `supportLevel`. Perplexity rule, enforced: an unverifiable claim shows a muted
  "unsourced" mark, NEVER a confident number. (Closes the harness `EvidenceCard.supportLevel` gap.)
* side-by-side open: clicking the CELL (not a button) opens the source next to the claim at the exact
  locator (EvidenceCarousel); everything else recedes (reuse the color-as-signal recede).
* accept / reject: the existing proposal + lock->draft->merge CAS (no-clobber). The agent proposes; the
  human commits. Nothing mutates a committed cell silently.
* downstream export: the existing approval-gated handoff card, dry-run and honest-status, with provenance
  ("re-derivable from N approved evidence items") as its headline.

This is the Cursor/Claude propose->review->inspect discipline applied to diligence, and it is where the
quiet-UI-learning payoff lands: the room foregrounds the next useful action (the one cue / one cell / one
proposal that needs a human now) and recedes the rest.

---

## Cleanliness by subtraction -- what shipped (corrected)

The test for every element: "useful right now? if not, remove it, merge it, or reveal it only when
relevant." Subtract and recede; never relocate behind a launcher.

| Surface | Rule (shipped) |
|---|---|
| Status strip | Hide IDLE telemetry (Agents/Eval/Cost show only while a job is live). KEEP actionable risk at rest: `Review: N pending`, `Run: failed/paused`. (Trust state matters after the run too.) |
| Research toolbar | Room-level setup ("Import accounts") stays visible for the bulk workflow; secondary Requeue/CRM-CSV behind one in-context "..." overflow; row-level actions (enrich / rerun / open source / exclude) live in the row detail. |
| Downstream handoff | Renders only when a draft is actually ready. |
| Status chips | Transparent muted text by default; color spent only on real state (Review amber only when proposals exist). |
| Blank room | Exactly 3 starts + one teaching cue; resist re-seeding controls into the empty view. |

Net at rest: the demo room drops from ~28 visible controls toward ~12-14, each doing real work -- and the
remaining ones gain hierarchy from weight + color-as-signal. No command palette; no capability removed.

> Cmd-K / command palette: explicitly NOT a priority. It relocates controls behind a mechanism users must
> first discover -- that is the opposite of cleanliness. Revisit only as a power-user accelerator AFTER the
> surface is already calm.

---

## Status

Shipped to `main` (verified live + tsc green): blank-room fix + 3-CTA onboarding; the subtraction pass
(status strip, research toolbar, color-as-signal recede); the two review corrections above. Branch:
`founder-ui-subtraction`. Companion: [HARNESS_REVIEW.md](../founder-loop/HARNESS_REVIEW.md) (the
event-log + evidence-ledger substrate that powers the quiet-learning behaviors here).
