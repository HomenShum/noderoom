/**
 * Golden cases for the agent harness. A case is an input (persona + goal + room
 * seed) paired with the desired output (final cell state + protocol invariants).
 * The runner (runEval.ts) scores the agent against these — deterministically with
 * the scripted model, or against the real LLM with --real.
 *
 * Expand this set from docs/AGENT_EVAL.md (users → use cases → golden references).
 */

export type CaseKind = "single" | "multi" | "long";

/** One turn of a multi-turn case — run sequentially on the SAME room. */
export interface Turn { goal: string; targets: Record<string, string>; lock?: boolean }

export interface GoldenCase {
  id: string;
  persona: string;       // WHO invokes the agent
  useCase: string;       // WHAT they want
  kind: CaseKind;
  goal: string;          // the natural-language task (used by the real model)
  /** Expected variance edits — drives the scripted planner AND the scoring. */
  targets: Record<string, string>;
  /** Protocol variant: claim a lock first (true) or pure CAS (false). */
  lock?: boolean;
  /** Long-running: inject a concurrent human edit on this cell mid-run. */
  injectConflictOn?: string;
  /** Pre-hold a lock on these cells (by "another" agent) so this run must draft. */
  preLock?: string[];
  expect: { cells: Record<string, string>; invariants: Array<"locked" | "released" | "drafted" | "conflict_recovered" | "no_conflict"> };
  scriptable: boolean;   // can the deterministic planner reproduce it (single-goal)?
  /** Multi-turn (M1): run each turn on the same room; asserts each turn re-reads fresh versions. */
  turns?: Turn[];
  /** Long-running property test (L1): run N times, injecting a concurrent edit on a rotating cell; no-clobber must hold every ordering. */
  property?: { iterations: number; injectCells: string[]; lock?: boolean };
}

export const GOLDEN: GoldenCase[] = [
  {
    id: "founder-recompute-locked",
    persona: "Founder running Q3 diligence",
    useCase: "Recompute the variance for the top lines, claiming the range so nobody races them.",
    kind: "single",
    goal: "Set the Q3 variance for Revenue (r_rev__variance)=+24% and COGS (r_cogs__variance)=+27.5%, computed from the audited NetSuite numbers. Lock the cells first, edit with CAS, then release.",
    targets: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" },
    lock: true,
    expect: { cells: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, invariants: ["locked", "released", "no_conflict"] },
    scriptable: true,
  },
  {
    id: "lock-prevents-race",
    persona: "Founder claiming the range before a teammate can race it",
    useCase: "Hold the exact affected range so a concurrent human write is blocked, not merely caught after the fact.",
    kind: "long",
    goal: "Set Revenue (r_rev__variance)=+24% and COGS (r_cogs__variance)=+27.5%. Lock the cells first so nobody can edit them while you work, then release.",
    targets: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" },
    lock: true,
    injectConflictOn: "r_rev__variance", // the human's write hits the lock gate and is BLOCKED → 0 CAS conflicts
    expect: { cells: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, invariants: ["locked", "released", "no_conflict"] },
    scriptable: true,
  },
  {
    id: "analyst-cas-conflict-recovery",
    persona: "Analyst filling the lower lines without a lock",
    useCase: "Edit cells directly while a colleague is also editing — survive the race via CAS.",
    kind: "long",
    goal: "Set Gross profit (r_gp__variance)=+21.7% and Net income (r_ni__variance)=+22.4%, reading each cell's current version before writing and retrying if it changed.",
    targets: { r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" },
    lock: false,
    injectConflictOn: "r_gp__variance",
    expect: { cells: { r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" }, invariants: ["conflict_recovered"] },
    scriptable: true,
  },
  {
    id: "blocked-agent-drafts",
    persona: "Private agent blocked by the room agent's lock",
    useCase: "The range you need is already locked — draft around it instead of waiting or clobbering.",
    kind: "long",
    goal: "Set Revenue (r_rev__variance)=+24% and COGS (r_cogs__variance)=+27.5%. If the range is locked by someone else, draft your changes to merge when it frees.",
    targets: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" },
    lock: true,
    preLock: ["r_rev__variance", "r_cogs__variance"],
    // while the other agent holds the lock the cells stay empty; the runner releases
    // that lock after the draft, and the smart-merge then applies the targets.
    expect: { cells: { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, invariants: ["drafted"] },
    scriptable: true,
  },
  {
    id: "multi-turn-freshness",
    persona: "Founder refining over two turns in one thread",
    useCase: "Turn 1 recompute; turn 2 corrects the SAME cell — must re-read the new version, never reuse turn-1's baseline.",
    kind: "multi",
    goal: "(multi-turn — see turns)",
    targets: {},
    turns: [
      { goal: "Set Revenue variance to +24%.", targets: { r_rev__variance: "+24%" }, lock: true },
      { goal: "Correct Revenue variance to +25%.", targets: { r_rev__variance: "+25%" }, lock: true },
    ],
    // freshness is scored specially: the shared cell's version must strictly increase each turn (v1→v2→v3).
    expect: { cells: { r_rev__variance: "+25%" }, invariants: [] },
    scriptable: true,
  },
  {
    id: "long-running-no-clobber-property",
    persona: "Sustained concurrent room (property test)",
    useCase: "Under MANY interleavings of concurrent human edits, no agent write is ever a silent clobber.",
    kind: "long",
    goal: "Set Gross profit (r_gp__variance)=+21.7% and Net income (r_ni__variance)=+22.4% with CAS, retrying on conflict.",
    targets: { r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" },
    lock: false,
    property: { iterations: 6, injectCells: ["r_gp__variance", "r_ni__variance"], lock: false },
    expect: { cells: { r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" }, invariants: ["conflict_recovered"] },
    scriptable: true,
  },
];
