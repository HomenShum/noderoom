import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildBankerToolBenchManifestLock } from "../src/eval/bankerToolBenchManifestLock";

const args = process.argv.slice(2);
const root = optionValue("--root");
const jsonOut = optionValue("--json-out") ?? "docs/eval/bankertoolbench-manifest-lock-smoke.json";

if (!root) {
  console.error([
    "Usage:",
    "  npm run benchmark:bankertoolbench:manifest-lock -- --root <btb-data-root> [--dataset-revision <rev>] [--json-out <path>]",
    "",
    "Hashes tasks.jsonl, task-data/**, and golden-outputs/** into a provenance lockfile.",
  ].join("\n"));
  process.exit(2);
}

const report = buildBankerToolBenchManifestLock(root, {
  generatedAt: new Date().toISOString(),
  datasetRevision: optionValue("--dataset-revision") ?? process.env.BTB_DATASET_REVISION,
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${jsonOut}`);
console.log(`BankerToolBench manifest lock: ${report.fileCount} file(s), aggregate=${report.aggregateSha256}`);

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}
