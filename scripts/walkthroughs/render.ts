/**
 * Render every captured (non-skipped) walkthrough to docs/walkthroughs/<id>.gif via Remotion.
 * Params per docs/dogfood research: 30fps comp → 15fps GIF (--every-nth-frame=2), scale 0.7
 * (1280→896px wide, embed at ~720), target 1–6MB per GIF.
 *
 * Run:  npx tsx scripts/walkthroughs/render.ts [featureIds…]
 */
import { execSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const only = process.argv.slice(2);

const run = async () => {
  const data = (await import("file://" + join(ROOT, "remotion", "walkthrough.data.js"))).default as {
    features: Array<{ id: string; skipped: boolean; segments: unknown[] }>;
  };
  mkdirSync(join(ROOT, "docs", "walkthroughs"), { recursive: true });
  const targets = data.features.filter((f) => !f.skipped && f.segments.length && (!only.length || only.includes(f.id)));
  for (const f of targets) {
    const out = join("docs", "walkthroughs", `${f.id}.gif`);
    console.log(`[render] ${f.id} → ${out}`);
    execSync(`npx remotion render remotion/index.ts ${f.id} ${out} --codec=gif --every-nth-frame=2 --scale=0.7`, { stdio: "inherit" });
    console.log(`[render] ${f.id} done — ${(statSync(join(ROOT, out)).size / 1024 / 1024).toFixed(2)} MB`);
  }
  const skipped = data.features.filter((f) => f.skipped);
  if (skipped.length) console.log(`[render] SKIPPED (recapture needed): ${skipped.map((f) => f.id).join(", ")}`);
};
void run();
