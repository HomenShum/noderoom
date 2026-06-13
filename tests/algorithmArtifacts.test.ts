import { describe, expect, it } from "vitest";
import {
  runAlgorithmArtifact,
  type AlgorithmArtifact,
  type AlgorithmArtifactResult,
} from "../src/agent/algorithmArtifacts";
import { InMemoryRoomTools } from "../src/agent/roomTools";
import { PRODUCTION_ROOM_TOOLS } from "../src/agent/tools";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import type { CellPayload } from "../src/engine/types";

const revenueVarianceArtifact: AlgorithmArtifact = {
  schema: 1,
  algorithmId: "revenue_variance_pct_v1",
  name: "Revenue variance percent",
  kind: "spreadsheet_formula",
  language: "formula_dsl",
  inputs: [
    { id: "q2", elementId: "r_rev__q2", label: "Q2 revenue" },
    { id: "q3", elementId: "r_rev__q3", label: "Q3 revenue" },
  ],
  outputs: [
    { id: "variancePct", elementId: "r_rev__variance", expression: "(q3 - q2) / q2", format: "percent" },
  ],
  constraints: {
    deterministic: true,
    noNetwork: true,
    noRandom: true,
    noDateNow: true,
    maxInputs: 4,
    maxOutputs: 2,
  },
  evidencePolicy: { requireSourceCells: true },
  tests: [
    { name: "demo revenue variance", inputs: { q2: 10000, q3: 12400 }, expected: { variancePct: 0.24 } },
  ],
};

describe("Algorithm artifacts", () => {
  it("turns a formula artifact into an evidence-bearing patch bundle without committing", () => {
    const result = runAlgorithmArtifact(revenueVarianceArtifact, {
      "r_rev__q2": { id: "r_rev__q2", value: "$10,000", version: 1 },
      "r_rev__q3": { id: "r_rev__q3", value: "$12,400", version: 1 },
      "r_rev__variance": { id: "r_rev__variance", value: "", version: 1 },
    });

    expect(result.ok).toBe(true);
    const bundle = expectBundle(result);
    expect(bundle.commitPolicy).toBe("patch_bundle_only_runtime_must_cas");
    expect(bundle.proof.runnerVersion).toBe("algorithm-artifact-runner:v1");
    expect(bundle.proof.testsPassed).toBe(1);
    expect(bundle.patches).toHaveLength(1);
    expect(bundle.patches[0]).toMatchObject({
      elementId: "r_rev__variance",
      baseVersion: 1,
      kind: "set",
      value: {
        value: "+24.0%",
        status: "complete",
        normalizedValue: 0.24,
        formula: "(q3 - q2) / q2",
      },
    });
    expect(bundle.patches[0].value.evidence?.map((item) => item.kind)).toEqual(["computed", "source", "source"]);
    expect(bundle.writeLockedCellResultsArgs.ops[0]).toMatchObject({
      elementId: "r_rev__variance",
      baseVersion: 1,
      value: "+24.0%",
      formula: "(q3 - q2) / q2",
      kind: "set",
    });
  });

  it("reruns from a changed snapshot without another model plan", () => {
    const first = expectBundle(runAlgorithmArtifact(revenueVarianceArtifact, {
      "r_rev__q2": { id: "r_rev__q2", value: "$10,000", version: 1 },
      "r_rev__q3": { id: "r_rev__q3", value: "$12,400", version: 1 },
      "r_rev__variance": { id: "r_rev__variance", value: "", version: 1 },
    }));
    const second = expectBundle(runAlgorithmArtifact(revenueVarianceArtifact, {
      "r_rev__q2": { id: "r_rev__q2", value: "$10,000", version: 2 },
      "r_rev__q3": { id: "r_rev__q3", value: "$13,000", version: 2 },
      "r_rev__variance": { id: "r_rev__variance", value: "", version: 3 },
    }));

    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.patches[0].value.value).toBe("+24.0%");
    expect(second.patches[0].value.value).toBe("+30.0%");
    expect(second.patches[0].baseVersion).toBe(3);
  });

  it("runs through the production tool lane and then commits through managed CAS writes", async () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
    const runTool = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "run_algorithm_artifact")!;
    const writeTool = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;

    const run = await runTool.execute({ artifact: revenueVarianceArtifact }, rt) as AlgorithmArtifactResult;
    const bundle = expectBundle(run);
    const before = await rt.readRange(["r_rev__variance"]);
    expect(before[0].value).toBe("");

    const written = await writeTool.execute(bundle.writeLockedCellResultsArgs, rt) as { ok?: boolean };
    expect(written.ok).toBe(true);

    const after = await rt.readRange(["r_rev__variance"]);
    const payload = after[0].value as CellPayload;
    expect(payload.value).toBe("+24.0%");
    expect(payload.formula).toBe("(q3 - q2) / q2");
    expect(payload.evidence?.length).toBe(3);
  });

  it("rejects unknown identifiers and non-deterministic constraints before reading cells", () => {
    const unknown = runAlgorithmArtifact({
      ...revenueVarianceArtifact,
      outputs: [{ id: "variancePct", elementId: "r_rev__variance", expression: "(q4 - q2) / q2" }],
    }, {});
    expect(unknown.ok).toBe(false);
    expect((unknown as { errors: string[] }).errors.join("\n")).toContain("unknown identifier q4");

    const nondeterministic = runAlgorithmArtifact({
      ...revenueVarianceArtifact,
      constraints: { ...revenueVarianceArtifact.constraints, noRandom: false },
    }, {});
    expect(nondeterministic.ok).toBe(false);
    expect((nondeterministic as { errors: string[] }).errors.join("\n")).toContain("noRandom must not be false");
  });
});

function expectBundle(result: AlgorithmArtifactResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.bundle;
}
