import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type WorkflowPreview = {
  id: string;
  title: string;
  userWorkflow: string;
  size?: string;
  crop?: string;
  delay?: string;
  frames: PreviewFrame[];
  evidence: string[];
  evalGate: string[];
  research: string[];
};

type PreviewFrame = string | {
  frame: string;
  delay?: string;
  crop?: string;
  callout?: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    labelX?: number;
    labelY?: number;
    pointSize?: number;
  };
};

const root = process.cwd();
const outDir = join(root, "docs", "eval", "workflow-previews");

const previews: WorkflowPreview[] = [
  {
    id: "ask-spreadsheet-cas",
    title: "Public /ask spreadsheet reconciliation",
    userWorkflow: "A user asks the Room NodeAgent to reconcile Q3 variance cells; the agent locks exact cells, reads versions, writes with CAS, releases, and leaves trace rows.",
    size: "960x720",
    crop: "1080x810+220+50",
    delay: "170",
    frames: [
      "docs/screenshots/qa-real-llm-ask.png",
      {
        frame: "docs/screenshots/live-room-after-agent.png",
        delay: "280",
      },
      {
        frame: "docs/screenshots/ui-trace-lifecycle.png",
        delay: "380",
      },
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
    delay: "170",
    frames: [
      "docs/screenshots/live-research-before.png",
      {
        frame: "docs/screenshots/live-research-before.png",
        delay: "280",
        callout: {
          text: "Research in progress",
          x: 525,
          y: 132,
          width: 150,
          height: 44,
          labelX: 438,
          labelY: 106,
          pointSize: 24,
        },
      },
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
    size: "960x720",
    crop: "1080x810+220+50",
    delay: "185",
    frames: [
      "docs/screenshots/lib-note.png",
      {
        frame: "docs/screenshots/lib-note.png",
        delay: "260",
        callout: {
          text: "Open Spreadsheet next",
          x: 238,
          y: 0,
          width: 104,
          height: 34,
          labelX: 260,
          labelY: 260,
          pointSize: 20,
        },
      },
      "docs/screenshots/qa-telemetry.png",
      {
        frame: "docs/screenshots/qa-telemetry.png",
        delay: "260",
        callout: {
          text: "Grounded cells",
          x: 470,
          y: 120,
          width: 130,
          height: 225,
          labelX: 488,
          labelY: 370,
          pointSize: 18,
        },
      },
    ],
    evidence: ["docs/AGENT_WIKI.md", "docs/skills/self-updating-wiki/SKILL.md", "tests/wikiSkill.test.ts"],
    evalGate: ["tests/workflowEvals.test.ts", "tests/wikiSkill.test.ts", "src/agent/tools.ts"],
    research: ["OpenAI trace grading", "LangSmith online/offline eval lifecycle"],
  },
  {
    id: "proposals-wall-review",
    title: "Proposal review and wall collaboration",
    userWorkflow: "With Auto-allow off, agent edits become host-reviewed proposals; wall edits and approvals remain versioned room artifacts, not invisible local state.",
    size: "960x720",
    crop: "1080x810+220+50",
    delay: "165",
    frames: [
      "docs/screenshots/live-proposals-review.png",
      "docs/screenshots/live-proposals-buttons.png",
      {
        frame: "docs/screenshots/live-proposals-buttons.png",
        delay: "240",
        callout: {
          text: "",
          x: 548,
          y: 56,
          width: 70,
          height: 46,
          labelX: 505,
          labelY: 42,
          pointSize: 22,
        },
      },
      {
        frame: "docs/screenshots/lib-wall.png",
        delay: "440",
      },
    ],
    evidence: ["docs/WALKTHROUGH.md", "docs/PRODUCTION_GUARANTEE_MATRIX.md", "tests/roomEngine.test.ts"],
    evalGate: ["tests/roomEngine.test.ts", "tests/lockTtl.test.ts", "e2e/chat.spec.ts"],
    research: ["Convex queries/mutations/actions", "Braintrust trace anatomy"],
  },
  {
    id: "free-job-halo",
    title: "Long-running /free job and HALO handoff",
    userWorkflow: "A user starts a slow free-auto job; NodeRoom shows job state, attempts, receipts, and traces while HALO records regressions and handoff evidence.",
    delay: "240",
    frames: [
      {
        frame: "docs/screenshots/qa-room.png",
        delay: "260",
      },
      {
        frame: "docs/screenshots/qa-ask-flow.png",
        delay: "320",
      },
      {
        frame: "docs/screenshots/qa-telemetry.png",
        delay: "420",
      },
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
  const missing = preview.frames.map(framePath).filter((frame) => !existsSync(join(root, frame)));
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
  const size = preview.size ?? "960x540";
  const args = preview.frames.flatMap((frame) => {
    const spec = typeof frame === "string" ? { frame } : frame;
    const frameArgs = [
      "(",
      join(root, spec.frame),
      ...(spec.crop ?? preview.crop ? ["-crop", spec.crop ?? preview.crop!, "+repage"] : []),
      "-resize",
      size,
      ...(spec.callout ? [
        "-gravity",
        "NorthWest",
        "-fill",
        "rgba(217,119,87,0.18)",
        "-stroke",
        "#f17a53",
        "-strokewidth",
        "4",
        "-draw",
        `roundrectangle ${spec.callout.x},${spec.callout.y} ${spec.callout.x + spec.callout.width},${spec.callout.y + spec.callout.height} 10,10`,
        "-fill",
        "#fff4ec",
        "-stroke",
        "none",
        "-pointsize",
        String(spec.callout.pointSize ?? 24),
        "-annotate",
        `+${spec.callout.labelX ?? spec.callout.x + 18}+${spec.callout.labelY ?? spec.callout.y + 35}`,
        spec.callout.text,
      ] : []),
      "-background",
      "#f4efe8",
      "-gravity",
      "center",
      "-extent",
      size,
      "-set",
      "delay",
      spec.delay ?? preview.delay ?? "120",
      ")",
    ];
    return frameArgs;
  });
  args.push("-loop", "0", output);
  const result = spawnSync("magick", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error([`magick failed for ${preview.id}`, result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
}

function framePath(frame: PreviewFrame): string {
  return typeof frame === "string" ? frame : frame.frame;
}
