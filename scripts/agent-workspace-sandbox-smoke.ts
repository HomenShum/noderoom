import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runAgentWorkspaceSandboxProbe } from "../src/eval/agentWorkspaceSandbox";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out");
const keepFixture = args.includes("--keep-fixture");
const generatedAt = new Date().toISOString();
const root = resolve(".tmp", "agent-workspace-sandbox-smoke-fixture");

try {
  rmSync(root, { recursive: true, force: true });
  const agentRoot = join(root, "agent-workspace");
  const evaluatorRoot = join(root, "evaluator");
  mkdirSync(agentRoot, { recursive: true });
  mkdirSync(evaluatorRoot, { recursive: true });
  const agentFile = join(agentRoot, "task.json");
  const evaluatorFile = join(evaluatorRoot, "gold.json");
  writeFileSync(agentFile, `${JSON.stringify({ taskId: "sandbox-smoke", visible: true }, null, 2)}\n`);
  writeFileSync(evaluatorFile, `${JSON.stringify({ golden: "blocked-evaluator-only" }, null, 2)}\n`);

  const probe = runAgentWorkspaceSandboxProbe({
    allowedReadRoot: agentRoot,
    allowedReadFile: agentFile,
    deniedReadFile: evaluatorFile,
    generatedAt,
  });
  const report = {
    schema: 1,
    generatedAt,
    mode: "fixture",
    verifier: probe.verifier,
    fixtureRoot: keepFixture ? root : undefined,
    probe,
  };
  writeReport(report);
  if (!probe.pass) process.exit(1);
} finally {
  if (!keepFixture) rmSync(root, { recursive: true, force: true });
}

function writeReport(report: unknown) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (jsonOut) {
    const outPath = resolve(jsonOut);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content);
    console.log(`wrote ${rel(outPath)}`);
  } else {
    process.stdout.write(content);
  }
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
