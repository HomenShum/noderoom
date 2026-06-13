import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentWorkspaceSandboxProbe } from "../src/eval/agentWorkspaceSandbox";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agent workspace process sandbox", () => {
  it("allows agent workspace reads and blocks evaluator-only reads in a subprocess", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-agent-sandbox-"));
    roots.push(root);
    const agentRoot = join(root, "agent-workspace");
    const evaluatorRoot = join(root, "evaluator");
    mkdirSync(agentRoot, { recursive: true });
    mkdirSync(evaluatorRoot, { recursive: true });
    const agentFile = join(agentRoot, "task.json");
    const evaluatorFile = join(evaluatorRoot, "gold.json");
    writeFileSync(agentFile, JSON.stringify({ taskId: "safe-agent-task" }));
    writeFileSync(evaluatorFile, JSON.stringify({ golden: "must-not-read" }));

    const probe = runAgentWorkspaceSandboxProbe({
      allowedReadRoot: agentRoot,
      allowedReadFile: agentFile,
      deniedReadFile: evaluatorFile,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(probe).toMatchObject({
      schema: 1,
      verifier: "node_permission_process",
      pass: true,
      checks: {
        allowedRead: { ok: true },
        deniedRead: { ok: true },
      },
    });
    expect(probe.checks.allowedRead.stdoutPreview).toContain("safe-agent-task");
    expect(probe.checks.deniedRead.stdoutPreview).not.toContain("must-not-read");
    expect(probe.checks.deniedRead.stderrPreview).toMatch(/permission|access|denied|ERR_ACCESS_DENIED/i);
    expect(probe.warnings[0]).toContain("not Docker");
  });
});
