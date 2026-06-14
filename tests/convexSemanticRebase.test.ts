// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const CELL = "r_ni__variance";
const HOST_TOKEN = "host-token-semantic-rebase-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

describe("Convex semantic rebase write path", () => {
  it("keeps a stale approved proposal pending when final CAS rejects it", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { autoAllow: false });

    const proposed = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+22.4%",
      baseVersion: 1,
      actor: AGENT,
    });
    expect(proposed).toMatchObject({ ok: false, reason: "pending_approval" });
    if (proposed.ok || proposed.reason !== "pending_approval" || !proposed.proposalId) throw new Error("expected pending proposal");

    const human = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19.0%",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(human).toMatchObject({ ok: true, version: 2 });

    const approved = await t.mutation(api.artifacts.resolveProposal, {
      proposalId: proposed.proposalId,
      approve: true,
      requester: s.hostProof,
    });
    expect(approved).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const pending = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(pending.map((proposal) => proposal.id)).toContain(String(proposed.proposalId));
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toBe("+19.0%");
  });

  it("blocks an agent formula-to-scalar overwrite before proposal creation", async () => {
    const formulaValue = { value: 42, formula: "=SUM(D2:D4)", status: "complete" };
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { seedValue: formulaValue });

    const scalar = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: 99,
      baseVersion: 1,
      actor: AGENT,
    });
    expect(scalar).toMatchObject({ ok: false, reason: "formula_protected" });
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toEqual(formulaValue);
  });

  it("turns a public draft conflict into a semantic review proposal on the current version", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    const lock = await t.mutation(internal.locks.proposeLock, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementIds: [CELL],
      holder: s.hostActor,
      sessionId: "host-session",
      reason: "human review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) throw new Error("expected lock");

    await t.mutation(internal.drafts.createDraft, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      author: AGENT,
      blockedByLockId: String(lock.lockId),
      note: "agent blocked draft",
      ops: [{ opId: "agent-draft", artifactId: String(s.artifactId), elementId: CELL, kind: "set", value: "+22.4%", baseVersion: 1 }],
    });
    const human = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19.0%",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(human).toMatchObject({ ok: true, version: 2 });

    const released = await t.mutation(internal.locks.releaseLock, { lockId: lock.lockId, actor: s.hostActor });
    expect(released.ok).toBe(true);
    expect(released.merged[0]).toMatchObject({ verdict: "needs_review", conflicts: 1 });

    const [proposal] = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(proposal.review).toMatchObject({ kind: "semantic_rebase", status: "needs_review" });
    expect(proposal.op).toMatchObject({ elementId: CELL, value: "+22.4%", baseVersion: 2 });
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toBe("+19.0%");
  });
});

async function seedRoom(
  t: ReturnType<typeof convexTest>,
  options: { autoAllow?: boolean; seedValue?: unknown } = {},
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `SR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Semantic rebase",
      hostId: "pending",
      autoAllow: options.autoAllow ?? true,
      status: "live" as const,
      createdAt: now,
    });
    const hostMemberId = await ctx.db.insert("members", {
      roomId,
      name: "Homen",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Homen" };
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Model",
      version: 1,
      order: [CELL],
      updatedAt: now,
    });
    await ctx.db.insert("elements", {
      artifactId,
      elementId: CELL,
      value: options.seedValue ?? "base",
      version: 1,
      updatedAt: now,
      updatedBy: hostActor,
    });
    await ctx.db.insert("agentSessions", {
      roomId,
      agentId: AGENT.id,
      agentName: AGENT.name,
      scope: "public" as const,
      status: "working" as const,
      lastAction: "seeded",
      updatedAt: now,
    });
    return { roomId, artifactId, hostActor, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}

function readElement(t: ReturnType<typeof convexTest>, artifactId: Awaited<ReturnType<typeof seedRoom>>["artifactId"]) {
  return t.run(async (ctx) => {
    const elements = await ctx.db.query("elements").collect();
    return elements.find((element) => String(element.artifactId) === String(artifactId) && element.elementId === CELL) ?? null;
  });
}
