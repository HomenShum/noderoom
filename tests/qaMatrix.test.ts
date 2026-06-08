import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Feature = {
  id: string;
  area: string;
  claim: string;
  status: string;
  productionGate: string;
  deterministicChecks: string[];
  liveChecks: string[];
  evidence: Array<{ type: string; ref: string }>;
  nextReview: string;
};
type Matrix = {
  features: Feature[];
  modelLadder: {
    source: string;
    routes: Array<{ modelRoute: string; provider: string; l1: string; l2: string; l3: string; l4: string }>;
  };
};

const root = process.cwd();
const matrix = JSON.parse(readFileSync(join(root, "docs/qa/production-matrix.json"), "utf8")) as Matrix;

describe("production QA matrix", () => {
  it("is appendable, evidence-backed, and status-normalized", () => {
    const ids = new Set<string>();
    const allowedStatuses = new Set(["green", "yellow", "red"]);

    for (const feature of matrix.features) {
      expect(feature.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(feature.id), `${feature.id} is duplicated`).toBe(false);
      ids.add(feature.id);

      expect(feature.area).toBeTruthy();
      expect(feature.claim).toBeTruthy();
      expect(allowedStatuses.has(feature.status), `${feature.id} has invalid status`).toBe(true);
      expect(feature.productionGate).toBeTruthy();
      expect(feature.deterministicChecks.length, `${feature.id} needs deterministic checks`).toBeGreaterThan(0);
      expect(feature.liveChecks.length, `${feature.id} needs live check policy, even if not applicable`).toBeGreaterThan(0);
      expect(feature.evidence.length, `${feature.id} needs evidence refs`).toBeGreaterThan(0);
      expect(feature.nextReview).toBeTruthy();

      for (const evidence of feature.evidence) {
        expect(existsSync(join(root, evidence.ref)), `${feature.id} evidence missing: ${evidence.ref}`).toBe(true);
      }
    }
  });

  it("keeps the live model ladder gate explicit", () => {
    expect(existsSync(join(root, matrix.modelLadder.source))).toBe(true);
    const statuses = new Set(["PASS", "FAIL", "TIMEOUT", "SKIP"]);

    for (const route of matrix.modelLadder.routes) {
      expect(route.modelRoute).toBeTruthy();
      expect(route.provider).toBeTruthy();
      for (const rung of [route.l1, route.l2, route.l3, route.l4]) {
        expect(statuses.has(rung), `${route.modelRoute} has invalid rung status ${rung}`).toBe(true);
      }
    }
  });

  it("publishes the generated QA cockpit from README", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain("docs/qa/production-matrix.json");
    expect(readme).toContain("docs/eval/qa-coverage.svg");
    expect(readme).toContain("docs/eval/model-ladder-matrix.svg");
    expect(readme).toContain("docs/PRODUCTION_GUARANTEE_MATRIX.md");
  });
});
