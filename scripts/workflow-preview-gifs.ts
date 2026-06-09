import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type WorkflowPreview = {
  id: string;
  title: string;
  userWorkflow: string;
  frames: string[];
  evidence: string[];
  evalGate: string[];
  research: string[];
};

const root = process.cwd();
const outDir = join(root, "docs", "eval", "workflow-previews");

const previews: WorkflowPreview[] = [
  {
    id: "ask-spreadsheet-cas",
    title: "Public /ask spreadsheet reconciliation",
    userWorkflow: "A user asks the Room NodeAgent to reconcile Q3 variance cells; the agent locks exact cells, reads versions, writes with CAS, releases, and leaves trace rows.",
    frames: [
      "docs/screenshots/qa-real-llm-ask.png",
      "docs/eval/ui-recordings/live-spreadsheet-20260608.png",
      "docs/screenshots/live-room-after-agent.png",
      "docs/screenshots/ui-trace-lifecycle.png",
    ],
    evidence: [
      "docs/eval/halo-runs/20260609T060208Z/summary.jsonl",
      "docs/eval/halo-runs/20260609T060208Z/logs/cycle-001-free-job-smoke.log",
      "docs/eval/agent-improvement-loop.md",
    ],
    evalGate: ["evals/ladder.ts", "tests/agentRuntime.test.ts", "tests/agentJobsRuntime.test.ts"],
    research: ["Convex functions", "OpenAI trace grading", "Braintrust traces"],
  },
  {
    id: "research-enrichment",
    title: "GTM research enrichment",
    userWorkflow: "A user runs source-backed company research over pending/stale rows; the agent preserves CRM fields, fills evidence-bearing payloads, and marks freshness.",
    frames: [
      "docs/screenshots/live-research-before.png",
      "docs/eval/ui-recordings/live-research-20260608.png",
      "docs/screenshots/live-research-after.png",
      "docs/screenshots/live-research-sources-freshness.png",
      "docs/screenshots/live-research-requeue.png",
    ],
    evidence: [
      "docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md",
      "evals/professionalWorkflows.ts",
      "docs/PROFESSIONAL_SPREADSHEET_WORKFLOWS.md",
    ],
    evalGate: ["tests/workflowEvals.test.ts", "tests/providerParserAdapter.test.ts", "scripts/provider-parser-smoke.ts"],
    research: ["LangSmith evaluation concepts", "Braintrust systematic evaluation", "OpenAI agent evals"],
  },
  {
    id: "wiki-note-grounding",
    title: "Grounded wiki and note update",
    userWorkflow: "A user asks for a note/wiki summary; the NodeAgent discovers room artifacts, reads the source sheet, writes a grounded note with citations, and respects private/public boundaries.",
    frames: [
      "docs/eval/ui-recordings/live-note-20260608.png",
      "docs/screenshots/lib-note.png",
      "docs/screenshots/qa-telemetry.png",
    ],
    evidence: ["docs/AGENT_WIKI.md", "docs/skills/self-updating-wiki/SKILL.md", "tests/wikiSkill.test.ts"],
    evalGate: ["tests/workflowEvals.test.ts", "tests/wikiSkill.test.ts", "src/agent/tools.ts"],
    research: ["OpenAI trace grading", "LangSmith online/offline eval lifecycle"],
  },
  {
    id: "proposals-wall-review",
    title: "Proposal review and wall collaboration",
    userWorkflow: "With Auto-allow off, agent edits become host-reviewed proposals; wall edits and approvals remain versioned room artifacts, not invisible local state.",
    frames: [
      "docs/screenshots/live-proposals-review.png",
      "docs/screenshots/live-proposals-buttons.png",
      "docs/eval/ui-recordings/live-wall-20260608.png",
      "docs/screenshots/lib-wall.png",
    ],
    evidence: ["docs/WALKTHROUGH.md", "docs/PRODUCTION_GUARANTEE_MATRIX.md", "tests/roomEngine.test.ts"],
    evalGate: ["tests/roomEngine.test.ts", "tests/lockTtl.test.ts", "e2e/chat.spec.ts"],
    research: ["Convex queries/mutations/actions", "Braintrust trace anatomy"],
  },
  {
    id: "free-job-halo",
    title: "Long-running /free job and HALO handoff",
    userWorkflow: "A user starts a slow free-auto job; NodeRoom shows job state, attempts, receipts, and traces while HALO records regressions and handoff evidence.",
    frames: [
      "docs/screenshots/qa-room.png",
      "docs/screenshots/qa-ask-flow.png",
      "docs/screenshots/qa-telemetry.png",
    ],
    evidence: [
      "docs/eval/HALO_OVERNIGHT_RUN.md",
      "docs/eval/halo-runs/20260609T060208Z/status.json",
      "docs/eval/halo-runs/20260609T060208Z/summary.jsonl",
    ],
    evalGate: ["scripts/halo-overnight.ts", "evals/evalStore.ts", "evals/evalDiff.ts", "tests/evalStore.test.ts"],
    research: ["OpenAI Cookbook agent improvement loop", "Convex scheduled functions", "Braintrust CI evals"],
  },
];

mkdirSync(outDir, { recursive: true });

for (const preview of previews) {
  const missing = preview.frames.filter((frame) => !existsSync(join(root, frame)));
  if (missing.length > 0) throw new Error(`${preview.id} is missing frame(s): ${missing.join(", ")}`);
  renderGif(preview);
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  generator: "scripts/workflow-preview-gifs.ts",
  previews: previews.map((preview) => ({
    ...preview,
    gif: `docs/eval/workflow-previews/${preview.id}.gif`,
  })),
}, null, 2) + "\n", "utf8");

console.log(`wrote ${previews.length} workflow GIF previews to ${outDir}`);

function renderGif(preview: WorkflowPreview) {
  const output = join(outDir, `${preview.id}.gif`);
  const args = preview.frames.flatMap((frame) => [
    join(root, frame),
    "-resize",
    "960x540",
    "-background",
    "#f4efe8",
    "-gravity",
    "center",
    "-extent",
    "960x540",
    "-set",
    "delay",
    "120",
  ]);
  args.push("-loop", "0", output);
  const result = spawnSync("magick", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error([`magick failed for ${preview.id}`, result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
}
