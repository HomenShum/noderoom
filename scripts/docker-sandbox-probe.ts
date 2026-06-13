import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runDockerSandboxProbe } from "../src/eval/dockerSandboxProbe";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out");
const image = optionValue("--image");
const requirePass = args.includes("--require-pass");

const report = runDockerSandboxProbe({
  image,
  generatedAt: new Date().toISOString(),
});

const content = `${JSON.stringify(report, null, 2)}\n`;
if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`wrote ${rel(outPath)}`);
} else {
  process.stdout.write(content);
}

if (requirePass && !report.pass) process.exitCode = 1;

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
