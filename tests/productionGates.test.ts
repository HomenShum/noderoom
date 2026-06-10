// @vitest-environment edge-runtime
/**
 * Production gates — REAL Convex mutations/queries against an in-memory deployment (convex-test).
 * Proves the two cross-cutting controls the per-run ceilings + lock janitor don't cover:
 *  (1) cumulative daily USD cap per room, and (2) bounded telemetry retention.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // "use node" action

const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

test("cumulative daily USD cap: roomSpendSince sums only today's runs for the room", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { roomId, otherRoomId } = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { code: "SPEND1", title: "Spend", hostId: "h", autoAllow: true, status: "live" as const, createdAt: now });
    const otherRoomId = await ctx.db.insert("rooms", { code: "OTHER1", title: "Other", hostId: "h", autoAllow: true, status: "live" as const, createdAt: now });
    const run = (rid: typeof roomId, costUsd: number, createdAt: number) => ctx.db.insert("agentRuns", { roomId: rid, agentId: AGENT.id, model: "m", goal: "g", steps: 1, toolCalls: 1, conflictsSurvived: 0, inputTokens: 1, outputTokens: 1, costUsd, ms: 1, exhausted: false, createdAt });
    await run(roomId, 4.0, now - 60_000);                 // today, this room
    await run(roomId, 3.5, now - 120_000);                // today, this room
    await run(roomId, 9.9, now - 49 * 60 * 60 * 1000);    // 2 days ago — excluded
    await run(otherRoomId, 8.0, now - 60_000);            // today, OTHER room — excluded
    return { roomId, otherRoomId };
  });

  const since = now - 24 * 60 * 60 * 1000;
  const spent = await t.query(internal.agentRuns.roomSpendSince, { roomId, since });
  expect(spent).toBeCloseTo(7.5, 5);  // only this room's two same-day runs (4.0 + 3.5)
  const other = await t.query(internal.agentRuns.roomSpendSince, { roomId: otherRoomId, since });
  expect(other).toBeCloseTo(8.0, 5);  // rooms don't bleed into each other's cap
  // The gate compares this against ROOM_MAX_USD_PER_DAY (default 10) before starting a run.
});

test("global monthly cap: globalSpendSince sums across rooms with distinct-room attribution", async () => {
  // The $100-experiment gate. Scenario: 3 real rooms spend within the month; the breach report must
  // (a) sum across ALL rooms (unlike roomSpendSince), (b) count distinct rooms so a breach is
  // diagnosable as growth (many rooms) vs runaway (one room), (c) report truncated:false at sane scale.
  // convex-test rejects injected _creationTime, so all rows land "now" — inside any month window.
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mkRoom = (code: string) => ctx.db.insert("rooms", { code, title: code, hostId: "h", autoAllow: true, status: "live" as const, createdAt: now });
    const r1 = await mkRoom("GLOB01"), r2 = await mkRoom("GLOB02"), r3 = await mkRoom("GLOB03");
    const run = (rid: typeof r1, costUsd: number) => ctx.db.insert("agentRuns", { roomId: rid, agentId: AGENT.id, model: "m", goal: "g", steps: 1, toolCalls: 1, conflictsSurvived: 0, inputTokens: 1, outputTokens: 1, costUsd, ms: 1, exhausted: false, createdAt: now });
    await run(r1, 20.0); await run(r1, 10.0);  // growth-pattern spend across rooms
    await run(r2, 30.0);
    await run(r3, 15.5);
  });

  const monthly = await t.query(internal.agentRuns.globalSpendSince, { since: now - 30 * 24 * 60 * 60 * 1000 });
  expect(monthly.totalUsd).toBeCloseTo(75.5, 5);  // 20+10+30+15.5 — would trip GLOBAL_MAX_USD_PER_MONTH=75
  expect(monthly.distinctRooms).toBe(3);          // breach reads as GROWTH (many rooms), not runaway
  expect(monthly.runCount).toBe(4);
  expect(monthly.truncated).toBe(false);          // fail-closed flag only at 5000-row saturation

  // Deep-future `since` → empty window → $0 (the gate lets runs through on a fresh month).
  const fresh = await t.query(internal.agentRuns.globalSpendSince, { since: now + 60_000 });
  expect(fresh.totalUsd).toBe(0);
  expect(fresh.distinctRooms).toBe(0);
});

test("retention prune: targets telemetry by age window, never product data", async () => {
  // convex-test won't let us inject a backdated _creationTime, so we prove the prune by CUTOFF
  // DIRECTION: a future cutoff matches every existing row (so telemetry prunes, product data does
  // not); a deep-past cutoff matches nothing (so fresh rows survive). The cutoff arithmetic
  // (now - days*ms) is trivial; the selection + table-scoping is what must be right.
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { code: "RET1", title: "Retain", hostId: "h", autoAllow: true, status: "live" as const, createdAt: now });
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "S", version: 1, order: [], updatedAt: now });
    const trace = await ctx.db.insert("traces", { roomId, ts: now, actor: AGENT, type: "edit_applied", summary: "telemetry" });
    const el = await ctx.db.insert("elements", { artifactId, elementId: "r_x", version: 1, value: "keep", updatedAt: now, updatedBy: AGENT });
    return { trace, el };
  });

  // Deep-past cutoff (retentionDays: 36500) → cutoff is 100y ago → NOTHING matches → fresh kept.
  const keep = await t.mutation(internal.retention.pruneOldTelemetry, { retentionDays: 36_500, batchPerTable: 500 });
  expect(keep.deleted.traces).toBe(0);
  expect(await t.run((ctx) => ctx.db.get(ids.trace))).not.toBeNull();

  // Future cutoff (retentionDays: -1) → cutoff is tomorrow → EVERY existing row is "older".
  const purge = await t.mutation(internal.retention.pruneOldTelemetry, { retentionDays: -1, batchPerTable: 500 });
  expect(purge.deleted.traces).toBe(1);
  const after = await t.run(async (ctx) => ({ trace: await ctx.db.get(ids.trace), el: await ctx.db.get(ids.el) }));
  expect(after.trace).toBeNull();   // telemetry pruned
  expect(after.el).not.toBeNull();  // product data (elements not in PRUNABLE) never touched
});
