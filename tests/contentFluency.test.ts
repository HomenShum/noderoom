import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("audience fluency content contract", () => {
  it("has a reusable skill, audience context, and private-investment brief", () => {
    for (const rel of [
      "docs/skills/audience-fluency/SKILL.md",
      "episodes/_audiences/README.md",
      "episodes/_audiences/family-office.yaml",
      "episodes/private-investment-room-v1/brief.md",
    ]) {
      expect(existsSync(join(root, rel)), `${rel} is missing`).toBe(true);
    }
  });

  it("keeps audience fluency in the generated production matrix as a yellow proof lane", () => {
    const matrix = JSON.parse(readFileSync(join(root, "docs/qa/production-matrix.json"), "utf8")) as {
      features: Array<{ id: string; status: string; deterministicChecks: string[]; liveChecks: string[]; evidence: Array<{ ref: string }> }>;
    };
    const row = matrix.features.find((feature) => feature.id === "audience_fluency_content");

    expect(row).toBeTruthy();
    expect(row!.status).toBe("yellow");
    expect(row!.deterministicChecks).toContain("npm run content:fluency:check");
    expect(row!.liveChecks.some((check) => check.startsWith("missing:"))).toBe(true);
    expect(row!.evidence.map((e) => e.ref)).toContain("docs/skills/audience-fluency/SKILL.md");
  });

  it("passes the deterministic content fluency checker", () => {
    const output = execFileSync(process.execPath, ["--import", "./node_modules/tsx/dist/loader.mjs", "scripts/content-fluency-check.ts"], { cwd: root, encoding: "utf8" });
    expect(output).toContain("content fluency check passed");
  });
});
