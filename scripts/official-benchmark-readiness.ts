import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { officialBenchmarkReadiness, officialBenchmarkSummary } from "../src/eval/officialBenchmarkReadiness";

const root = new URL("../", import.meta.url);
const strict = process.argv.includes("--strict");
const jsonOnly = process.argv.includes("--json");
const outJson = new URL("docs/eval/official-benchmark-readiness.json", root);
const outMd = new URL("docs/eval/OFFICIAL_BENCHMARK_READINESS.md", root);

const readiness = officialBenchmarkReadiness();
const summary = officialBenchmarkSummary(readiness);
const generatedAt = new Date().toISOString();
const report = {
  schema: 1,
  generatedAt,
  summary,
  readiness,
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  write(outJson, `${JSON.stringify(report, null, 2)}\n`);
  write(outMd, renderMarkdown());
  console.log(`wrote ${rel(outJson)}`);
  console.log(`wrote ${rel(outMd)}`);
  console.log(`official benchmark readiness: ${summary.ready}/${summary.total} ready`);
}

if (strict && summary.blocked > 0) process.exitCode = 1;

function renderMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Official Benchmark Readiness");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("This is the benchmark-faithful gate for the public targets we care about most: BankerToolBench and SpreadsheetBench. It is deliberately stricter than NodeRoom's internal professional evals. Internal green runs do not imply an official benchmark claim.");
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push("- BankerToolBench paper: https://arxiv.org/abs/2604.11304");
  lines.push("- BankerToolBench repo: https://github.com/Handshake-AI-Research/bankertoolbench");
  lines.push("- SpreadsheetBench repo: https://github.com/RUCKBReasoning/SpreadsheetBench");
  lines.push("- SpreadsheetBench site: https://spreadsheetbench.github.io/");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Ready official benchmarks: ${summary.ready}/${summary.total}`);
  lines.push(`- Blocked official benchmarks: ${summary.blocked}/${summary.total}`);
  lines.push(`- Missing/partial capabilities: ${summary.missingCapabilities.map((item) => `\`${item}\``).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Benchmark Contracts");
  lines.push("");
  for (const item of readiness) {
    lines.push(`### ${item.name}`);
    lines.push("");
    lines.push(`Status: ${item.ready ? "ready" : "blocked"}`);
    lines.push("");
    lines.push(`Task shape: ${item.taskShape}`);
    lines.push("");
    lines.push(`Scoring shape: ${item.scoringShape}`);
    lines.push("");
    lines.push("| Capability | State | Evidence / blocker |");
    lines.push("|---|---|---|");
    for (const cap of item.capabilities) {
      lines.push(`| \`${cap.capability}\` | ${cap.state} | ${cap.evidence ? `\`${cap.evidence}\`` : cap.blocker ?? ""} |`);
    }
    lines.push("");
    if (item.blockers.length) {
      lines.push("Blockers:");
      for (const blocker of item.blockers) lines.push(`- ${blocker}`);
      lines.push("");
    }
  }
  lines.push("## Promotion Rule");
  lines.push("");
  lines.push("A README or interview claim may say NodeRoom is *benchmark-ready* only after `npm run benchmark:official:readiness -- --strict` passes and at least one benchmark-specific official adapter has produced a recorded run artifact with model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables.");
  lines.push("");
  lines.push("Until then, use the current wording: NodeRoom has internal professional-workflow evals and a benchmark-faithful readiness gate, but official BankerToolBench/SpreadsheetBench runs are blocked by the missing adapters listed above.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function write(url: URL, content: string) {
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, content);
}

function rel(url: URL) {
  return relative(process.cwd(), fileURLToPath(url)).replace(/\\/g, "/");
}
