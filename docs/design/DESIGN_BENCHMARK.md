# NodeRoom — Visual Design & UX Benchmark

> Inspirational references from best-in-class apps (2025–2026), each grounded against a **real NodeRoom
> surface** (`src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx`) with a concrete adoption move.
> Baseline being compared against: a **fresh blank room ≈ 14 controls**; the **demo room ≈ 28 controls across 6 regions**
> (header 8 · work tabs 5 · research toolbar 4 · downstream-handoff 5 · copilot tabs/box/chips · a 7-col research table with paragraph cells).
> Sources web-verified 2026-06-15.

## Organizing principle — stable room, learned emphasis (quiet UI learning)

> Keep the room stable; let the intelligence change the **emphasis**, not the workflow. The diligence spine
> is fixed and boring on purpose: **Intake → Evidence gathered → Draft artifact → Coach review → Human
> approval → Export.** Learning improves judgment, defaults, ranking, and timing *inside* that spine — it
> never adds a stage, a control, or a command palette.

What the UI should **learn to do** (every one of these makes it *quieter*, never busier):
- foreground the artifact that matters right now; recede the rest
- surface the evidence relevant to the current claim; hide the irrelevant
- flag which company is blocked, which proposal needs review, which handoff is ready
- learn which warnings are noise and stop showing them
- make the single most-likely-useful next action obvious

What it must **never** do: add visible controls, add a launcher, or restyle the workflow to look "smarter."
The visible result of learning is **fewer things, better timed** — the design face of the same event-log +
evidence-ledger substrate the harness review calls out (persisted `CoachCue`/`EvidenceCard`/analytics
events; see [HARNESS_REVIEW.md](../founder-loop/HARNESS_REVIEW.md)). **Learning and subtraction are the same
project: the system learns *what to leave out*.**

**The blend for NodeRoom:** Notion calm structure · Quadratic analytical transparency · Attio entity
intelligence · Figma multiplayer presence · Cursor review/merge discipline · Duolingo progression restraint ·
Perplexity inline citations · Granola ambient capture.

### The progression spine (Duolingo *restraint*, not Duolingo gamification)
Render the diligence spine as a quiet, completeable progression — one legible "where is this
company/artifact?" indicator that **replaces** scattered per-signal status, not adds to it:

`Intake → Evidence → Draft → Coach review → Approval → Export`

- Each stage feels finishable (a calm check when its contract is satisfied), so complex diligence feels
  bounded — Duolingo's *restraint*, none of its streaks / rewards / game energy.
- The stages ARE the typed workflow contracts already in the harness (intake → PlanPreview → patch/draft →
  proposal/coach → approval via CAS → downstream handoff). The UI just reads their persisted state.
- This is itself a **subtraction**: one progression line carries what's currently spread across the status
  tape, the room trace, and the coach panel.

---

## NodeRoom-native reference set (the better lens)

These are the references that *embody* the principle above — AI-native, diligence-shaped — and every adoption
move **re-emphasizes or removes**, reusing shipped surfaces (`EvidenceCarouselArtifact`, `BankerCoachPanel`,
`stageFocus.ts`, `signalStatus.ts`, `LinkupSourceOverlay`, `downstreamHandoff.ts`). Web-verified June 2026.

### ★ Perplexity — verified inline citations *(P0 — the highest-stakes one)*
- **Borrow:** every claim carries an inline marker you hover to inspect the exact source — claim + locator co-located, "say nothing you didn't retrieve."
- **Avoid:** the authoritative *look* without verified *support*. The Mar-2025 Tow Center study found **50–90% of AI-search statements unsupported by their own cited sources** (Perplexity was sued over fabricated attributions). A citation chip linking to a source that doesn't back the claim is **worse than none** — it manufactures false confidence in a reasoning chain.
- **NodeRoom move:** collapse the flat `LinkupSourceOverlay` list **into** the artifact as an inline locator chip per drafted cell, and **gate the chip on verified support** (reuse the chart-data-vs-cells validator): unverifiable claims show a muted "unsourced" mark, never a confident number. Removes a standalone panel *and* makes every claim self-auditing. (Closes with the harness `EvidenceCard.supportLevel` gap.)

### ★ Quadratic AI — method, not black box *(P0)*
- **Borrow:** the AI emits an *inspectable, re-runnable method* adjacent to the result; "every change is yours to approve." Inspect-the-work is the default, not a buried debug mode.
- **Avoid:** letting the analyst **edit the method** (provenance hole — "who changed this" is lost) and the live multi-connector data grid (SSRF/egress surface).
- **NodeRoom move:** make the AI-filled **cell itself** the click-target that foregrounds its existing evidence/derivation inline and recedes the rest (reuse the color-as-signal recede + `EvidenceCarousel`). No new "inspect" button; method stays read-only — auditability without the edit-the-code risk. *(P1 sibling: the export handoff headlines "re-derivable from N approved evidence items" instead of a free-text summary.)*

### ★ Attio — entity timeline as a focus state *(P0)*
- **Borrow:** each company row is a first-class **entity** with an auto-captured **activity timeline** — "all related activity in one place," accruing passively.
- **Avoid:** the 8-tab record page + CRM action toolbar (Compose email / Run workflow / Enroll in sequence). That's CRM complexity leaking in — the opposite of the subtraction pass.
- **NodeRoom move:** render the timeline as a **focus state of the trace you already have** — focusing a company row (`stageFocus.ts`) filters the single activity stream to that entity and recedes the rest. No tabs, no per-row panel; the row stays a row. *(P1 sibling: Attio "Highlights" → the room auto-picks 2–3 stage-relevant attributes via `signalStatus.ts`, no "+ Add widget" config.)*

### Duolingo — progression *restraint* (used only as a model) *(P1)*
- **Borrow:** the single linear path with exactly **one lit "next" node**, everything else receding (the 2025 redesign killed crowns/skill-levels for a milestone feed) — a long journey feels finishable.
- **Avoid:** streaks / XP / leagues / confetti. In banking diligence, gamified reward energy **corrodes trust** and pressures analysts to rush a liability surface.
- **NodeRoom move:** render the fixed spine as a passive **1-line progress ribbon** (driven by ledger state in `signalStatus.ts`): light only the current stage, done stages a small tick, future stages faint; reuse `statusText()` to show the single next-best-action ("Evidence: 2 claims still need a source locator"). Subtracts the "what do I do now" ambiguity with zero new buttons.

### Granola — the conversation *is* the draft *(P1)*
- **Borrow:** sparse human capture that AI quietly structures *after the fact*, with provenance preserved (raw human notes visually distinct; hover-to-reveal source context; no bot, ambient).
- **Avoid:** meeting-note disposability, and **never letting AI silently rewrite committed cells** — the no-clobber lock→draft→merge invariant must hold (Granola can overwrite a private note; a shared diligence artifact cannot).
- **NodeRoom move:** treat the public chat as the "raw notes" layer that becomes the draft — keep human-authored vs AI-structured text visually distinct inside the cell (reuse the recede pass), and hover-to-reveal the originating chat line on a drafted cell (`stageFocus`). Folds "where did this come from" into the artifact; no separate synthesis panel.

> **Two to do first (both P0, both subtractions):** Perplexity's *verified-or-muted* citation gating (false
> confidence is the worst diligence failure) and the Quadratic/Attio *click-to-inspect / focus-to-filter* move
> (the cell and the row become their own inspect affordance). Both remove a standalone panel, reuse shipped
> plumbing, and depend on the harness's persisted `EvidenceCard` locator — closing the loop with the learning
> substrate from [HARNESS_REVIEW.md](../founder-loop/HARNESS_REVIEW.md).

---

## Priority: cleanliness & usefulness by SUBTRACTION (not relocation)

> **Founder steer (2026-06-15):** a command palette (Cmd-K) is **NOT** the priority — relocating controls
> behind a launcher just hides complexity behind another mechanism users must learn. The goal is **fewer
> things on screen, each genuinely useful *right now***. Subtract and recede. Cmd-K is demoted to a P2
> power-user accelerator, *after* the surface is already clean.

The test for every element: **"is this useful right now? if not — remove it, merge it, or reveal it only when relevant."**

| P0 | Exemplar | Subtractive move | Removed from the resting view |
|---|---|---|---|
| 1 | **Vercel Geist / Linear** — recede the chrome | Visual-weight tiering: only the active work + a *real* pending action carry full contrast; tabs/toggles/tape go muted. Spend color ONLY on genuine state (Review→amber *only* when `proposals>0`). | nothing literally, but kills the "everything shouts equally" flatness that reads as crowded |
| 2 | **Stripe** — answer "is it okay?" first | Collapse the 4-chip status strip → **one resting line** (`● Ready · N artifacts`); reveal Sources/Review/Eval/Cost only when an agent runs | **−3 chips** |
| 3 | **Things 3 / contextual** — show on relevance | Render the 5-button downstream-handoff row **only when a draft is actually ready**; otherwise it's absent (one "Draft update" when present) | **−5 buttons at rest** |
| 4 | **Airtable** — primary action only | Research toolbar keeps just **"Enrich N pending"**; Import / Requeue / CRM-CSV move to a per-row "⋯" / contextual reveal | **−3 buttons** |
| 5 | **Notion / settings hygiene** | Demote theme + guided-tour out of the always-on top bar (→ first-run / a single settings affordance); keep invite, auto-allow, leave | **−2 top-bar icons** |

Net at rest: the demo room's ~28 visible controls drop toward **~12–14**, and every remaining one is doing
real work — **without adding a palette to discover**. Cleanliness comes from *deleting and deferring*, then
hierarchy (weight + color-as-signal) does the rest.

**Cmd-K / command palette = P2, later.** It's a speed accelerator for power users once the surface is calm —
not a substitute for removing things. The Linear/Raycast/Superhuman references below are catalogued for that
later stage, not as the headline fix.

## Per-surface reference map

### Work surface / sheet
- **Cursor 3 — grouped-diff review** (P0): an agent run produces *one reviewable artifact* (clustered, collapsible diff, accept/reject per group), not chat prose. → After a lock→draft→merge cycle, render the merged delta as a grouped overlay ("4 revenue cells reconciled", "2 variance recalcs"). *This is the Loop 8 trust payoff.* [ref](https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/)
- **ChatGPT Canvas — selection-scoped editing** (P0): select a region → floating contextual action edits *only* that selection. → Cell/range select surfaces a floating `/ask about B4:B9` chip that pre-scopes the prompt; collapses the research toolbar. [ref](https://venturebeat.com/ai/openai-launches-chatgpt-canvas-challenging-claude-artifacts)
- **Google Sheets — per-cell colored attribution** (P2): each actor's current cell outlined in their color; hover = "last edited by". → Render the agent's locked range as an orange `◆` rectangle + "last edited by NodeAgent · 2s ago" → the no-clobber wedge becomes self-evident *at the cell*.
- **Airtable — data-grid craft** (P1): sticky headers, single-line truncation w/ expand, structured values as chips. → Sticky header row; truncate verbose `CellPayload` text; render source-backed/status/kind as chips.
- **Things 3 — expand-in-place** (P2): resting list = one calm line; tap expands to reveal secondary controls. → Rows show title + one status chip at rest; expand on select to reveal edit/source/handoff.

### Copilot chat
- **Claude Artifacts — chat-steers / artifact-renders split** (P2): durable, versioned output object updating live, distinct from chat. → Private NodeAgent draft renders as a live-updating artifact-card with one "promote to room" button.
- **Raycast — overflow-to-action-panel** (P0): primary action + one `⌘K` opens a grouped, searchable list (named sections, per-row shortcut). → Replace the 6-button handoff grid with one **"Hand off ⌘K"** grouped panel (Messaging/Docs/Tasks/CRM).

### Top bar / room shell
- **Notion 3.4 — decrowd-by-grouping** (P0): split an overloaded rail into ≤4 named, toggleable tabs.
- **Linear — Cmd-K + recede-the-chrome** (P0): one command surface; 3-tier visual weight (active work full contrast, chrome muted). [ref](https://linear.app/now/behind-the-latest-design-refresh)
- **Superhuman — command-bar-as-primary + passive shortcut learning** (P1): sparse canvas, Cmd-K lists every action with its key. → Evacuate top-bar icon long-tail (binder/work-surface/copilot toggles, tour, leave, auto-allow) into Cmd-K.

### Blank state (the highest-ROI first impression — Loops 1/2 already shipped the foundation)
- **Vercel v0** (P1): blank state = one prompt + 3-4 clickable starters that each produce a real artifact, streaming into the work pane. → Empty Work Surface = one input + 3 starters ("Reconcile a Q3 variance sheet", "Research 5 companies into a table", "Draft a post-it retro") that spawn the artifact **and** kick a streaming run.
- **Notion / Superhuman** (P1): ≤3-5 curated next actions + one teaching cue ("/ for commands"); calm "inbox-zero" rest state. → Keep the blank room to exactly 3 CTAs + one cue; gate extras behind "More ways to start". *Resist re-seeding controls into the empty view.*

### Multiplayer presence
- **Figma — presence = position + identity + activity; click avatar to follow** (P1): → Make each avatar (incl. the orange agent `◆`) a follow-handle: clicking jumps the viewport to the cell range the NodeAgent currently locks and pulses it (`focusStage` plumbing already exists).

### Trace / activity
- **Replit Agent — named, restorable checkpoints** (P1): each agent action is a labeled, reversible checkpoint referenced from every surface. → Promote the Signal Tape from append-only lines to **restorable checkpoints** ("reconciled Q3 revenue · 4 cells" → click-to-revert). *Loop 8 trust: auditable AND reversible.*

## How to use this
The P0 moves are the direct answer to "too crowded / too many buttons," and the order is deliberate:
**subtract first** (delete/defer/show-on-relevance), then **recede** (weight + color-as-signal so the eye
lands on the one thing that matters). No command palette, no capability removed — the controls that survive
are the ones useful *right now*; everything else appears only when it becomes relevant. The P1/P2 moves
(follow-mode, restorable checkpoints, grouped diff, per-cell attribution) then make the **no-clobber
human+agent wedge legible on the surface where it happens** — the thing NodeRoom is uniquely about. Cmd-K
sits at the very end, as a power-user accelerator over an already-clean surface.

Full structured data (all 17 refs, URLs, code-grounded adoption moves): the design workflow result.
