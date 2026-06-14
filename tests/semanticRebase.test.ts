import { describe, expect, it } from "vitest";
import { classifySemanticConflictPacket, type SemanticConflictPacket } from "../src/engine/semanticRebase";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, ArtifactKind, CellPayload, ChangeOp } from "../src/engine/types";

const agent: Actor = { kind: "agent", id: "agent-1", name: "Room Agent", scope: "public" };
const user: Actor = { kind: "user", id: "u1", name: "Jordan" };

function op(elementId: string, value: unknown, baseVersion = 1): ChangeOp {
  return { opId: `op-${elementId}`, artifactId: "sheet-1", elementId, kind: "set", value, baseVersion };
}

function packet(overrides: Partial<SemanticConflictPacket> = {}): SemanticConflictPacket {
  return {
    conflictId: "conflict-1",
    roomId: "room-1",
    artifactKind: "sheet",
    draftId: "draft-1",
    trigger: "stale_patch_bundle",
    artifactId: "sheet-1",
    conflictKind: "cell_value",
    overlap: "same_element",
    actor: agent,
    targetRefs: [{ kind: "cell", ref: "B2" }],
    base: { values: { B2: 100 }, versions: { B2: 1 } },
    current: { values: { B2: 110 }, versions: { B2: 2 }, changedBy: { B2: user } },
    proposed: { values: { B2: 120 }, ops: [op("B2", 120)] },
    context: {
      userIntent: "reconcile Q3 revenue",
      mergeNote: "",
      deterministicConflicts: [],
      openQuestions: [],
    },
    policy: {
      humanWinsByDefault: false,
      formulaOverwriteAllowed: false,
      publicPrivateBoundary: "public_only",
      autoCommitAllowed: true,
    },
    status: "needs_review",
    createdAt: 1,
    ...overrides,
  };
}

describe("semantic rebase classifier", () => {
  it("auto-merges independent changes only after final CAS validation", () => {
    const result = classifySemanticConflictPacket(
      packet({
        conflictKind: "cell_value",
        overlap: "none",
        targetRefs: [{ kind: "cell", ref: "C2" }],
        current: { values: { B2: 100 }, versions: { B2: 1 }, changedBy: {} },
        proposed: { values: { C2: 200 }, ops: [op("C2", 200)] },
      }),
    );

    expect(result.tier).toBe("deterministic_auto_merge");
    expect(result.action).toBe("commit_after_final_cas");
    expect(result.canAutoCommit).toBe(true);
    expect(result.requiredValidators).toContain("fresh_final_cas");
  });

  it("rejects formula-to-scalar overwrite before any LLM resolver runs", () => {
    const result = classifySemanticConflictPacket(
      packet({
        conflictKind: "formula",
        targetRefs: [{ kind: "cell", ref: "D5" }],
        current: { values: { D5: { value: 42, formula: "=SUM(D2:D4)" } }, versions: { D5: 4 }, changedBy: { D5: user } },
        proposed: { values: { D5: 42 }, ops: [op("D5", 42, 4)] },
      }),
    );

    expect(result.tier).toBe("forbidden");
    expect(result.action).toBe("reject");
    expect(result.reasons.join(" ")).toContain("formula-to-scalar");
    expect(result.requiredValidators).toContain("formula_preservation");
  });

  it("turns banker assumption conflicts into review proposals", () => {
    const result = classifySemanticConflictPacket(
      packet({
        businessImpact: "ebitda_adjustment",
        targetRefs: [{ kind: "cell", ref: "E8" }],
        current: { values: { E8: "Base case: 12%" }, versions: { E8: 3 }, changedBy: { E8: user } },
        proposed: { values: { E8: "Upside case: 18%" }, ops: [op("E8", "Upside case: 18%", 3)] },
      }),
    );

    expect(result.tier).toBe("human_review_required");
    expect(result.action).toBe("create_review_proposal");
    expect(result.canAutoCommit).toBe(false);
    expect(result.requiredValidators).toContain("review_tier");
  });

  it("allows LLM synthesis only as validator-gated text resolution", () => {
    const result = classifySemanticConflictPacket(
      packet({
        conflictKind: "memo_text",
        overlap: "same_element",
        targetRefs: [{ kind: "memo_block", ref: "m1" }],
        current: { values: { m1: "Customer concentration is manageable." }, versions: { m1: 2 }, changedBy: { m1: user } },
        proposed: { values: { m1: "Customer concentration risk increased." }, ops: [op("m1", "Customer concentration risk increased.", 2)] },
        policy: {
          humanWinsByDefault: false,
          formulaOverwriteAllowed: false,
          publicPrivateBoundary: "public_only",
          autoCommitAllowed: false,
        },
      }),
    );

    expect(result.tier).toBe("llm_assisted_validator_approved");
    expect(result.action).toBe("llm_resolve_then_validate");
    expect(result.canAutoCommit).toBe(false);
    expect(result.requiredValidators).toContain("diff_scope_check");
  });

  it("rejects private uploaded evidence when the target output is public", () => {
    const result = classifySemanticConflictPacket(
      packet({
        current: { values: { F2: null }, versions: { F2: 1 }, changedBy: {} },
        proposed: {
          values: { F2: "Management forecast" },
          ops: [op("F2", "Management forecast")],
          evidence: { F2: [{ id: "e1", kind: "upload", label: "Private model.xlsx", source: "private:file-1" }] },
        },
        policy: {
          humanWinsByDefault: false,
          formulaOverwriteAllowed: false,
          publicPrivateBoundary: "public_only",
          autoCommitAllowed: true,
        },
      }),
    );

    expect(result.tier).toBe("forbidden");
    expect(result.action).toBe("reject");
    expect(result.requiredValidators).toContain("privacy_boundary");
  });

  it("rejects evaluator artifact rewrites", () => {
    const result = classifySemanticConflictPacket(
      packet({
        conflictKind: "evaluator_artifact",
        policy: {
          humanWinsByDefault: false,
          formulaOverwriteAllowed: false,
          publicPrivateBoundary: "public_only",
          autoCommitAllowed: false,
          evaluatorArtifact: true,
        },
      }),
    );

    expect(result.tier).toBe("forbidden");
    expect(result.reasons[0]).toContain("evaluator");
  });
});

function runtimeSetup(args: { kind?: ArtifactKind; seed?: Array<{ id: string; value: unknown }> } = {}) {
  const eng = new RoomEngine();
  const { room, host } = eng.createRoom({ title: "CRS room", hostName: "Jordan", autoAllow: true });
  const hostActor: Actor = { kind: "user", id: host.id, name: "Jordan" };
  const artifact = eng.createArtifact({
    roomId: room.id,
    kind: args.kind ?? "sheet",
    title: args.kind === "note" ? "Memo" : "Model",
    by: hostActor,
    seed: args.seed ?? [
      { id: "B1", value: 100 },
      { id: "B4", value: "" },
      { id: "B6", value: "base" },
    ],
  });
  const roomAgent: Actor = { kind: "agent", id: "agent-room", name: "Room Agent", scope: "public" };
  const privateAgent: Actor = { kind: "agent", id: "agent-private", name: "Private Agent", scope: "private", ownerId: host.id };
  const roomSession = eng.startSession({ roomId: room.id, agentId: roomAgent.id, agentName: roomAgent.name, scope: "public" });
  const privateSession = eng.startSession({ roomId: room.id, agentId: privateAgent.id, agentName: privateAgent.name, scope: "private", ownerId: host.id });
  return { eng, room, hostActor, artifact, roomAgent, privateAgent, roomSession, privateSession };
}

function runtimeOp(opId: string, artifactId: string, elementId: string, value: unknown, baseVersion: number): ChangeOp {
  return { opId, artifactId, elementId, kind: "set", value, baseVersion };
}

function version(engine: RoomEngine, artifactId: string, elementId: string): number {
  return engine.getArtifact(artifactId)!.elements[elementId].version;
}

describe("semantic rebase CRS runtime", () => {
  it("auto-merges an independent draft after unlock with final CAS", () => {
    const { eng, room, artifact, roomAgent, privateAgent, roomSession } = runtimeSetup();
    const lock = eng.proposeLock({
      roomId: room.id,
      artifactId: artifact.id,
      elementIds: ["B1"],
      holder: roomAgent,
      sessionId: roomSession.id,
      reason: "own B1",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;

    const draft = eng.createDraft({
      roomId: room.id,
      artifactId: artifact.id,
      author: privateAgent,
      blockedByLockId: lock.lock.id,
      note: "independent B4 update",
      ops: [runtimeOp("draft-b4", artifact.id, "B4", "safe derived value", version(eng, artifact.id, "B4"))],
    });
    const holderWrite = eng.applyEdit({
      roomId: room.id,
      actor: roomAgent,
      op: runtimeOp("holder-b1", artifact.id, "B1", 101, version(eng, artifact.id, "B1")),
    });
    expect(holderWrite.ok).toBe(true);

    const released = eng.releaseLock(lock.lock.id, roomAgent);
    expect(released.ok).toBe(true);
    const merged = released.merged.find((item) => item.draftId === draft.id)!;
    expect(merged.resolution.verdict).toBe("clean");
    expect(merged.semantic).toBeUndefined();
    expect(eng.getArtifact(artifact.id)!.elements.B1.value).toBe(101);
    expect(eng.getArtifact(artifact.id)!.elements.B4.value).toBe("safe derived value");
    expect(eng.listProposals(room.id)).toHaveLength(0);
    expect(eng.listSemanticConflicts(room.id)).toHaveLength(0);
  });

  it("routes a stale agent patch over a human edit to a proposal, not an overwrite", () => {
    const { eng, room, artifact, hostActor, privateAgent } = runtimeSetup();
    const lock = eng.proposeLock({
      roomId: room.id,
      artifactId: artifact.id,
      elementIds: ["B6"],
      holder: hostActor,
      sessionId: "human-session",
      reason: "human review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;

    const draft = eng.createDraft({
      roomId: room.id,
      artifactId: artifact.id,
      author: privateAgent,
      blockedByLockId: lock.lock.id,
      note: "agent B6 proposal",
      ops: [runtimeOp("agent-b6", artifact.id, "B6", "agent proposed", 1)],
    });
    const human = eng.applyEdit({
      roomId: room.id,
      actor: hostActor,
      op: runtimeOp("human-b6", artifact.id, "B6", "human current", 1),
    });
    expect(human.ok).toBe(true);

    const released = eng.releaseLock(lock.lock.id, hostActor);
    const merged = released.merged.find((item) => item.draftId === draft.id)!;
    expect(merged.resolution.verdict).toBe("needs_review");
    expect(merged.semantic?.proposalIds).toHaveLength(1);
    expect(eng.getArtifact(artifact.id)!.elements.B6.value).toBe("human current");

    const [semanticPacket] = eng.listSemanticConflicts(room.id);
    expect(semanticPacket.base.values.B6).toBe("base");
    expect(semanticPacket.current.values.B6).toBe("human current");
    expect(semanticPacket.proposed.values.B6).toBe("agent proposed");
    const [proposal] = eng.listProposals(room.id);
    expect(proposal.review?.kind).toBe("semantic_rebase");
    expect(proposal.op.baseVersion).toBe(2);
  });

  it("blocks formula-to-scalar overwrite and routes formula replacement to review", () => {
    const formulaValue: CellPayload = { value: 42, formula: "=SUM(D2:D4)", status: "complete" };
    const replacementFormula: CellPayload = { value: 44, formula: "=SUM(D2:D5)", status: "complete" };
    const { eng, room, artifact, hostActor, privateAgent } = runtimeSetup({
      seed: [{ id: "F1", value: formulaValue }],
    });

    const scalar = eng.applyEdit({
      roomId: room.id,
      actor: privateAgent,
      op: runtimeOp("scalar-f1", artifact.id, "F1", 99, 1),
    });
    expect(scalar.ok).toBe(false);
    if (!scalar.ok) expect(scalar.reason).toBe("formula_protected");
    expect(eng.getArtifact(artifact.id)!.elements.F1.value).toEqual(formulaValue);

    const lock = eng.proposeLock({
      roomId: room.id,
      artifactId: artifact.id,
      elementIds: ["F1"],
      holder: hostActor,
      sessionId: "human-session",
      reason: "formula review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    eng.createDraft({
      roomId: room.id,
      artifactId: artifact.id,
      author: privateAgent,
      blockedByLockId: lock.lock.id,
      note: "agent formula replacement",
      ops: [runtimeOp("replace-f1", artifact.id, "F1", replacementFormula, 1)],
    });
    const humanFormula = eng.applyEdit({
      roomId: room.id,
      actor: hostActor,
      op: runtimeOp("human-f1", artifact.id, "F1", { value: 43, formula: "=SUM(D2:D4)", status: "complete" }, 1),
    });
    expect(humanFormula.ok).toBe(true);
    eng.releaseLock(lock.lock.id, hostActor);

    const [proposal] = eng.listProposals(room.id);
    expect(proposal.review?.kind).toBe("semantic_rebase");
    expect(proposal.review?.reason).toContain("Business-value conflict");
    expect(eng.getArtifact(artifact.id)!.elements.F1.value).toMatchObject({ value: 43, formula: "=SUM(D2:D4)" });
  });

  it("creates a review proposal for memo paragraph conflict", () => {
    const { eng, room, artifact, hostActor, privateAgent } = runtimeSetup({
      kind: "note",
      seed: [{ id: "doc", value: "Base memo paragraph." }],
    });
    const lock = eng.proposeLock({
      roomId: room.id,
      artifactId: artifact.id,
      elementIds: ["doc"],
      holder: hostActor,
      sessionId: "human-session",
      reason: "memo review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    eng.createDraft({
      roomId: room.id,
      artifactId: artifact.id,
      author: privateAgent,
      blockedByLockId: lock.lock.id,
      note: "agent memo rewrite",
      ops: [runtimeOp("agent-doc", artifact.id, "doc", "Agent rewrite with new Q3 framing.", 1)],
    });
    const humanMemo = eng.applyEdit({
      roomId: room.id,
      actor: hostActor,
      op: runtimeOp("human-doc", artifact.id, "doc", "Human memo with conservative framing.", 1),
    });
    expect(humanMemo.ok).toBe(true);
    eng.releaseLock(lock.lock.id, hostActor);

    expect(eng.getArtifact(artifact.id)!.elements.doc.value).toBe("Human memo with conservative framing.");
    const [semanticPacket] = eng.listSemanticConflicts(room.id);
    expect(semanticPacket.targetRefs[0]).toMatchObject({ kind: "memo_block", ref: "doc" });
    const [proposal] = eng.listProposals(room.id);
    expect(proposal.review?.status).toBe("draft");
    expect(proposal.op.value).toBe("Agent rewrite with new Q3 framing.");
  });

  it("does not clobber when final CAS is stale after proposed resolution", () => {
    const { eng, room, artifact, hostActor, privateAgent } = runtimeSetup();
    const lock = eng.proposeLock({
      roomId: room.id,
      artifactId: artifact.id,
      elementIds: ["B6"],
      holder: hostActor,
      sessionId: "human-session",
      reason: "human review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    eng.createDraft({
      roomId: room.id,
      artifactId: artifact.id,
      author: privateAgent,
      blockedByLockId: lock.lock.id,
      note: "agent B6 proposal",
      ops: [runtimeOp("agent-b6-stale", artifact.id, "B6", "agent proposed", 1)],
    });
    eng.applyEdit({ roomId: room.id, actor: hostActor, op: runtimeOp("human-b6-v2", artifact.id, "B6", "human v2", 1) });
    eng.releaseLock(lock.lock.id, hostActor);

    const [proposal] = eng.listProposals(room.id);
    expect(proposal.op.baseVersion).toBe(2);
    const humanV3 = eng.applyEdit({
      roomId: room.id,
      actor: hostActor,
      op: runtimeOp("human-b6-v3", artifact.id, "B6", "human v3", 2),
    });
    expect(humanV3.ok).toBe(true);

    const approved = eng.resolveProposal(proposal.id, true, hostActor);
    expect(approved?.ok).toBe(false);
    if (approved && !approved.ok) expect(approved.reason).toBe("conflict");
    expect(eng.getArtifact(artifact.id)!.elements.B6.value).toBe("human v3");
    expect(eng.listProposals(room.id).map((pending) => pending.id)).toContain(proposal.id);
  });
});
