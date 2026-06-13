import { describe, expect, it } from "vitest";
import {
  buildHaloSelfImprovementReport,
  metricFromAgentResult,
  pathFingerprint,
  summarizeSelfImprovementCase,
} from "../src/eval/haloSelfImprovement";
import type { AgentResult } from "../src/agent/types";

describe("HALO self-improvement metrics", () => {
  it("fingerprints the tool path without compaction noise", () => {
    expect(pathFingerprint([
      { step: 0, tool: "read_range", args: {}, result: {}, ms: 1 },
      { step: 0, tool: "compaction", args: { elided: 1 }, result: { before: 1000, after: 100 }, ms: 0 },
      { step: 1, tool: "write_locked_cells", args: {}, result: { ok: true }, ms: 1 },
    ])).toBe("read_range -> write_locked_cells");
  });

  it("extracts context quality metrics and tool-result pairing from an AgentResult", () => {
    const result = agentResult({
      traceTools: ["read_range", "compaction", "write_locked_cells"],
      messages: [
        { role: "user", content: "task" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", tool: "read_range", args: {} }] },
        { role: "tool", toolCallId: "c1", toolName: "read_range", content: "x".repeat(2000) },
        { role: "assistant", content: "", toolCalls: [{ id: "c2", tool: "write_locked_cells", args: {} }] },
        { role: "tool", toolCallId: "c2", toolName: "write_locked_cells", content: "{\"ok\":true}" },
      ],
    });

    const metric = metricFromAgentResult({ caseId: "case", runIndex: 0, modelName: "scripted", result });

    expect(metric.fingerprint).toBe("read_range -> write_locked_cells");
    expect(metric.compactionEvents).toBe(1);
    expect(metric.compactionCharsSaved).toBe(900);
    expect(metric.compactionElidedToolResults).toBe(2);
    expect(metric.missingToolResults).toBe(0);
    expect(metric.writeCalls).toBe(1);
  });

  it("marks deterministic N=5 as stable and emits implemented proposals", () => {
    const metrics = Array.from({ length: 5 }, (_, runIndex) => ({
      ...baseMetric,
      caseId: "managed-write-n5",
      runIndex,
      fingerprint: "read_range -> write_locked_cells",
      compactionEvents: runIndex === 0 ? 1 : 0,
      compactionCharsSaved: runIndex === 0 ? 100 : 0,
    }));

    const summary = summarizeSelfImprovementCase("managed-write-n5", metrics);
    const report = buildHaloSelfImprovementReport({ generatedAt: "2026-06-13T00:00:00.000Z", metrics });

    expect(summary.pass).toBe(true);
    expect(summary.uniqueFingerprintCount).toBe(1);
    expect(report.summary.pass).toBe(true);
    expect(report.summary.contextCasesWithCompaction).toEqual(["managed-write-n5"]);
    expect(report.proposals.map((proposal) => proposal.id)).toEqual(expect.arrayContaining([
      "halo-path-stability-gate-v1",
      "halo-context-quality-gate-v1",
      "halo-variant-selection-v1",
    ]));
  });

  it("flags path drift as a failed case", () => {
    const metrics = [
      { ...baseMetric, runIndex: 0, fingerprint: "read_range -> write_locked_cells" },
      { ...baseMetric, runIndex: 1, fingerprint: "read_range -> read_range -> write_locked_cells" },
    ];

    const report = buildHaloSelfImprovementReport({ metrics });

    expect(report.summary.pass).toBe(false);
    expect(report.summary.unstableCases).toEqual(["case"]);
    expect(report.cases[0].notes).toContain("tool path drifted across repeated runs");
  });
});

const baseMetric = {
  caseId: "case",
  runIndex: 0,
  modelName: "scripted",
  stopReason: "done" as const,
  exhausted: false,
  modelCalls: 2,
  toolCalls: 2,
  readCalls: 1,
  writeCalls: 1,
  modelVisibleCoordinationCalls: 0,
  invalidToolCalls: 0,
  compactionEvents: 0,
  compactionCharsSaved: 0,
  compactionElidedToolResults: 0,
  finalMessageChars: 100,
  missingToolResults: 0,
  fingerprint: "read_range -> write_locked_cells",
  traceTools: ["read_range", "write_locked_cells"],
};

function agentResult(args: {
  traceTools: string[];
  messages: AgentResult["messages"];
}): AgentResult {
  return {
    finalText: "done",
    steps: 2,
    exhausted: false,
    stopReason: "done",
    budget: {
      startedAt: 0,
      now: 1,
      reserveMs: 0,
      elapsedMs: 1,
      maxSteps: 4,
      attemptedSteps: 2,
    },
    trace: args.traceTools.map((tool, step) => ({
      step,
      tool,
      args: tool === "compaction" ? { elided: 2 } : {},
      result: tool === "compaction" ? { before: 1000, after: 100 } : { ok: true },
      ms: tool === "compaction" ? 0 : 1,
    })),
    messages: args.messages,
    usage: { inputTokens: 10, outputTokens: 5, modelCalls: 2 },
  };
}
