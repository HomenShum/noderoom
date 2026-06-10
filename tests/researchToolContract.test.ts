/**
 * Contract scenarios for the v3 two-call composite research workflow (scripts/benchmark/researchTools.ts).
 * These encode the workflow-engine guarantees the MODEL relies on — deterministic, no keys, no spend.
 * Persona: the runtime engineer swapping models/routes needs proof the choreography layer cannot
 * regress underneath any route (the benchmark only proves the model side).
 */
import { describe, expect, it } from "vitest";
import { benchmarkResearchTools, RESEARCH_WRITE_COLS } from "../scripts/benchmark/researchTools";
import type { RESEARCH_COMPANIES } from "../src/engine/demoRoom";

type Companies = typeof RESEARCH_COMPANIES;
const COMPANIES = [
  { id: "rc_acme", company: "Acme", url: "https://acme.com", source2Url: "https://en.wikipedia.org/wiki/Acme", tier: "A", intent: "test", owner: "t", crmStatus: "Target" },
] as unknown as Companies;

const GOOD_FIELDS = {
  summary: "Acme manufactures industrial anvils and rocket skates for the coyote logistics market.",
  funding: "not disclosed in the cited sources",
  headcount: "not disclosed in the cited sources",
  recent_signal: "homepage highlights a new rocket-skate product line",
};

/** Minimal scripted RoomTools double: records every call; configurable failures. */
function makeRt(opts: { denyLock?: boolean; failFetch?: string[] } = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const versions = new Map<string, number>();
  const values = new Map<string, string>();
  let lockSeq = 0;
  const released: string[] = [];
  const rt = {
    proposeLock: async (ids: string[], reason: string) => {
      calls.push({ op: "proposeLock", args: [ids, reason] });
      if (opts.denyLock) return { ok: false as const, reason: "locked_by_other", lockId: "other_lock" };
      return { ok: true as const, lockId: `lock_${++lockSeq}` };
    },
    readRange: async (ids: string[]) => {
      calls.push({ op: "readRange", args: [ids] });
      return ids.map((id) => ({ id, value: values.get(id) ?? "", version: versions.get(id) ?? 1 }));
    },
    editCell: async (elementId: string, value: string, baseVersion: number) => {
      calls.push({ op: "editCell", args: [elementId, value, baseVersion] });
      const current = versions.get(elementId) ?? 1;
      if (baseVersion !== current) return { ok: false as const, reason: "conflict" as const, expected: baseVersion, actual: current };
      versions.set(elementId, current + 1);
      values.set(elementId, value);
      return { ok: true as const, version: current + 1 };
    },
    fetchSource: async (url: string) => {
      calls.push({ op: "fetchSource", args: [url] });
      if ((opts.failFetch ?? []).includes(url)) return { ok: false as const, error: "http 404" };
      return { ok: true as const, url, title: `Title of ${url}`, snippet: `snippet content for ${url} about anvils` };
    },
    releaseLock: async (lockId: string) => {
      calls.push({ op: "releaseLock", args: [lockId] });
      released.push(lockId);
      return { ok: true as const };
    },
  };
  return { rt: rt as never, calls, versions, values, released };
}

function tools(companies: Companies = COMPANIES) {
  const [fetchTool, writeTool] = benchmarkResearchTools(companies);
  return { fetchTool, writeTool };
}

describe("v3 research tool contract — choreography the model must be able to rely on", () => {
  it("happy path: fetch returns FENCED snippets; write lands all 8 columns with CAS provenance; lock released exactly once", async () => {
    const { rt, calls, values, released } = makeRt();
    const { fetchTool, writeTool } = tools();

    const fetched = await fetchTool.execute({ rowId: "rc_acme" }, rt) as { ok: boolean; snippets: string };
    expect(fetched.ok).toBe(true);
    expect(fetched.snippets).toContain("UNTRUSTED ROOM DATA"); // trust boundary travels with the snippets

    const written = await writeTool.execute({ rowId: "rc_acme", fields: GOOD_FIELDS }, rt) as { ok: boolean; writes: Array<{ ok: boolean }> };
    expect(written.ok).toBe(true);

    for (const col of RESEARCH_WRITE_COLS) expect(values.get(`rc_acme__${col}`), col).toBeTruthy();
    expect(values.get("rc_acme__status")).toBe("complete");
    expect(values.get("rc_acme__source")).toBe("https://acme.com");          // citations are harness-attached,
    expect(values.get("rc_acme__source2")).toContain("wikipedia.org");        // never model-claimed
    expect(released).toHaveLength(1);                                          // exactly one release
    // CAS provenance: every editCell baseVersion equals the version the harness last observed.
    for (const c of calls.filter((c) => c.op === "editCell")) expect(typeof c.args[2]).toBe("number");
  });

  it("write_row before fetch_row_sources is rejected — the model cannot skip evidence", async () => {
    const { rt, calls } = makeRt();
    const { writeTool } = tools();
    const result = await writeTool.execute({ rowId: "rc_acme", fields: GOOD_FIELDS }, rt) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("fetch_row_sources");
    expect(calls.filter((c) => c.op === "editCell")).toHaveLength(0); // no writes happened
  });

  it("a failed source fetch releases the lock and reports failure as data — no partial garbage row", async () => {
    const { rt, calls, released, values } = makeRt({ failFetch: ["https://en.wikipedia.org/wiki/Acme"] });
    const { fetchTool } = tools();
    const result = await fetchTool.execute({ rowId: "rc_acme" }, rt) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("source fetch failed");
    expect(released).toHaveLength(1); // lock not leaked
    // only the status->running write happened; no research fields were fabricated
    const fieldWrites = calls.filter((c) => c.op === "editCell" && String(c.args[0]).includes("__summary"));
    expect(fieldWrites).toHaveLength(0);
    expect(values.get("rc_acme__summary")).toBeUndefined();
  });

  it("a denied lock returns locked-as-data and performs zero fetches/writes", async () => {
    const { rt, calls } = makeRt({ denyLock: true });
    const { fetchTool } = tools();
    const result = await fetchTool.execute({ rowId: "rc_acme" }, rt) as { ok: boolean; locked?: boolean };
    expect(result.ok).toBe(false);
    expect(result.locked).toBe(true);
    expect(calls.filter((c) => c.op === "fetchSource")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "editCell")).toHaveLength(0);
  });

  it("re-fetching an in-flight row is idempotent: same snippets back, no second lock", async () => {
    const { rt, calls } = makeRt();
    const { fetchTool } = tools();
    await fetchTool.execute({ rowId: "rc_acme" }, rt);
    const again = await fetchTool.execute({ rowId: "rc_acme" }, rt) as { ok: boolean; alreadyFetched?: boolean };
    expect(again.ok).toBe(true);
    expect(again.alreadyFetched).toBe(true);
    expect(calls.filter((c) => c.op === "proposeLock")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "fetchSource")).toHaveLength(2); // first call only (2 sources)
  });

  it("a row outside the benchmark slice is rejected — the model cannot invent rows", async () => {
    const { rt } = makeRt();
    const { fetchTool } = tools();
    const result = await fetchTool.execute({ rowId: "rc_imaginary" }, rt) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside this benchmark slice");
  });
});
