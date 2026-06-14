// @vitest-environment edge-runtime
/**
 * DURABLE SEMANTIC REBASE — the live-Convex completion of the no-clobber wedge.
 *
 * Per-element CAS already stops a stale write from silently clobbering (proven in noClobberWedge).
 * This is the next beat, against the real Convex functions: a stale AGENT write is not merely
 * rejected — it is built into a durable SemanticConflictPacket, classified by the SAME deterministic
 * policy the engine uses, recorded in the `semanticConflicts` ledger, and rebased:
 *
 *   review mode (autoAllow OFF) → a host-approvable proposal on the CURRENT version; approve commits
 *                                 via the final CAS (accepted-resolution-commits-via-CAS).
 *   auto-allow (autoAllow ON)   → recorded durably, NO proposal (no review gate); agent re-reads.
 *
 * A human's committed value is never auto-overwritten (humanWinsByDefault → human_review_required).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const C2 = "r_rev__variance";
const HOST_TOKEN = "host-token-durable-rebase-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seedRoom(t: ReturnType<typeof convexTest>, autoAllow: boolean) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `SR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Q3 diligence", hostId: "pending", autoAllow, status: "live" as const, createdAt: now,
    });
    const hostMemberId = await ctx.db.insert("members", {
      roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN), lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Maya" };
    const artifactId = await ctx.db.insert("artifacts", {
      roomId, kind: "sheet" as const, title: "Q3 variance", version: 1, order: [C2], updatedAt: now,
    });
    await ctx.db.insert("elements", { artifactId, elementId: C2, value: "base", version: 1, updatedAt: now, updatedBy: hostActor });
    await ctx.db.insert("agentSessions", { roomId, agentId: AGENT.id, agentName: AGENT.name, scope: "public" as const, status: "working" as const, lastAction: "seeded", updatedAt: now });
    return { roomId, artifactId, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}

const semConflicts = (t: ReturnType<typeof convexTest>, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("semanticConflicts").collect()).filter((r) => String(r.roomId) === String(roomId)));
const cell = (t: ReturnType<typeof convexTest>, artifactId: unknown, elementId: string) =>
  t.run(async (ctx) => (await ctx.db.query("elements").collect()).find((e) => String(e.artifactId) === String(artifactId) && e.elementId === elementId) ?? null);
const rebaseOf = (r: unknown) => (r as { rebase?: { outcome: string; proposalIds: string[] } }).rebase;

describe("Durable semantic rebase on a stale agent write", () => {
  it("review mode: stale agent write → recorded packet + rebased review proposal; approve commits via final CAS", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, /* autoAllow */ false);

    // human commits C2 → v2 (the agent's baseVersion 1 is now stale)
    const human = await t.mutation(api.artifacts.applyCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+24% Maya", baseVersion: 1, proof: s.hostProof });
    expect(human).toMatchObject({ ok: true, version: 2 });

    // agent writes C2 with a STALE base (1) → CAS conflict → durable rebase to a review proposal
    const agent = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+19% agent", baseVersion: 1, actor: AGENT });
    expect(agent).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });
    const reb = rebaseOf(agent);
    expect(reb?.outcome).toBe("needs_review");
    expect(reb?.proposalIds).toHaveLength(1);

    // durable ledger row recorded with the real classification
    const conflicts = await semConflicts(t, s.roomId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ outcome: "needs_review", canAutoCommit: false, tier: "human_review_required", trigger: "proposal_cas_conflict" });
    expect(conflicts[0].elementIds).toContain(C2);

    // human's value preserved (never clobbered)
    expect((await cell(t, s.artifactId, C2))?.value).toBe("+24% Maya");

    // the rebased proposal sits on the CURRENT version (v2) → host approve commits via final CAS
    const [proposal] = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(proposal).toBeTruthy();
    const approved = await t.mutation(api.artifacts.resolveProposal, { proposalId: proposal.id as Id<"proposals">, approve: true, requester: s.hostProof });
    expect(approved).toMatchObject({ ok: true });
    expect((await cell(t, s.artifactId, C2))?.value).toBe("+19% agent"); // accepted resolution committed via CAS
    expect((await cell(t, s.artifactId, C2))?.version).toBe(3);
  });

  it("auto-allow: stale agent write is recorded durably but creates NO proposal (no review gate)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, /* autoAllow */ true);

    await t.mutation(api.artifacts.applyCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "human", baseVersion: 1, proof: s.hostProof });
    const agent = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "agent stale", baseVersion: 1, actor: AGENT });
    expect(agent).toMatchObject({ ok: false, reason: "conflict" });
    const reb = rebaseOf(agent);
    expect(reb?.outcome).toBe("recorded");
    expect(reb?.proposalIds).toHaveLength(0);

    const conflicts = await semConflicts(t, s.roomId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ outcome: "recorded" });

    // no proposal created in auto-allow; the human's value stands
    expect(await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof })).toHaveLength(0);
    expect((await cell(t, s.artifactId, C2))?.value).toBe("human");
  });
});
