import { describe, expect, it } from "vitest";
import { missingMentionedPaths, parseNameStatus, renderChangeList } from "../scripts/commit-message";

describe("commit message accuracy helpers", () => {
  it("parses added, modified, deleted, and renamed files from git name-status output", () => {
    expect(parseNameStatus("M\tREADME.md\nA\tdocs/X.md\nD\told.txt\nR100\told.ts\tnew.ts\n")).toEqual([
      { status: "M", path: "README.md" },
      { status: "A", path: "docs/X.md" },
      { status: "D", path: "old.txt" },
      { status: "R100", oldPath: "old.ts", path: "new.ts" },
    ]);
  });

  it("renders a commit-body checklist with exact file paths", () => {
    const out = renderChangeList([{ status: "M", path: "scripts/commit-message.ts" }]);
    expect(out).toContain("Change list:");
    expect(out).toContain("M scripts/commit-message.ts");
  });

  it("flags changed paths missing from the commit body", () => {
    const changes = [
      { status: "M", path: "docs/COMMIT_ACCURACY.md" },
      { status: "M", path: "package.json" },
    ];
    expect(missingMentionedPaths("Updated docs/COMMIT_ACCURACY.md", changes)).toEqual([{ status: "M", path: "package.json" }]);
  });
});
