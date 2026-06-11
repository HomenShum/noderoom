/**
 * Gemini GIF judge — every demo GIF must be JUDGED AND VISUALLY VERIFIED by gemini-3.5-flash
 * before "demo ready" can be claimed (standing rule, 2026-06-11).
 *
 * Honesty constraint that shaped the design: sending the .gif bytes to the Gemini API is
 * DISHONEST judging — the API accepts image/gif but reads ONLY the first frame (probed
 * 2026-06-11). So this judge re-captures the preview frames through the SAME pipeline the GIF
 * encoder uses (scripts/workflow-preview/capture.ts) and sends a sampled frame SEQUENCE with
 * per-frame display delays, so the model judges the experience a viewer actually gets.
 *
 *   npx tsx scripts/judge-demo-gif.ts                      # judge every workflow preview
 *   npx tsx scripts/judge-demo-gif.ts finance-model-solve  # judge one
 *
 * Verdicts: docs/eval/gif-judge/<id>.json (committed — scores + issues, no secrets).
 * Pass bar: average >= 7 AND no dimension < 5. A FAIL blocks the "demo ready" claim.
 */
import "./benchmark/loadEnv"; // .env.local -> process.env, must be first
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOWS, capturePreviewFrames, type Workflow } from "./workflow-preview/capture";

const JUDGE_MODEL = "gemini-3.5-flash";
const OUT_DIR = "docs/eval/gif-judge";
const MAX_FRAMES = 12;
const DIMENSIONS = ["readability", "pacing", "narrative_completeness", "visual_polish", "honesty_no_artifacts"] as const;

type Verdict = {
  workflow: string;
  judgeModel: string;
  judgedAt: string;
  frameCount: number;
  sampledFrames: number;
  scores: Record<(typeof DIMENSIONS)[number], number>;
  average: number;
  pass: boolean;
  topIssues: string[];
  fixSuggestions: string[];
};

/** Even sample that always keeps the first and last frame (goal + result). */
function sampleIndices(total: number, max: number): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const idx = new Set<number>([0, total - 1]);
  for (let i = 1; idx.size < max; i++) idx.add(Math.round((i * (total - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b);
}

function rubric(wf: Workflow, delays: number[], picked: number[], total: number): string {
  const pacing = picked.map((i, n) => `frame ${n + 1}: shown ${delays[i]}ms`).join(", ");
  return [
    `You are a strict UI/UX judge for product demo GIFs. This is the "${wf.title}" walkthrough`,
    `(${wf.badge}): ${wf.subtitle}. You are given ${picked.length} frames sampled in order from a`,
    `${total}-frame animated GIF. Viewer pacing: ${pacing}.`,
    ``,
    `Score each dimension 0-10 (10 = ship-quality):`,
    `- readability: is ALL text legible at this size — labels, values, badges, progress text?`,
    `- pacing: given the per-frame display times, can a first-time viewer follow each change?`,
    `- narrative_completeness: do the frames tell goal -> actions -> verified result, no dead air?`,
    `- visual_polish: alignment, spacing, clipping, color contrast, no overlapping elements?`,
    `- honesty_no_artifacts: no rendering glitches, truncated text, ghost frames, or misleading UI?`,
    ``,
    `Be adversarial: name the WORST concrete problems, citing frame numbers. Respond with ONLY a`,
    `JSON object: {"scores": {"readability": n, "pacing": n, "narrative_completeness": n,`,
    `"visual_polish": n, "honesty_no_artifacts": n}, "topIssues": ["frame N: ..."],`,
    `"fixSuggestions": ["..."]}`,
  ].join("\n");
}

async function judge(wf: Workflow): Promise<Verdict | null> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY missing — the judge cannot run (skipping would be a silent pass).");
  const captured = await capturePreviewFrames(wf);
  if (!captured) { console.log(`SKIP ${wf.id}: no trace`); return null; }

  const picked = sampleIndices(captured.frames.length, MAX_FRAMES);
  const parts: Array<Record<string, unknown>> = [
    { text: rubric(wf, captured.delaysMs, picked, captured.frames.length) },
    ...picked.map((i) => ({ inline_data: { mime_type: "image/png", data: captured.frames[i].toString("base64") } })),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let parsed: { scores?: Record<string, number>; topIssues?: string[]; fixSuggestions?: string[] };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
  } finally {
    clearTimeout(timer);
  }

  const scores = Object.fromEntries(
    DIMENSIONS.map((d) => [d, Math.max(0, Math.min(10, Number(parsed.scores?.[d] ?? 0)))]),
  ) as Verdict["scores"];
  const values = DIMENSIONS.map((d) => scores[d]);
  const average = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  const verdict: Verdict = {
    workflow: wf.id,
    judgeModel: JUDGE_MODEL,
    judgedAt: new Date().toISOString(),
    frameCount: captured.frames.length,
    sampledFrames: picked.length,
    scores,
    average,
    pass: average >= 7 && Math.min(...values) >= 5,
    topIssues: (parsed.topIssues ?? []).slice(0, 5).map(String),
    fixSuggestions: (parsed.fixSuggestions ?? []).slice(0, 5).map(String),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${wf.id}.json`), JSON.stringify(verdict, null, 2) + "\n");
  return verdict;
}

const only = process.argv[2];
const targets = only ? WORKFLOWS.filter((w) => w.id === only) : WORKFLOWS;
if (!targets.length) { console.error(`no workflow "${only}"; ids: ${WORKFLOWS.map((w) => w.id).join(", ")}`); process.exit(1); }
const results: Verdict[] = [];
for (const wf of targets) {
  const v = await judge(wf);
  if (v) {
    results.push(v);
    console.log(`${v.pass ? "PASS" : "FAIL"} ${v.workflow.padEnd(20)} avg=${v.average} ${DIMENSIONS.map((d) => `${d.split("_")[0]}=${v.scores[d]}`).join(" ")}`);
    for (const issue of v.topIssues.slice(0, 2)) console.log(`     · ${issue}`);
  }
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} previews pass the gemini-3.5-flash judge -> ${OUT_DIR}/`);
if (failed.length) { console.log(`FAILING: ${failed.map((f) => f.workflow).join(", ")} — fix and re-judge before claiming demo-ready.`); process.exit(1); }
