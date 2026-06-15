# NodeRoom — Visual Design & UX Benchmark

> Inspirational references from best-in-class apps (2025–2026), each grounded against a **real NodeRoom
> surface** (`src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx`) with a concrete adoption move.
> Baseline being compared against: a **fresh blank room ≈ 14 controls**; the **demo room ≈ 28 controls across 6 regions**
> (header 8 · work tabs 5 · research toolbar 4 · downstream-handoff 5 · copilot tabs/box/chips · a 7-col research table with paragraph cells).
> Sources web-verified 2026-06-15.

## The 4 P0 moves (highest leverage against "too crowded / too many buttons")

| # | Exemplar | Pattern | NodeRoom move | Surface |
|---|---|---|---|---|
| 1 | **Linear** (Mar 2026 refresh + Linear Agent) | Cmd-K command palette as the primary verb surface; humans & agents invoke the *same* verbs | Add **Cmd-K**; demote the research toolbar (4) + handoff grid (5) into palette entries → **one launcher replaces ~9 buttons** | top-bar/controls |
| 2 | **Vercel Geist** | Color-as-signal: neutrals carry 95%; accent spent only on real state; status = tinted pill | Repaint Sources/Review/Eval/Cost chips **neutral by default**; Review→amber pill *only* when `proposals.length>0` | status-strip |
| 3 | **Stripe Dashboard** | Progressive disclosure: resting view answers "is it okay?", detail one click away | Collapse the bottom strip to **one resting line** (`● Ready · N artifacts`); expand full tape on demand / on agent run → closes the Gemini P2 | status-strip |
| 4 | **Notion 3.4** + **Cursor 3** | Decrowd-by-grouping (4-tab rail); "show, don't tell" grouped diff | Group the 8 header controls into **3 clusters** (Room / View / Account); render the agent's lock→merge delta as a **grouped accept/reject diff** on the sheet | room-shell + work-surface |

If all four land, visible control count drops well under the ~28 baseline (**handoff 6→1, status tape 4 chips→1 line, top-bar long-tail→Cmd-K**) with a clear hierarchy — no capability removed.

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
The 4 P0 moves are the direct answer to the recording's "too crowded / too many buttons." They're all
**progressive-disclosure / color-as-signal / command-palette** patterns — i.e. *hide what isn't active,
spend color only on real state, route the long tail to Cmd-K*. None remove capability. The P1/P2 moves
(follow-mode, restorable checkpoints, grouped diff, per-cell attribution) make the **no-clobber human+agent
wedge legible on the surface where it happens** — the thing NodeRoom is uniquely about.

Full structured data (all 17 refs, URLs, code-grounded adoption moves): the design workflow result.
