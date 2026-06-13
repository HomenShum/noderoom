/**
 * RoomEngine — scenario tests for the collaboration model (point 8).
 *
 * The story under test: two NodeAgents (public + private) and humans edit one
 * sheet. An agent locks an affected range; others are read-only there but can
 * still READ it as context; a blocked agent drafts changes around the lock; on
 * unlock the draft smart-merges (clean when it touched untouched cells, conflict
 * when it diverged from committed work). Plus CAS, auto-allow, idempotency,
 * awareness, and traces.
 */

import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, ChangeOp } from "../src/engine/types";

function setup(autoAllow = true) {
  const eng = new RoomEngine();
  const { room, host } = eng.createRoom({ title: "Acme DD", hostName: "Jordan", autoAllow });
  const hostActor: Actor = { kind: "user", id: host.id, name: "Jordan" };
  const sheet = eng.createArtifact({
    roomId: room.id, kind: "sheet", title: "runway", by: hostActor,
    seed: [
      { id: "B1", value: 510 }, { id: "B2", value: 7560 }, { id: "B3", value: 14.8 },
      { id: "B4", value: 0 }, { id: "B5", value: 0 }, { id: "B6", value: 0 },
    ],
  });
  const pub: Actor = { kind: "agent", id: "pub", name: "Room Agent", scope: "public" };
  const priv: Actor = { kind: "agent", id: "priv", name: "Priya Agent", scope: "private", ownerId: "u2" };
  const sPub = eng.startSession({ roomId: room.id, agentId: "pub", agentName: "Room Agent", scope: "public" });
  const sPriv = eng.startSession({ roomId: room.id, agentId: "priv", agentName: "Priya Agent", scope: "private", ownerId: "u2" });
  return { eng, room, host, hostActor, sheet, pub, priv, sPub, sPriv };
}
const ver = (eng: RoomEngine, sheetId: string, id: string) => eng.getArtifact(sheetId)!.elements[id].version;
const setOp = (opId: string, artifactId: string, elementId: string, value: unknown, baseVersion: number): ChangeOp =>
  ({ opId, artifactId, elementId, kind: "set", value, baseVersion });

describe("rooms + anonymous join (points 2,3)", () => {
  it("hosts a room and lets an anonymous member join by code", () => {
    const { eng, room } = setup();
    const joined = eng.joinRoom({ code: room.code, name: "Priya" });
    expect(joined).not.toBeNull();
    expect(joined!.member.role).toBe("member");
    expect(joined!.member.anon).toBe(true);
    expect(eng.listMembers(room.id)).toHaveLength(2);
  });
  it("rejects a bad code", () => {
    const { eng } = setup();
    expect(eng.joinRoom({ code: "nope", name: "X" })).toBeNull();
  });
});

describe("CAS edits (optimistic concurrency)", () => {
  it("applies an edit, bumps the element version, returns conflict on a stale base", () => {
    const { eng, room, sheet, hostActor } = setup();
    const r = eng.applyEdit({ roomId: room.id, op: setOp("o1", sheet.id, "B1", 420, 1), actor: hostActor });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toVersion).toBe(2);
    expect(eng.getArtifact(sheet.id)!.elements.B1.value).toBe(420);
    expect(eng.listTraces(room.id).find((t) => t.type === "edit_applied" && t.refs?.cell === "B1")?.refs).toMatchObject({
      artifactId: sheet.id,
      cell: "B1",
      elementId: "B1",
    });

    const stale = eng.applyEdit({ roomId: room.id, op: setOp("o2", sheet.id, "B1", 999, 1), actor: hostActor });
    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.reason === "conflict") { expect(stale.expected).toBe(1); expect(stale.actual).toBe(2); }
  });
});

describe("the lock tool: read-only range, still readable as context (point 8)", () => {
  it("blocks others' edits inside the lock but the holder can edit, and the range stays readable", () => {
    const { eng, room, sheet, pub, priv, sPub } = setup();
    const lr = eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1", "B2", "B3"], holder: pub, sessionId: sPub.id, reason: "recompute runway" });
    expect(lr.ok).toBe(true);

    // Another agent's edit inside the range is blocked (read-only).
    const blocked = eng.applyEdit({ roomId: room.id, op: setOp("b", sheet.id, "B2", 8000, ver(eng, sheet.id, "B2")), actor: priv });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("locked");

    // ...but the locked range is still READABLE as context.
    expect(eng.readRange(sheet.id, ["B1", "B2", "B3"]).B2.value).toBe(7560);

    // The lock-holder can edit within its own lock.
    const held = eng.applyEdit({ roomId: room.id, op: setOp("h", sheet.id, "B1", 430, ver(eng, sheet.id, "B1")), actor: pub });
    expect(held.ok).toBe(true);
  });

  it("denies a second lock that overlaps an active one", () => {
    const { eng, room, sheet, pub, priv, sPub, sPriv } = setup();
    eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1", "B2"], holder: pub, sessionId: sPub.id, reason: "a" });
    const second = eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B2", "B3"], holder: priv, sessionId: sPriv.id, reason: "b" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.conflicting.map((c) => c.elementId)).toContain("B2");
  });

  it("does not let another actor release someone else's lock", () => {
    const { eng, room, sheet, pub, priv, sPub } = setup();
    const lock = eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1"], holder: pub, sessionId: sPub.id, reason: "owner edit" });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;

    const denied = eng.releaseLock(lock.lock.id, priv);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("not_holder");
    expect(eng.lockFor(sheet.id, "B1")).toBeDefined();

    const released = eng.releaseLock(lock.lock.id, pub);
    expect(released.ok).toBe(true);
    expect(eng.lockFor(sheet.id, "B1")).toBeUndefined();
    expect(eng.listTraces(room.id).find((t) => t.type === "lock_released")?.refs).toMatchObject({
      lockId: lock.lock.id,
      artifactId: sheet.id,
      cell: "B1",
      elementId: "B1",
    });
  });
});

describe("draft → smart-merge on unlock (point 8)", () => {
  it("a blocked agent's draft AROUND the locked range merges cleanly on release", () => {
    const { eng, room, sheet, pub, priv, sPub } = setup();
    const lr = eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1", "B2", "B3"], holder: pub, sessionId: sPub.id, reason: "runway" });
    const lockId = lr.ok ? lr.lock.id : "";

    // Priya's agent is blocked from B1:B3, reads them as context, and drafts the
    // DERIVED metrics in B4:B5 (which the lock-holder never touches).
    const draft = eng.createDraft({
      roomId: room.id, artifactId: sheet.id, author: priv, blockedByLockId: lockId,
      note: "derived metrics around the locked runway",
      ops: [setOp("d1", sheet.id, "B4", 100, ver(eng, sheet.id, "B4")), setOp("d2", sheet.id, "B5", 200, ver(eng, sheet.id, "B5"))],
    });
    expect(eng.listDrafts(room.id).find((d) => d.id === draft.id)!.status).toBe("pending");

    const out = eng.releaseLock(lockId, pub);
    expect(out.merged).toHaveLength(1);
    expect(out.merged[0].conflicts).toHaveLength(0);
    expect(out.merged[0].resolution.verdict).toBe("clean");
    expect(eng.getArtifact(sheet.id)!.elements.B4.value).toBe(100);
    expect(eng.listDrafts(room.id).find((d) => d.id === draft.id)!.status).toBe("merged");
  });

  it("flags a conflict when the draft diverged from committed work inside the range", () => {
    const { eng, room, sheet, pub, priv, sPub } = setup();
    const lr = eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1", "B2", "B3"], holder: pub, sessionId: sPub.id, reason: "runway" });
    const lockId = lr.ok ? lr.lock.id : "";

    // Draft includes an op on B1 (inside the lock) based on the OLD value (510)...
    const b1Base = ver(eng, sheet.id, "B1");
    const draft = eng.createDraft({
      roomId: room.id, artifactId: sheet.id, author: priv, blockedByLockId: lockId,
      note: "wants B1=480 and a safe B4",
      ops: [setOp("d1", sheet.id, "B1", 480, b1Base), setOp("d2", sheet.id, "B4", 100, ver(eng, sheet.id, "B4"))],
    });

    // ...meanwhile the lock-holder commits a DIFFERENT B1 (420). Now they diverge.
    eng.applyEdit({ roomId: room.id, op: setOp("h", sheet.id, "B1", 420, b1Base), actor: pub });

    const out = eng.releaseLock(lockId, pub);
    const m = out.merged.find((x) => x.draftId === draft.id)!;
    expect(m.conflicts.map((c) => c.elementId)).toContain("B1"); // B1 diverged → review
    expect(eng.getArtifact(sheet.id)!.elements.B1.value).toBe(420); // committed work NOT clobbered
    expect(eng.getArtifact(sheet.id)!.elements.B4.value).toBe(100); // the safe op still merged
    expect(eng.listDrafts(room.id).find((d) => d.id === draft.id)!.status).toBe("conflict");
  });
});

describe("auto-allow toggle (point 8)", () => {
  it("agent edits become proposals when auto-allow is OFF, then apply on approval", () => {
    const { eng, room, sheet, pub, hostActor } = setup(false);
    const r = eng.applyEdit({ roomId: room.id, op: setOp("o", sheet.id, "B6", 42, ver(eng, sheet.id, "B6")), actor: pub });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "pending_approval") {
      expect(eng.listProposals(room.id)).toHaveLength(1);
      const applied = eng.resolveProposal(r.proposalId, true, hostActor);
      expect(applied?.ok).toBe(true);
      expect(eng.getArtifact(sheet.id)!.elements.B6.value).toBe(42);
    } else { throw new Error("expected a proposal"); }
  });

  it("coalesces identical pending agent proposals instead of creating duplicate cards", () => {
    const { eng, room, sheet, pub } = setup(false);
    const baseVersion = ver(eng, sheet.id, "B6");
    const first = eng.applyEdit({ roomId: room.id, op: setOp("o1", sheet.id, "B6", 42, baseVersion), actor: pub });
    const retry = eng.applyEdit({ roomId: room.id, op: setOp("o2", sheet.id, "B6", 42, baseVersion), actor: pub });

    expect(first.ok).toBe(false);
    expect(retry.ok).toBe(false);
    if (!first.ok && first.reason === "pending_approval" && !retry.ok && retry.reason === "pending_approval") {
      expect(retry.proposalId).toBe(first.proposalId);
    } else { throw new Error("expected proposal reuse"); }
    expect(eng.listProposals(room.id)).toHaveLength(1);
    expect(eng.listTraces(room.id).filter((t) => t.type === "edit_proposed")).toHaveLength(1);
  });

  it("a human edit always applies regardless of auto-allow", () => {
    const { eng, room, sheet, hostActor } = setup(false);
    const r = eng.applyEdit({ roomId: room.id, op: setOp("o", sheet.id, "B6", 7, ver(eng, sheet.id, "B6")), actor: hostActor });
    expect(r.ok).toBe(true);
  });

  it("host can accept all pending agent proposals without losing the audit trail", () => {
    const { eng, room, sheet, pub, hostActor } = setup(false);
    const a = eng.applyEdit({ roomId: room.id, op: setOp("p1", sheet.id, "B5", 12, ver(eng, sheet.id, "B5")), actor: pub });
    const b = eng.applyEdit({ roomId: room.id, op: setOp("p2", sheet.id, "B6", 34, ver(eng, sheet.id, "B6")), actor: pub });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    const pending = eng.listProposals(room.id);
    expect(pending).toHaveLength(2);

    for (const p of pending) eng.resolveProposal(p.id, true, hostActor);

    expect(eng.listProposals(room.id)).toHaveLength(0);
    expect(eng.getArtifact(sheet.id)!.elements.B5.value).toBe(12);
    expect(eng.getArtifact(sheet.id)!.elements.B6.value).toBe(34);
    expect(eng.listTraces(room.id).filter((t) => t.type === "proposal_resolved")).toHaveLength(2);
  });
});

describe("wall post-its", () => {
  it("creates and deletes post-its through versioned element operations", () => {
    const { eng, room, hostActor } = setup();
    const wall = eng.createArtifact({ roomId: room.id, kind: "wall", title: "Wall", by: hostActor, seed: [] });
    const value = { text: "Follow up", x: 20, y: 30, color: "#F2DE9B" };

    const created = eng.applyEdit({ roomId: room.id, op: { opId: "wc", artifactId: wall.id, elementId: "s_new", kind: "create", value, baseVersion: 0 }, actor: hostActor });
    expect(created.ok).toBe(true);
    expect(eng.getArtifact(wall.id)!.order).toContain("s_new");
    expect(eng.getArtifact(wall.id)!.elements.s_new.value).toEqual(value);

    const deleted = eng.applyEdit({ roomId: room.id, op: { opId: "wd", artifactId: wall.id, elementId: "s_new", kind: "delete", value: null, baseVersion: 1 }, actor: hostActor });
    expect(deleted.ok).toBe(true);
    expect(eng.getArtifact(wall.id)!.order).not.toContain("s_new");
    expect(eng.getArtifact(wall.id)!.elements.s_new).toBeUndefined();
    expect(eng.listTraces(room.id).some((t) => /deleted s_new/.test(t.summary))).toBe(true);
  });
});

describe("idempotency", () => {
  it("re-applying the same opId is a no-op success; a duplicate clientMsgId is deduped", () => {
    const { eng, room, sheet, hostActor } = setup();
    const op = setOp("dup", sheet.id, "B1", 420, 1);
    expect(eng.applyEdit({ roomId: room.id, op, actor: hostActor }).ok).toBe(true);
    const again = eng.applyEdit({ roomId: room.id, op, actor: hostActor });
    expect(again.ok).toBe(true); // idempotent
    expect(eng.getArtifact(sheet.id)!.elements.B1.version).toBe(2); // did NOT bump twice

    const m1 = eng.postMessage({ roomId: room.id, channel: "public", author: hostActor, text: "hi", clientMsgId: "c1" });
    const m2 = eng.postMessage({ roomId: room.id, channel: "public", author: hostActor, text: "hi", clientMsgId: "c1" });
    expect(m1).not.toBeNull();
    expect(m2).toBeNull(); // deduped
    expect(eng.listMessages(room.id, "public")).toHaveLength(1);
  });
});

describe("research imports", () => {
  it("re-imports an existing account as an update instead of creating a suffixed duplicate", () => {
    const { eng, room, hostActor } = setup();
    const research = eng.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: hostActor, seed: [] });

    const first = eng.addResearchRows({
      roomId: room.id,
      artifactId: research.id,
      by: hostActor,
      rows: [{ company: "Acme", website: "https://www.acme.com", tier: "B", intent: "research", owner: "Maya", crmStatus: "Research" }],
    });
    expect(first).toEqual(["rc_acme"]);
    expect(eng.getArtifact(research.id)!.order.filter((id) => id.startsWith("rc_acme__"))).toHaveLength(14);

    eng.applyEdit({ roomId: room.id, actor: hostActor, op: setOp("summary", research.id, "rc_acme__summary", "Sourced summary stays.", 1) });
    const second = eng.addResearchRows({
      roomId: room.id,
      artifactId: research.id,
      by: hostActor,
      rows: [{ company: "ACME Inc.", website: "https://acme.com", tier: "A", intent: "outreach", owner: "Priya", crmStatus: "Target" }],
    });

    const art = eng.getArtifact(research.id)!;
    expect(second).toEqual(["rc_acme"]);
    expect(art.order.some((id) => id.startsWith("rc_acme_1__"))).toBe(false);
    expect(art.elements["rc_acme__company"].value).toBe("ACME Inc.");
    expect(art.elements["rc_acme__tier"].value).toBe("A");
    expect(art.elements["rc_acme__crm_status"].value).toBe("Target");
    expect(art.elements["rc_acme__summary"].value).toBe("Sourced summary stays.");
  });
});

describe("cross-agent awareness + traces (point 8)", () => {
  it("an agent sees the other agent's lock and session, and the room keeps a trace log", () => {
    const { eng, room, sheet, pub, sPub } = setup();
    eng.proposeLock({ roomId: room.id, artifactId: sheet.id, elementIds: ["B1"], holder: pub, sessionId: sPub.id, reason: "x" });
    const aware = eng.awareness(room.id, "priv"); // what Priya's agent sees
    expect(aware.activeLocks.some((l) => l.holder.id === "pub")).toBe(true);
    expect(aware.sessions.some((s) => s.agentId === "pub")).toBe(true);
    expect(eng.listTraces(room.id).some((t) => t.type === "lock_acquired")).toBe(true);
  });
});

describe("private vs public channels (points 4,6)", () => {
  it("keeps public and private messages separate", () => {
    const { eng, room, hostActor } = setup();
    eng.postMessage({ roomId: room.id, channel: "public", author: hostActor, text: "public hi", clientMsgId: "p1" });
    eng.postMessage({ roomId: room.id, channel: { private: hostActor.id }, author: hostActor, text: "private hi", clientMsgId: "v1" });
    expect(eng.listMessages(room.id, "public")).toHaveLength(1);
    expect(eng.listMessages(room.id, { private: hostActor.id })).toHaveLength(1);
    expect(eng.listMessages(room.id, { private: "someone-else" })).toHaveLength(0);
  });
});
