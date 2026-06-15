/**
 * WF5/6 cross-file join/reconciliation grader — a value reconciled into artifact B must tie out to
 * its source row in artifact A, joined on a shared key. Scenario-based: a banker reconciling a
 * "Funding Data" sheet against a "Company List", including the adversarial saboteur (invented value)
 * and the join-on-a-missing-key path.
 */
import { describe, expect, it } from "vitest";
import { gradeCrossFileJoin, type JoinRow } from "../evals/crossFileJoinGrader";

// Artifact A — the Company List (source of truth)
const COMPANY_LIST: JoinRow[] = [
  { key: "MERC", fields: { company: "Mercury", sector: "fintech" } },
  { key: "RAMP", fields: { company: "Ramp", sector: "fintech" } },
  { key: "BREX", fields: { company: "Brex", sector: "fintech" } },
];

describe("gradeCrossFileJoin", () => {
  it("passes when every reconciled value in B ties out to its source row in A", () => {
    const funding: JoinRow[] = [
      { key: "MERC", fields: { company: "Mercury", round: "Series C" } },
      { key: "RAMP", fields: { company: "Ramp", round: "Series D" } },
    ];
    const r = gradeCrossFileJoin(COMPANY_LIST, funding, ["company", "sector"]);
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(2);
    expect(r.mismatches).toHaveLength(0);
    expect(r.missingKeys).toHaveLength(0);
  });

  it("catches a SABOTEUR: a reconciled value that does not tie out to A", () => {
    const funding: JoinRow[] = [
      { key: "MERC", fields: { company: "Mercury Financial" } }, // A says "Mercury"
    ];
    const r = gradeCrossFileJoin(COMPANY_LIST, funding, ["company"]);
    expect(r.ok).toBe(false);
    expect(r.mismatches[0].reason).toMatch(/does not tie out/);
  });

  it("catches a join on a key that does not exist in A", () => {
    const funding: JoinRow[] = [
      { key: "GHOST", fields: { company: "Ghostco" } },
    ];
    const r = gradeCrossFileJoin(COMPANY_LIST, funding, ["company"]);
    expect(r.ok).toBe(false);
    expect(r.missingKeys).toContain("GHOST");
  });

  it("does not penalize fields B chose not to reconcile (only graded fields present in B)", () => {
    const funding: JoinRow[] = [
      { key: "BREX", fields: { round: "acquired" } }, // didn't copy company/sector — not graded
    ];
    const r = gradeCrossFileJoin(COMPANY_LIST, funding, ["company", "sector"]);
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(1);
  });
});
