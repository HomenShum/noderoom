# Desktop/mobile UI shell (Deal Binder + Work Surface + Copilot + Signal Tape + Status Strip)

Status note after the target implementation pass: Step 1 is implemented in the MVP shell directly
inside `RoomShell.tsx` rather than a separate `Copilot.tsx`; Step 2 exists as the shell-level bottom
strip with deterministic privacy/bounds selector tests; Step 3 is implemented at MVP binder depth;
Step 4 has memory-mode browser coverage across the target bands. Center-stage split mode, richer
binder click-through, user filters/pause controls, and live/Convex/Gemini proof remain backlog items.

## Decision

Do **not** re-specify the shell. The region taxonomy, the four-role owns/must-not-own contract, binder click semantics, the bottom contract, and the four responsive bands are already canonical in `docs/TARGET_2026_06.md` (L17–96). This spec is an **implementation ticket list against that doc's own gap section** (`TARGET_2026_06.md` L171–199), not a new design. Sequence the net-new work as: **(1) shell restructure** — make the Work Surface the non-optional center and unify public+private `Chat` into one right `Copilot` (closes L174/L194 and L175/L195, unblocks everything below); **(2) Status Strip** — small, consolidates info that already exists (L176/L196); **(3) binder sections + click semantics** (L177/L198); **(4) responsive tiers 1200–1439 / 900–1199 + browser specs** (L178/L199); **(5) Signal Tape last** — largest, privacy-risk, gate on a bounded public-only feed (L179). Treat the "artifacts wrongly in a bottom drawer" correction as a **no-op**: no such drawer exists in the repo; reallocate to the genuinely-missing **center-stage split mode** (L197).

## Current state (already built — do not re-spec)

- **Region taxonomy + four-role contract + responsive table** — written verbatim in `docs/TARGET_2026_06.md` L17–96; mirrored in `docs/ARCHITECTURE.md` L150–156 and the `RoomShell.tsx` header comment (L2–3). Cite, do not re-derive.
- **Three resizable columns + thin top bar** — `src/ui/RoomShell.tsx` renders `LeftRail` + public `Chat` (center) + `Artifact` + private `Chat` (right) with `ResizeHandle` between each (L216–224); layout state `{ left:224, center:1.15, artifact:1.35, right:320 }` (L39); `startResize` clamps (L154–175). `styles.css` `.r-workspace{display:flex}`.
- **Left rail = "Room Binder"** with Source files + People & agents — `src/ui/LeftRail.tsx`: header L55; source-file rows L59–75 (click `onPick`, draggable `dragArtifactRef` L120–125); upload L76–88; static NetSuite row L91–94; People & agents section L97–114 with live dots (L103) and public-agent status rows (L106–113).
- **Tabbed Work Surface** — `src/ui/panels/Artifact.tsx` `TABS` (Wiki/Spreadsheet/Research/Note/Wall), tab bar `data-testid="artifact-tabs"`; all stage surfaces (sheet, Excel grid, research table, TipTap note, file viewer, sticky wall) live in this one panel.
- **Copilot building blocks (exist, not yet unified)** — `src/ui/Chat.tsx`: long-job strip + telemetry L487–534, cancel/retry L474–484, multi-agent workbench (command queue + per-agent stream lanes + claimed ranges), private/Room lane toggle, promote-to-public, slash-command menu.
- **People as header avatars + live dots** — `RoomShell.tsx` `.r-avatars` L207–210.
- **Mobile collapse** — `RoomShell.tsx` `isCompact` L32, panels init closed L37; `styles.css` `@media(max-width:980px)` fixed overlays + top-bar scroll (L624–640); `pointer:coarse` 44px floors (L647–660); phone condense (L663–675).
- **Reduced-motion contract** — `styles.css` L613 global `@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`.
- **Bottom info today (scattered, to be consolidated)** — `Artifact.tsx` `TraceStrip` (`data-testid="room-trace"`, scrollable, `max-height:168px`); per-run telemetry `run.model · run.toolCalls tools · $run.costUsd` (L1136); job telemetry `Chat.tsx` L487–534.

## Net-new work (sequenced)

### Step 1 — Shell restructure: non-optional center + unified Copilot (effort L; closes L174/L175)

- **Replace the 4-peer flex with a CSS grid** in `src/ui/RoomShell.tsx` + `src/app/styles.css`. New `.r-workspace` becomes `grid-template-columns: [binder] auto [stage] minmax(760px,1fr) [copilot] auto` with two bottom rows (Step 2 + Step 5). Resize handles keep adjusting `binder` and `copilot` track widths; the **stage track has a hard `min-width:760px` and is never togglable**.
- **Demote the artifact toggle.** Remove `show.artifact` from the top-bar toggle group (`RoomShell.tsx` L196–200). Keep `show.left` (binder) and replace `show.priv` with a Copilot collapse. The Work Surface has no "off" state on desktop ≥900px.
- **Merge the two `Chat` instances into one `Copilot` shell.** Create `src/ui/Copilot.tsx` that hosts a single column with a **lane switch (Room / Private)** at top, reusing the existing `Chat` body, work-queue strip, agent streams, agent cards, and steering controls. `RoomShell.tsx` L219 (center public Chat) and L223 (right private Chat) collapse into `<Copilot roomId me channelDefault="public" />`. Public and private remain distinct `Channel` values (`"public"` vs `{ private: me.id }`) under one shell — no data-model change.
- **DoD:** On a ≥1440px viewport the center Work Surface is present with no toggle to hide it and never renders narrower than 760px under any resize; the right column is a single Copilot with a Room/Private lane switch; there is exactly one `Chat`-derived feed mounted per lane; an e2e spec asserts `getByTestId('artifact-tabs')` is visible and `queryByTestId('artifact-toggle')` is null.

### Step 2 — Status Strip (effort M; closes L176/L196)

- **New `src/ui/StatusStrip.tsx`**, mounted as the **lower** of the two bottom grid rows in `RoomShell`. Non-scrolling, single line, authoritative. Renders the last commit/skip/proposal/sync/conflict/eval/cost from existing selectors — no new backend.
- **Source it from a pure selector** `selectStatus(store, roomId): StatusSnapshot` (see types). Derive `committed` and `skipped` from the tail of `store.listTraces(roomId)` (`TraceType` `edit_applied` / `edit_blocked` / `proposal_resolved`), `proposals` from `store.listProposals(roomId).length`, and cost/model/runtime from `store.lastRun()` (`AgentRunTelemetry`) and `store.lastLongFreeJob()`.
- **Example render:** `v42→v43 committed · C2 skipped · 1 proposal · D2 PASS · $0.079`. Eval (`D2 PASS`) is optional and only shown when an eval ref exists; never fabricate a status.
- **DoD:** Strip shows the correct version delta and skipped-cell ref after a no-clobber merge; shows `$cost` matching `lastRun().costUsd.toFixed(3)`; never scrolls; renders `—` (not a fake 2xx-style "OK") when a field is unknown; reduced-motion respected (it inherits the global rule, no entrance animation).

### Step 3 — Binder section hierarchy + click semantics (effort M; closes L177/L198)

- **Expand `src/ui/LeftRail.tsx`** from two sections to the canonical set (`TARGET_2026_06.md` L34–40): **Source Files, Workbooks, Work Products, People, Agents, Review & Proof, Permissions.** Group existing `arts` by kind into Workbooks (`kind==='sheet'`) vs Work Products (note/wall/research). Each row stays a click-to-open-on-stage button (reuse `onPick`).
- **Click semantics (L42–47):** clicking an artifact opens it on stage (built); clicking an **agent** highlights its claimed range and opens Copilot detail — add `onFocusAgent(sessionId)` that sets the stage selection to the session's claimed range and switches Copilot to that agent card; clicking a **person** jumps to their work context.
- **Compact agent entry (L52):** Agents section shows `Agent B · Running · rows 11–22` (status + claimed-range summary only). Full streams/queues stay in Copilot — enforce the binder anti-pattern (L49–53).
- **Permissions section** surfaces only **real** toggles: `room.autoAllow` (exists, wired via `toggleAutoAccept` in `RoomShell`), formula-protection (cite the no-clobber invariant `TARGET_2026_06.md` L108), and private-evidence-blocked (cite the privacy boundary). **Do not render inert/fake controls** — if a policy is aspirational, show it as a read-only labelled state, not a switch. (Open question: confirm which are real toggles.)
- **DoD:** Binder renders all seven sections; clicking an agent row highlights its range on the stage and opens its Copilot card; the Agents section shows status + range but no stream log; Permissions shows `room.autoAllow` as a live switch and any aspirational policy as non-interactive text; no clickable element is a no-op (looks-clickable-must-act).

### Step 4 — Missing responsive tiers + browser specs (effort M; closes L178/L199)

- **Add the two missing bands** in `src/app/styles.css` (current breaks are only 1500/980/768/640):
  - `@media (min-width:1200px) and (max-width:1439px)` — binder collapses to an **icon rail with hover/peek**; stage + Copilot keep full width; stage never drops below its 760px min.
  - `@media (min-width:900px) and (max-width:1199px)` — binder goes **behind a "Room" button** that opens it as an overlay **over** the stage (must not shrink the sheet); Copilot remains usable.
- **Add e2e width specs** in `e2e/*.spec.ts` for the four target bands **1440 / 1280 / 1024 / 768** (the four canonical bands `>=1440 / 1200–1439 / 900–1199 / <900`; current QA widths 1860/1280/768/375 do not cover 1200–1439 or 900–1199).
- **DoD:** At 1280px the binder is an icon rail and peeks on hover without shifting the stage; at 1024px the binder is hidden behind a Room button and opening it overlays (stage width unchanged, asserted by measuring the grid `.r-art` width before/after open); at 768px one primary surface shows at a time; a passing spec exists per band.

### Step 5 — Signal Tape (effort L; closes L179) — build last, gate on privacy + bound

- **New `src/ui/SignalTape.tsx`**, the **upper** bottom grid row. Ambient horizontal ticker: room/agent/source/eval/cost events (+ market/risk if a feed exists). Pause-on-hover, click-an-item-opens-its-artifact-on-stage, per-room visibility config.
- **Feed via a privacy-filtered, bounded selector** `selectSignalFeed(store, roomId): SignalItem[]` — **never raw `store.listTraces`**. Filter to public events only (drop any trace whose channel/scope is private; a private-channel summary must not reach the tape), apply a **MAX cap with eviction** (e.g. keep newest 60), and sort deterministically by `ts`.
- **DoD:** Tape shows only public events (a unit test injects a private-channel trace and asserts it never appears); item count is hard-capped (test pushes 500 events, asserts ≤ MAX rendered); pause-on-hover works; clicking an item opens the referenced artifact on stage; reduced-motion disables the scroll (uses the global rule + an explicit `prefers-reduced-motion` static fallback); if no market feed exists, it degrades to a room-events ticker (no fake market data).

## Interfaces / types

```ts
// src/ui/StatusStrip.tsx — authoritative, non-scrolling. Pure derivation, no new backend.
export interface StatusSnapshot {
  version?: { from: number; to: number };   // v42→v43 from edit_applied trace tail
  committed?: string;                        // "v42→v43 committed"
  skipped?: string | null;                   // "C2 skipped" from edit_blocked (no-clobber)
  proposals: number;                         // store.listProposals(roomId).length
  sync: "synced" | "syncing" | "offline";    // store.mode / live query state
  eval?: { id: string; status: "PASS" | "FAIL" } | null; // only when an eval ref exists
  cost?: number;                             // store.lastRun()?.costUsd  (AgentRunTelemetry)
  model?: string;                            // store.lastRun()?.model
  runtime?: string | null;                   // store.lastLongFreeJob()?.runtime
}
export function selectStatus(store: RoomStore, roomId: string): StatusSnapshot; // pure, memoized on trace/proposal/run identity

// src/ui/SignalTape.tsx — ambient feed. PRIVACY + BOUND gated.
export type SignalKind = "source" | "agent" | "risk" | "eval" | "cost" | "collab" | "market";
export interface SignalItem {
  id: string;
  ts: number;            // sort key (DETERMINISTIC)
  kind: SignalKind;
  label: string;         // public-safe summary only
  artifactRef?: string;  // click → openArtifact(ref)
}
export const SIGNAL_TAPE_MAX = 60; // BOUND: cap + evict oldest
// MUST drop private-channel traces; never read raw listTraces into the tape.
export function selectSignalFeed(store: RoomStore, roomId: string): SignalItem[];

// src/ui/Copilot.tsx — unified right column (replaces center+right Chat pair)
export type CopilotLane = "public" | "private";
export interface CopilotProps {
  roomId: string;
  me: Actor;
  channelDefault: CopilotLane;          // maps to Channel "public" | { private: me.id }
  onOpenArtifact: (id: string) => void;
  onFocusAgent?: (sessionId: string) => void; // from binder agent click
}
```

```ts
// src/app/styles.css — layout/breakpoint contract (canonical bands, TARGET_2026_06.md L91–96)
// .r-workspace: grid [binder auto] [stage minmax(760px,1fr)] [copilot auto] + 2 bottom rows
//   row N-1: SignalTape (ambient)   row N: StatusStrip (authoritative)
// >=1440  full binder | stage | copilot | bottom            (no media query; default)
// 1200-1439  binder → icon rail + hover peek; stage min 760 held
// 900-1199   binder behind "Room" button, overlays stage (no shrink); copilot usable
// <900       single primary surface; existing 980 overlay rules already cover this
```

## Risks & mitigations (agentic-reliability checklist)

- **BOUND** — Signal Tape `selectSignalFeed` MUST cap at `SIGNAL_TAPE_MAX` with oldest-eviction; an unbounded ticker on a long-lived room grows without limit. Status Strip is single-snapshot (no collection) — bounded by construction.
- **HONEST_STATUS** — Status Strip renders `—` for unknown fields; never show a green/"OK"-style state for a failed or absent commit/eval. Sync field reflects real query state, not an optimistic constant.
- **HONEST_SCORES** — Eval field shows only a real eval ref's PASS/FAIL; never hardcode a PASS or a cost floor. Cost is `lastRun().costUsd` verbatim.
- **TIMEOUT** — If a live market/risk feed is added (open question), wrap its fetch in an `AbortController` + budget gate; on timeout the tape degrades to room-events, it does not block render.
- **SSRF** — Any external market/risk URL must be validated against an allow-list before fetch; no user/agent-supplied URL reaches `fetch`.
- **BOUND_READ** — Cap any external feed response body size; truncate to the fields the tape needs.
- **ERROR_BOUNDARY** — `SignalTape` and `StatusStrip` each render inside a try/empty-state; a selector throw must not blank the whole shell. Copilot lane errors stay in-lane.
- **DETERMINISTIC** — Both selectors sort by `ts` (then `id`) so render order is stable across re-queries; no `Map`-insertion-order dependence.
- **Privacy (P0)** — `selectSignalFeed` filters `channel/scope === public` BEFORE building items; a private-channel trace summary must never enter the tape. Unit-tested with an injected private trace.
- **Migration risk** — Confirm we are not mid-migration before restructuring (`TARGET_2026_06.md` L189 warns against claiming the target shell is shipped). Keep the 4-peer MVP behind no regressions: ship Step 1 behind a layout flag if the live demo room depends on the current peer layout.

## Definition of done (scenario-based)

1. **Finance analyst, 1440px, no-clobber run:** Opens the Q3 sheet (always-on center, no toggle). Runs collaboration; agent locks a range while the analyst edits an adjacent cell. Status Strip shows `v42→v43 committed · C2 skipped · 1 proposal · $0.079` with the correct skipped ref; the stage never narrowed below 760px; the trace opened as a stage/Copilot artifact, not a permanent bottom drawer.
2. **Returning visitor, 1280px reload:** Lands with binder as an icon rail; hovering peeks it without shifting the stage; Copilot shows one column with a Room/Private lane switch; no separate center-vs-right chat panels.
3. **Tablet, 1024px:** Binder is behind a "Room" button; opening it overlays the stage and the measured stage width is unchanged; the sheet stays usable.
4. **Privacy adversarial:** A private-channel trace is injected into the store; it appears in the owner's Private Copilot lane but **never** in the Signal Tape (unit test asserts absence).
5. **Bound/load:** 500 synthetic events pushed; Signal Tape renders ≤ `SIGNAL_TAPE_MAX` items, oldest evicted, sorted by `ts`; no memory growth across a sustained 10-minute agent loop.
6. **Binder navigation:** Clicking an agent row highlights its claimed range on the stage and opens its Copilot card; the binder shows status + range but contains no stream log/queue (anti-pattern enforced).
7. **Reduced motion:** With `prefers-reduced-motion`, the Signal Tape does not scroll/animate and the Status Strip has no entrance transition; all info still legible.
8. **Honest status:** With no agent run yet, the Status Strip shows `—` for cost/eval rather than `$0.000`/`PASS`; sync reflects real connection state.
