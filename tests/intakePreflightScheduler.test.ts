import { describe, expect, it } from "vitest";
import { buildPlanPreview, classifyIntakeMessage } from "../src/agent/intakePreflight";

describe("intake preflight scheduler", () => {
  it("classifies user messages into deterministic intake decisions", () => {
    expect(classifyIntakeMessage("/ask reconcile Q3 revenue")).toMatchObject({ kind: "command", requiresModel: true, mutating: true });
    expect(classifyIntakeMessage("wait for Priya")).toMatchObject({ kind: "wait", requiresModel: false, mutating: false });
    expect(classifyIntakeMessage("cancel the current run")).toMatchObject({ kind: "cancel", requiresModel: false, mutating: true });
    expect(classifyIntakeMessage("urgent make this high priority")).toMatchObject({ kind: "priority_change", priority: "high" });
    expect(classifyIntakeMessage("note: CFO asked for evidence")).toMatchObject({ kind: "note", goal: "CFO asked for evidence" });
    expect(classifyIntakeMessage("split this into parallel subagents")).toMatchObject({ kind: "parallel_subagent" });
  });

  it("expands affected sets through formula, chart, and memo dependencies before scheduling", () => {
    const decision = classifyIntakeMessage("/ask update C2");
    const preview = buildPlanPreview({
      decision,
      targetArtifacts: ["q3"],
      intendedReadSet: ["A2", "B2"],
      intendedWriteSet: ["C2"],
      formulaDependencies: { C2: ["D2"], D2: ["E2"] },
      chartDependencies: { E2: ["chart:variance"] },
      memoDependencies: { "chart:variance": ["memo:board-pack"] },
      estimatedCostUsd: 0.02,
      authorizedCostUsd: 0.05,
    });

    expect(preview.expandedAffectedSet).toEqual(["C2", "D2", "E2", "chart:variance", "memo:board-pack", "A2", "B2"]);
    expect(preview.conflicts).toEqual([]);
    expect(preview.scheduling).toBe("run_now");
  });

  it("drafts instead of running through active human edits, agent claims, and pending proposals", () => {
    const preview = buildPlanPreview({
      decision: classifyIntakeMessage("/ask update C2"),
      targetArtifacts: ["q3"],
      intendedWriteSet: ["C2"],
      formulaDependencies: { C2: ["D2"] },
      activeHumanEdits: ["D2"],
      activeAgentClaims: ["C2"],
      pendingProposals: ["C2"],
      estimatedCostUsd: 0.01,
      authorizedCostUsd: 0.05,
    });

    expect(preview.conflicts.map((c) => c.kind)).toEqual(["human_edit", "agent_claim", "pending_proposal"]);
    expect(preview.scheduling).toBe("draft_first");
  });

  it("blocks private-source leakage and formula scalar overwrites before the model spends tokens", () => {
    const preview = buildPlanPreview({
      decision: classifyIntakeMessage("/ask write the final margin"),
      targetArtifacts: ["model"],
      intendedWriteSet: ["F42"],
      privateRefs: [{ artifactId: "private-memo", visibility: "private" }],
      formulaCells: ["F42"],
      estimatedCostUsd: 0.01,
      authorizedCostUsd: 0.05,
    });

    expect(preview.conflicts.map((c) => c.kind)).toEqual(["privacy", "formula"]);
    expect(preview.scheduling).toBe("blocked");
  });

  it("requests authorization when projected cost exceeds the preflight budget", () => {
    const preview = buildPlanPreview({
      decision: classifyIntakeMessage("/ask build the full workbook"),
      targetArtifacts: ["model"],
      intendedWriteSet: ["C10"],
      estimatedCostUsd: 0.15,
      authorizedCostUsd: 0.05,
    });

    expect(preview.conflicts).toMatchObject([{ kind: "budget", ref: "cost" }]);
    expect(preview.scheduling).toBe("request_authorization");
  });
});
