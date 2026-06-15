// @vitest-environment edge-runtime
/**
 * PLANPREVIEW ADMISSION GATE — server-side, fail-closed (deep-review Layer B).
 *
 * The structured intake classification + affected-set/conflict computation that used to be a
 * client-advisory badge now runs in the BACKEND before any durable work is queued. A free-auto run
 * whose affected set overlaps an unresolved pending proposal — or a cancel/wait/privacy/formula/
 * budget intent — is refused: recorded as a terminal "blocked" agentJobs row with the PlanPreview
 * persisted and a plan_blocked trace, and the tool loop is never started.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const C2 = "r_rev__variance";
const HOST_TOKEN = "host-token-planpreview-gate-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: `PP${Math.random().toString(36).slice(2, 8).toUpperCase()}`, title: "Q3", hostId: "pending", autoAllow: false, status: "live" as const, createdAt: now });
    const hostMemberId = await ctx.db.insert("members", { roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111", authTokenHash: await hashToken(HOST_TOKEN), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Maya" };
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Q3 variance", version: 1, order: [C2], updatedAt: now });
    await ctx.db.insert("elements", { artifactId, elementId: C2, value: "base", version: 1, updatedAt: now, updatedBy: hostActor });
    return { roomId, artifactId, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}
const getJob = (t: ReturnType<typeof convexTest>, jobId: unknown) => t.run(async (ctx) => ctx.db.get(jobId as never)) as Promise<any>;
const tracesOf = (t: ReturnType<typeof convexTest>, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("traces").collect()).filter((x) => String(x.roomId) === String(roomId)));

describe("PlanPreview admission gate (startFreeAuto)", () => {
  it("blocks a free-auto run whose affected set overlaps an unresolved pending proposal", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    // a pending proposal already targets C2 on this artifact
    await t.run(async (ctx) => ctx.db.insert("proposals", {
      roomId: s.roomId, artifactId: s.artifactId,
      op: { opId: "p1", artifactId: String(s.artifactId), elementId: C2, kind: "set", value: "x", baseVersion: 1 },
      author: AGENT, status: "pending", createdAt: Date.now(),
    }));
    const jobId = await t.mutation(api.agentJobs.startFreeAuto, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof, goal: "enrich the pending company rows with sourced data" });
    const j = await getJob(t, jobId);
    expect(j.status).toBe("blocked");                 // terminal; tool loop never started
    expect(j.workflowId).toBeUndefined();
    expect(j.planPreview?.scheduling).toBe("draft_first");
    expect((j.planPreview?.conflicts ?? []).some((c: { kind: string }) => c.kind === "pending_proposal")).toBe(true);
    expect((await tracesOf(t, s.roomId)).some((x) => x.type === "plan_blocked")).toBe(true);
  });

  it("blocks a wait/cancel intent before any durable work is queued", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const jobId = await t.mutation(api.agentJobs.startFreeAuto, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof, goal: "wait for the host to finish reviewing" });
    const j = await getJob(t, jobId);
    expect(j.status).toBe("blocked");
    expect(j.workflowId).toBeUndefined();
    expect(j.planPreview?.scheduling).toBe("wait_for_human");
  });
});
