import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REQUIRED_TOC = ["Overview", "Files", "Agents", "Workflows", "Rules", "Backend", "Recent trace"];

describe("self-updating wiki contract", () => {
  it("keeps the fixed table of contents and artifact-link contract documented", () => {
    const wiki = readFileSync("docs/AGENT_WIKI.md", "utf8");
    const skill = readFileSync("docs/skills/self-updating-wiki/SKILL.md", "utf8");

    for (const heading of REQUIRED_TOC) {
      expect(wiki).toContain(heading);
      expect(skill).toContain(heading);
    }
    expect(skill).toContain("noderoom-artifact:<artifact-id>");
    expect(skill).toContain("Confirm every file link resolves to an existing artifact id");
  });

  it("forbids private leakage and unsupported wiki claims", () => {
    const text = `${readFileSync("docs/AGENT_WIKI.md", "utf8")}\n${readFileSync("docs/skills/self-updating-wiki/SKILL.md", "utf8")}`;

    expect(text).toContain("Private chat content remains private until promoted");
    expect(text).toContain("Do not use private chat");
    expect(text).toContain("unknown");
  });
});
