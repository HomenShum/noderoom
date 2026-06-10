// @vitest-environment edge-runtime
/**
 * RUNTIME proof for P0-5 lease-epoch fencing + P1-2 janitor + P1-6 host takeover + P1-1 ops
 * redaction — REAL Convex mutations against an in-memory deployment (convex-test), no deploy.
 *
 * Scenario: a credit-spreading agent on a long durable job (9-min slices) holds a 5-min lock lease
 * over the variance range while a human host watches the room. Kleppmann's fencing failure mode:
 * the lease lapses mid-job and — before this fix — the agent's writes silently proceeded UNLOCKED.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken, LOCK_TTL_MS } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // "use node" action — not needed here

const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
const CELL = "r_ni__variance";
// Auth tokens must satisfy requireStrongAuthToken (>=32 chars, >=12 distinct, no whitespace).
const HOST_TOK = "host-token-abcdefghij0123456789-XYZ";
const PRIYA_TOK = "priya-token-abcdefghij0123456789-XYZ";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "FENCE1", title: "Fencing", hostId: "pending", autoAllow: true, status: "live" as const, createdAt: now });
    const hostMemberId = await ctx.db.insert("members", { roomId, name: "Homen", role: "host" as const, anon: false, color: "#d97757", authTokenHash: await hashToken(HOST_TOK), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Q3", version: 1, order: [CELL], updatedAt: now });
    await ctx.db.insert("elements", { artifactId, elementId: CELL, value: "", version: 1, updatedAt: now, updatedBy: AGENT });
    const sessionId = await ctx.db.insert("agentSessions", { roomId, agentId: AGENT.id, agentName: AGENT.name, scope: "public" as const, status: "working" as const, lastAction: "seeded", updatedAt: now });
    return { roomId, artifactId, sessionId, hostMemberId };
  });
}

const insertLock = (t: ReturnType<typeof convexTest>, s: Awaited<ReturnType<typeof seedRoom>>, expiresAt: number, holder = AGENT) =>
  t.run((ctx) => ctx.db.insert("locks", { roomId: s.roomId, artifactId: s.artifactId, elementIds: [CELL], holder, sessionId: String(s.sessionId), reason: "spreading", status: "active" as const, createdAt: Date.now(), expiresAt }));

test("P0-5: a write under MY EXPIRED lease is rejected as lease_expired DATA — never a silent unlocked write", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  await insertLock(t, s, Date.now() - 1_000); // the agent's own lease lapsed (TTL 5min < slice 9min)

  const r = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: CELL, value: "+22.4%", baseVersion: 1, actor: AGENT });
  expect(r).toMatchObject({ ok: false, reason: "lease_expired" });
  const el = await t.run(async (ctx) => (await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId).eq("elementId", CELL)).unique()));
  expect(el?.value).toBe(""); // nothing written
});

test("P0-5: a write under MY VALID lease succeeds AND renews the lease (healthy long job never lapses)", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  const soonExpiry = Date.now() + 30_000; // 30s left on the lease
  const lockId = await insertLock(t, s, soonExpiry);

  const r = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: CELL, value: "+22.4%", baseVersion: 1, actor: AGENT });
  expect(r).toMatchObject({ ok: true, version: 2 });
  const lock = await t.run((ctx) => ctx.db.get(lockId));
  expect(lock?.expiresAt).toBeGreaterThan(soonExpiry + LOCK_TTL_MS / 2); // renewed ~now+TTL, not the old 30s
});

test("P0-5 regression: ANOTHER holder's valid lock still rejects as locked (unchanged semantics)", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  const other = { kind: "agent" as const, id: "agent_priv", name: "Private NodeAgent", scope: "public" as const };
  await insertLock(t, s, Date.now() + 60_000, other);
  const r = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: CELL, value: "+9%", baseVersion: 1, actor: AGENT });
  expect(r).toMatchObject({ ok: false, reason: "locked", by: other.name });
});

test("P1-2 janitor: sweeps an expired lock — status released, session cleared, blocked draft merged", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  const lockId = await insertLock(t, s, Date.now() - 5_000);
  await t.run(async (ctx) => {
    await ctx.db.patch(s.sessionId, { heldLockId: String(lockId) });
    await ctx.db.insert("drafts", {
      roomId: s.roomId, artifactId: s.artifactId, author: { kind: "user" as const, id: String(s.hostMemberId), name: "Homen" },
      ops: [{ opId: "op1", artifactId: String(s.artifactId), elementId: CELL, kind: "set" as const, value: "+20.5%", baseVersion: 1 }],
      note: "human draft blocked by the agent lock", blockedByLockId: String(lockId), status: "pending" as const, createdAt: Date.now(),
    });
  });

  const swept = await t.mutation(internal.locks.sweepExpiredLocks, {});
  expect(swept.swept).toBe(1);
  const after = await t.run(async (ctx) => ({
    lock: await ctx.db.get(lockId),
    session: await ctx.db.get(s.sessionId),
    drafts: await ctx.db.query("drafts").collect(),
    el: await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId).eq("elementId", CELL)).unique(),
  }));
  expect(after.lock?.status).toBe("released");          // not locked-forever
  expect(after.session?.heldLockId).toBeUndefined();    // session no longer points at a zombie lock
  expect(after.drafts[0]?.status).not.toBe("pending");  // the blocked draft was NOT stranded — merge fired
  expect(String(after.el?.value)).toBe("+20.5%");       // and actually applied (CAS baseline was valid)
});

test("P1-6 host takeover: the HOST yoinks a stuck agent lock; a non-host cannot", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  const lockId = await insertLock(t, s, Date.now() + 60_000); // still validly held — host shouldn't have to wait out the TTL
  const hostProof = { actor: { kind: "user" as const, id: String(s.hostMemberId), name: "Homen" }, token: HOST_TOK };

  // a non-host member is denied
  const memberId = await t.run(async (ctx) => ctx.db.insert("members", { roomId: s.roomId, name: "Priya", role: "member" as const, anon: false, color: "#888", authTokenHash: await hashToken(PRIYA_TOK), lastSeenAt: Date.now() }));
  const denied = await t.mutation(api.locks.hostForceReleaseLock, { roomId: s.roomId, lockId, requester: { actor: { kind: "user" as const, id: String(memberId), name: "Priya" }, token: PRIYA_TOK } });
  expect(denied).toMatchObject({ ok: false, reason: "host_only" });

  const taken = await t.mutation(api.locks.hostForceReleaseLock, { roomId: s.roomId, lockId, requester: hostProof });
  expect(taken.ok).toBe(true);
  const lock = await t.run((ctx) => ctx.db.get(lockId));
  expect(lock?.status).toBe("released");
});

test("P1-1: a private draft's OPS are redacted from non-owners (owner still sees them)", async () => {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t);
  // Private agent owned by the host drafts a cell edit; another member must NOT see the edits.
  await t.run(async (ctx) => {
    await ctx.db.insert("drafts", {
      roomId: s.roomId, artifactId: s.artifactId,
      author: { kind: "agent" as const, id: "agent_priv", name: "Private NodeAgent", scope: "private" as const, ownerId: String(s.hostMemberId) },
      ops: [{ opId: "p1", artifactId: String(s.artifactId), elementId: CELL, kind: "set" as const, value: "SECRET +31%", baseVersion: 1 }],
      note: "private analysis", status: "pending" as const, createdAt: Date.now(),
    });
  });
  const memberId = await t.run(async (ctx) => ctx.db.insert("members", { roomId: s.roomId, name: "Priya", role: "member" as const, anon: false, color: "#888", authTokenHash: await hashToken(PRIYA_TOK), lastSeenAt: Date.now() }));

  const asMember = await t.query(api.rooms.full, { roomId: s.roomId, requester: { actor: { kind: "user" as const, id: String(memberId), name: "Priya" }, token: PRIYA_TOK } });
  expect(asMember?.drafts[0].ops).toEqual([]);                    // the leak is closed
  expect(asMember?.drafts[0].opsRedacted).toBe(1);                // honest count, not silent absence
  expect(JSON.stringify(asMember?.drafts[0])).not.toContain("SECRET"); // value never crosses the wire

  const asOwner = await t.query(api.rooms.full, { roomId: s.roomId, requester: { actor: { kind: "user" as const, id: String(s.hostMemberId), name: "Homen" }, token: HOST_TOK } });
  expect(asOwner?.drafts[0].ops).toHaveLength(1);                 // the owner keeps full visibility
});
