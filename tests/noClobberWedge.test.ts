// @vitest-environment edge-runtime
/**
 * THE NO-CLOBBER WEDGE — the headline claim as ONE sequenced, named artifact.
 *
 * "Humans and agents edit the same live spreadsheet and no write silently clobbers another."
 *
 * The sub-parts are proven elsewhere (allArtifactEdits, convexSemanticRebase, agentRuntime, and the
 * live three-user-collab e2e). What was missing — per the wedge audit — is the WHOLE beat run in
 * sequence with the human's contested cell held throughout and provably preserved at the end. This
 * is that proof, against the real Convex functions (convex-test, in-memory deployment, no deploy):
 *
 *   BEAT 1  human edits the contested cell C2 (it becomes the human's value)
 *   BEAT 2  agent works the block concurrently — its SAFE cell commits, but its write to C2 carries
 *           a STALE baseVersion (it read before the human) and CAS REJECTS it -> human's C2 preserved
 *   BEAT 3  in review mode the agent's contested edit becomes a host-approvable PROPOSAL; the human
 *           moves C2 forward again; host Approve RE-RUNS CAS and the stale proposal stays pending ->
 *           the human's newest value still wins
 *   TRACE   the agent's rejected clobber left NO edit_applied trace; every applied edit is attributed
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const C2 = "r_rev__variance"; // the contested cell the human is editing
const A1 = "r_cogs__variance"; // a safe cell in the agent's block (no human on it)
const HOST_TOKEN = "host-token-no-clobber-wedge-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seedRoom(t: ReturnType<typeof convexTest>, autoAllow: boolean) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `NC${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Q3 diligence", hostId: "pending", autoAllow, status: "live" as const, createdAt: now,
    });
    const hostMemberId = await ctx.db.insert("members", {
      roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN), lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Maya" };
    const artifactId = await ctx.db.insert("artifacts", {
      roomId, kind: "sheet" as const, title: "Q3 variance", version: 1, order: [C2, A1], updatedAt: now,
    });
    for (const elementId of [C2, A1]) {
      await ctx.db.insert("elements", { artifactId, elementId, value: "base", version: 1, updatedAt: now, updatedBy: hostActor });
    }
    await ctx.db.insert("agentSessions", { roomId, agentId: AGENT.id, agentName: AGENT.name, scope: "public" as const, status: "working" as const, lastAction: "seeded", updatedAt: now });
    return { roomId, artifactId, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}
const readCell = (t: ReturnType<typeof convexTest>, artifactId: unknown, elementId: string) =>
  t.run(async (ctx) => (await ctx.db.query("elements").collect()).find((e) => String(e.artifactId) === String(artifactId) && e.elementId === elementId) ?? null);
const traces = (t: ReturnType<typeof convexTest>, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("traces").collect()).filter((tr) => String(tr.roomId) === String(roomId)));

describe("The no-clobber wedge: human + agent on the same live cell", () => {
  it("human holds C2 while the agent works the block — CAS preserves the human's value, the contested edit becomes a host-approved proposal that re-checks CAS, and the trace never lies", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, /* autoAllow */ true); // BEAT 1-2 run in auto-allow (no review gate)

    // ── BEAT 1: the human commits C2 (their value is now live; C2 -> v2) ──────────────────────────
    const human = await t.mutation(api.artifacts.applyCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+24% Maya", baseVersion: 1, proof: s.hostProof });
    expect(human).toMatchObject({ ok: true, version: 2 });

    // ── BEAT 2a: the agent's SAFE cell (A1) commits cleanly — agents are NOT blanket-blocked ───────
    const agentSafe = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: A1, value: "+27.5%", baseVersion: 1, actor: AGENT });
    expect(agentSafe).toMatchObject({ ok: true, version: 2 });

    // ── BEAT 2b: the agent read C2 BEFORE the human (baseVersion 1) and tries to write it ──────────
    //     CAS rejects the stale write as DATA — the human's value is NOT clobbered.
    const agentClobber = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+19.0% (agent, stale)", baseVersion: 1, actor: AGENT });
    expect(agentClobber).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });
    expect((await readCell(t, s.artifactId, C2))?.value).toBe("+24% Maya"); // human preserved
    expect((await readCell(t, s.artifactId, C2))?.version).toBe(2);

    // ── BEAT 3: review mode ON — the contested agent edit becomes a host-approvable proposal ───────
    await t.run(async (ctx) => ctx.db.patch(s.roomId, { autoAllow: false }));
    const proposed = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+19.0% (agent, proposed)", baseVersion: 2, actor: AGENT });
    expect(proposed).toMatchObject({ ok: false, reason: "pending_approval" });
    const proposalId = proposed.ok ? undefined : proposed.proposalId;
    expect(proposalId).toBeTruthy();

    // the human moves C2 forward AGAIN while the proposal is pending (C2 -> v3)
    const human2 = await t.mutation(api.artifacts.applyCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "+24.5% Maya (final)", baseVersion: 2, proof: s.hostProof });
    expect(human2).toMatchObject({ ok: true, version: 3 });

    // host Approve RE-RUNS CAS: the proposal was built on v2, C2 is now v3 -> stale -> stays pending
    const approved = await t.mutation(api.artifacts.resolveProposal, { proposalId: proposalId!, approve: true, requester: s.hostProof });
    expect(approved).toMatchObject({ ok: false, reason: "conflict", expected: 2, actual: 3 });

    // the human's NEWEST value wins; the stale approved proposal is still pending (not silently applied)
    expect((await readCell(t, s.artifactId, C2))?.value).toBe("+24.5% Maya (final)");
    const pending = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(pending.map((p) => String(p.id))).toContain(String(proposalId));

    // ── TRACE: the audit trail is honest — every APPLIED edit is attributed, and the agent's two
    //     rejected C2 writes left NO edit_applied trace (no silent clobber, no false history) ───────
    const tr = await traces(t, s.roomId);
    expect(tr.some((x) => x.type === "edit_applied" && x.summary.includes("Maya set r_rev__variance"))).toBe(true); // human's C2 edits traced
    expect(tr.some((x) => x.type === "edit_applied" && x.actor.kind === "agent" && x.summary.includes("r_cogs__variance"))).toBe(true); // agent's SAFE cell traced
    expect(tr.some((x) => x.type === "edit_applied" && x.actor.kind === "agent" && x.summary.includes("r_rev__variance"))).toBe(false); // agent NEVER recorded as having written the contested cell
  });

  it("auto-allow does NOT bypass CAS: a concurrent agent write on a moved cell still conflicts", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, true);
    await t.mutation(api.artifacts.applyCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "human", baseVersion: 1, proof: s.hostProof });
    const agent = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: s.roomId, artifactId: s.artifactId, elementId: C2, value: "agent", baseVersion: 1, actor: AGENT });
    expect(agent).toMatchObject({ ok: false, reason: "conflict" });
    expect((await readCell(t, s.artifactId, C2))?.value).toBe("human");
  });
});
