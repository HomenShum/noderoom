import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBankerToolBenchManifestLock } from "../src/eval/bankerToolBenchManifestLock";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench manifest lock", () => {
  it("hashes tasks, task-data, and evaluator golden outputs with stable sections", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-btb-lock-"));
    roots.push(root);
    const taskId = "task-1";
    mkdirSync(join(root, "task-data", taskId, "Inputs"), { recursive: true });
    mkdirSync(join(root, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(root, "tasks.jsonl"), `${JSON.stringify({ task_id: taskId, final_prompt: "Do work" })}\n`);
    writeFileSync(join(root, "task-data", taskId, "Inputs", "model.xlsx"), "input workbook");
    writeFileSync(join(root, "golden-outputs", taskId, "answer.xlsx"), "gold workbook");

    const lock = buildBankerToolBenchManifestLock(root, {
      generatedAt: "2026-06-13T00:00:00.000Z",
      datasetRevision: "fixture-rev",
    });

    expect(lock).toMatchObject({
      schema: 1,
      verifier: "bankertoolbench_manifest_lock",
      datasetRevision: "fixture-rev",
      fileCount: 3,
      sectionCounts: {
        tasks_jsonl: 1,
        task_data: 1,
        golden_outputs: 1,
        other: 0,
      },
      warnings: [],
    });
    expect(lock.aggregateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.files.map((file) => file.path)).toEqual([
      "golden-outputs/task-1/answer.xlsx",
      "task-data/task-1/Inputs/model.xlsx",
      "tasks.jsonl",
    ]);
    expect(lock.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.bytes > 0)).toBe(true);
  });

  it("warns when used without an official dataset revision", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-btb-lock-"));
    roots.push(root);
    writeFileSync(join(root, "tasks.jsonl"), "{}\n");

    const lock = buildBankerToolBenchManifestLock(root);

    expect(lock.warnings.join(" ")).toContain("dataset revision is not recorded");
    expect(lock.warnings.join(" ")).toContain("no task-data files found");
    expect(lock.warnings.join(" ")).toContain("no golden-outputs files found");
  });
});
