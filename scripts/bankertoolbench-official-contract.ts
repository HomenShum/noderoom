import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildBankerToolBenchOfficialContract } from "../src/eval/bankerToolBenchOfficialContract";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOut = optionValue("--json-out") ?? "docs/eval/bankertoolbench-official-contract.json";

const report = buildBankerToolBenchOfficialContract({
  generatedAt: new Date().toISOString(),
  datasetRevision: optionValue("--dataset-revision") ?? process.env.BTB_DATASET_REVISION,
  manifestLockfile: optionValue("--manifest-lockfile") ?? process.env.BTB_MANIFEST_LOCKFILE,
  adaptedToolNames: listOption("--adapted-tool"),
  dockerIsolationProven: args.includes("--docker-isolation-proven"),
  gandalfImported: args.includes("--gandalf-imported"),
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${jsonOut}`);
console.log(`BankerToolBench official contract: ${report.status} (${report.blockers.length} blocker(s))`);

if (strict && !report.pass) process.exitCode = 1;

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function listOption(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
    else if (args[index].startsWith(`${name}=`)) values.push(args[index].slice(name.length + 1));
  }
  return values.flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
}
