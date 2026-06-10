/**
 * Walkthrough specs — each feature is an ORDERED list of `capture-this-state` / `do-this-action`
 * steps. The capturer (capture.ts) executes them against the LIVE app, captures clean per-state
 * frames + cursor targets, and emits remotion/walkthrough.data.js for the Remotion composition.
 *
 * Grammar (the anti-hero-shot rule): every action step yields TWO beats — the state the cursor
 * glides over (pre-frame + cursor target + ripple) and the outcome (post-frame). Loading states
 * are first-class steps, never skipped. A viewer must always see:
 *   empty state → where the cursor clicked → the loading state → the result.
 */

export type Step =
  | { kind: "state"; caption: string; settleMs?: number; holdMs?: number }
  | { kind: "click"; sel: string; caption: string; afterCaption?: string; after?: After; holdMs?: number }
  | { kind: "type"; sel: string; text: string; caption: string; pressEnter?: boolean; afterCaption?: string; after?: After }
  | { kind: "key"; key: string; caption: string; after?: After }
  | { kind: "loading"; sel: string; caption: string; timeoutMs?: number }
  | { kind: "waitResult"; predicate: "cellsFilled" | "chipsVisible" | "textVisible" | "textGone"; arg?: string; sel?: string; caption: string; timeoutMs?: number };

export type After =
  | { sel: string; state?: "visible" | "hidden"; timeoutMs?: number }
  | { textSel: string; includes: string; timeoutMs?: number };

export type FeatureSpec = {
  id: string;
  title: string;
  /** createRoom = fresh live room (sheet+note+wall seeded). seedResearchRoom additionally creates
   *  a Company research artifact with 3 seeded accounts via the room's own session token.
   *  memoryDemo = the deterministic in-browser demo engine at the SAME prod URL (?mode=memory) —
   *  same UI, scripted agent; used where a live-LLM step is too nondeterministic to walk through. */
  setup: "createRoom" | "seedResearchRoom" | "memoryDemo";
  /** Real-LLM features get retries (fresh room per attempt); deterministic ones don't need them. */
  retries?: number;
  /** Opt-in specs are SKIPPED by default runs — they need a special server (e.g. the naive
   *  failure-replay build) and only run when named explicitly: `capture.ts naive-overwrite`. */
  optIn?: boolean;
  /** seedResearchRoom only: override the seeded accounts (episodes for high-trust audiences use
   *  FICTIONAL companies — that restraint is itself the trust signal). */
  seedCompanies?: Array<{ company: string; website?: string; tier?: string; owner?: string }>;
  /** Close panels the story doesn't use — fewer panels = the feature renders larger (the judge's
   *  systemic "text too small at phone size" finding). Order: [left rail, artifact, private]. */
  closePanels?: Array<"left" | "artifact" | "priv">;
  steps: Step[];
};

const CENTER = ".r-panel.center";
const COMPOSER = `${CENTER} [data-testid="chat-composer"]`;

export const FEATURES: FeatureSpec[] = [
  {
    id: "chat",
    closePanels: ["artifact", "priv"],
    title: "Join a live room & chat",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "A brand-new room — shared spreadsheet, notes, post-it wall, and agents", holdMs: 2000 },
      { kind: "click", sel: COMPOSER, caption: "Click the room chat — Slack rules apply" },
      {
        kind: "type", sel: COMPOSER, text: "Kicking off the Q3 review — variance column first.",
        caption: "Type your message…", pressEnter: true, afterCaption: "Enter sends — it paints instantly, before the network",
        after: { textSel: `${CENTER} [data-testid="chat-feed"]`, includes: "variance column first" },
      },
      { kind: "state", caption: "Everyone in the room sees it in real time", holdMs: 2200 },
    ],
  },
  {
    id: "sheet-undo",
    closePanels: ["left", "priv"],
    title: "Edit the sheet — and take it back",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "The Q3 variance column starts empty", holdMs: 1800 },
      { kind: "click", sel: '[data-cell-key="r_opex__variance"] .r-cell-edit', caption: "Click a cell — Sheets muscle memory" },
      {
        kind: "type", sel: '[data-cell-key="r_opex__variance"] input.r-cell-input', text: "+20.5%",
        caption: "Type the variance…", pressEnter: true, afterCaption: "Enter commits — versioned and synced to the whole room",
        after: { textSel: '[data-cell-key="r_opex__variance"]', includes: "20.5" },
      },
      {
        kind: "click", sel: 'button[title*="Undo last applied"]', caption: "Changed your mind? Undo (or Ctrl+Z)",
        afterCaption: "Reverted through the same versioned edit path — no clobbering",
        after: { textSel: '[data-cell-key="r_opex__variance"]', includes: "add", timeoutMs: 12_000 },
      },
      { kind: "state", caption: "Every edit is CAS-versioned — undo is safe in a multiplayer room", holdMs: 2200 },
    ],
  },
  {
    id: "ask-agent",
    closePanels: ["left", "priv"],
    title: "Ask the Room agent to do the work",
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "Five variance cells to reconcile — ask the agent instead", holdMs: 1800 },
      { kind: "click", sel: COMPOSER, caption: "Agents live in the chat — no separate console" },
      {
        kind: "type", sel: COMPOSER, text: "/ask reconcile Q3 revenue and fill the variance cells",
        caption: "Plain language — /ask hands the sheet to the Room NodeAgent", pressEnter: true,
      },
      { kind: "loading", sel: `${CENTER} .r-typing`, caption: "The agent reads the sheet, locks cells, and works — live status, no dead spinner", timeoutMs: 30_000 },
      { kind: "waitResult", predicate: "cellsFilled", arg: "2", caption: "Cells filled with lock→CAS-safe edits + a summary in chat", timeoutMs: 150_000 },
      { kind: "state", caption: "Every agent step is traced — auditable, never silent", holdMs: 2400 },
    ],
  },
  {
    id: "research-upsert",
    closePanels: ["left", "priv"],
    title: "GTM research import — updates, never duplicates",
    setup: "seedResearchRoom",
    steps: [
      { kind: "state", caption: "A GTM research sheet — statuses run like a CRM pipeline", holdMs: 2000 },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "Import accounts — paste like a CRM" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Anthropic, https://anthropic.com, A, eval tooling, Maya",
        caption: "Paste company, website, tier, intent, owner…",
      },
      {
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "One click to import",
        afterCaption: "New row lands — pending, ready to enrich",
        after: { textSel: ".r-research", includes: "Anthropic", timeoutMs: 15_000 },
      },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "Re-import the same account…" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Anthropic, https://anthropic.com, A, eval tooling, Dev",
        caption: "Same company, new owner",
      },
      {
        // No text assertion here: the owner column lives in the click-to-expand detail row, not the
        // dense grid. The on-screen proof is the bar still reading "4 accounts" + the trace line.
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "Import again",
        afterCaption: "The existing row UPDATES — no duplicate, sourced research preserved",
      },
      { kind: "state", caption: "Still 4 accounts — re-import = update, never a duplicate (CRM convention)", settleMs: 1400, holdMs: 2400 },
    ],
  },
  {
    id: "ic-room",
    closePanels: ["left", "priv"],
    title: "A private investment team's research room",
    // Episode capture (private-investment-room-v1, family-office audience). Fictional companies
    // only — per episodes/_audiences/family-office.yaml trust_signals_required. Not a README
    // feature demo, so optIn.
    setup: "seedResearchRoom",
    optIn: true,
    seedCompanies: [
      { company: "Meridian Robotics", website: "https://example.com/meridian", tier: "A", owner: "Principal" },
      { company: "Caldera Therapeutics", website: "https://example.com/caldera", tier: "A", owner: "CIO" },
      { company: "Northwind Logistics", website: "https://example.com/northwind", tier: "B", owner: "Analyst" },
    ],
    steps: [
      { kind: "state", caption: "Monday's IC meeting — targets, owners, and status in one room", holdMs: 2200 },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "A new opportunity arrives from an advisor" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Atlas Maritime Partners, https://example.com/atlas, A, growth equity, Principal",
        caption: "Added like a CRM — company, tier, mandate, owner",
      },
      {
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "One click to file it",
        afterCaption: "Versioned and attributed — the room records who added what, when",
        after: { textSel: ".r-research", includes: "Atlas Maritime", timeoutMs: 15_000 },
      },
      { kind: "state", caption: "Every change in this room carries provenance — that's the point", settleMs: 1200, holdMs: 2400 },
    ],
  },
  {
    id: "naive-overwrite",
    closePanels: ["left", "priv"],
    title: "Failure replay — the naive agent clobbers a human",
    // FAILURE-REPLAY (episode scene `naive-problem`). Runs ONLY against the deliberately-naive
    // build (branch demo/v0-naive-agent: agents skip locks, CAS, and traces — never merged,
    // never deployed). Start it in the worktree:  npm run dev -- --port 5274  then capture with
    //   WALKTHROUGH_BASE=http://localhost:5274 npx tsx scripts/walkthroughs/capture.ts naive-overwrite
    // Honesty: the clip labels the build on screen; memory-mode scripted agent = deterministic.
    setup: "memoryDemo",
    optIn: true,
    steps: [
      { kind: "state", caption: "The NAIVE build (demo/v0-naive-agent) — same room, agent guards removed", holdMs: 2000 },
      { kind: "click", sel: '[data-cell-key="r_gp__variance"] .r-cell-edit', caption: "Maya checked Gross profit by hand…" },
      {
        kind: "type", sel: '[data-cell-key="r_gp__variance"] input.r-cell-input', text: "+30.0% — Maya's manual calc",
        caption: "…and commits her own figure", pressEnter: true,
        afterCaption: "Her number is in the sheet — versioned, hers",
        after: { textSel: '[data-cell-key="r_gp__variance"]', includes: "30.0" },
      },
      { kind: "type", sel: `${CENTER} [data-testid="chat-composer"]`, text: "/ask reconcile Q3 revenue", caption: "Someone asks the agent to reconcile — it read the sheet BEFORE Maya's edit", pressEnter: true },
      {
        kind: "waitResult", predicate: "textGone", sel: '[data-cell-key="r_gp__variance"]', arg: "30.0",
        caption: "Maya's figure is GONE — no lock shown, no proposal, no trace. Silent overwrite.", timeoutMs: 30_000,
      },
      { kind: "state", caption: "This is why the room needed locks, versions, drafts, and review", holdMs: 2400 },
    ],
  },
  {
    id: "review-approve",
    closePanels: ["left", "priv"],
    title: "Review mode — approve agent edits at the cell",
    // LIVE again: the 0/3 review-mode behavior was root-caused (the model was never told review
    // mode exists, so pendingApproval results read as failures → budget-burn or wander-and-quit)
    // and fixed via the room-policy briefing in the agent context. Diag: 2/2 runs file all
    // variance proposals. Retries stay as the flake net for raw LLM slowness.
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "Don't trust the agent yet? Flip off auto-allow", holdMs: 1800 },
      { kind: "click", sel: ".r-pill-auto .r-switch", caption: "Review mode ON — agents must propose, not write" },
      {
        kind: "type", sel: COMPOSER, text: "/ask reconcile Q3 revenue and fill the variance cells",
        caption: "Same ask — but now every edit needs your sign-off", pressEnter: true,
      },
      { kind: "loading", sel: `${CENTER} .r-typing`, caption: "The agent works — but writes become proposals", timeoutMs: 30_000 },
      { kind: "waitResult", predicate: "chipsVisible", caption: "Proposals appear ON the cells — like suggestions in Docs", timeoutMs: 150_000 },
      {
        // No after-wait: the agent files proposals for EVERY variance cell, so "first approve button
        // hidden" never resolves (the others remain). The optimistic update paints the approved cell
        // in the same frame; the default settle captures it.
        kind: "click", sel: '[data-testid="proposal-inline-approve"]', caption: "Approve right where the change lands",
        afterCaption: "Applied via the same no-clobber CAS path — synced to everyone",
      },
      { kind: "state", caption: "Human-in-the-loop, one click, in context", settleMs: 1200, holdMs: 2400 },
    ],
  },
];
