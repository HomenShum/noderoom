# NodeRoom — Visual Design & UX Benchmark

> Inspirational references from best-in-class apps (2025–2026), each grounded against a **real NodeRoom
> surface** (`src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx`) with a concrete adoption move.
> Baseline being compared against: a **fresh blank room ≈ 14 controls**; the **demo room ≈ 28 controls across 6 regions**
> (header 8 · work tabs 5 · research toolbar 4 · downstream-handoff 5 · copilot tabs/box/chips · a 7-col research table with paragraph cells).
> Sources web-verified 2026-06-15.

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
