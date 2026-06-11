/**
 * Render a "skill preview" GIF for a NodeRoom workflow from a REAL agent run trace.
 *
 * Pipeline: real trace (docs/eval/traces/**) -> animated HTML replayer -> Playwright frame capture
 * -> gifenc looping GIF (docs/eval/workflow-previews/<id>.gif). The trace is genuine agent runtime
 * output (lock/CAS/draft/merge tool calls), so the preview shows the actual user<->agent workflow,
 * not a mockup. Each frame = the sheet state after one agent step; first/last frames hold longer.
 *
 * Frame capture lives in scripts/workflow-preview/capture.ts, SHARED with the gemini-3.5-flash
 * GIF judge (judge-demo-gif.ts) so the judge scores the identical pixels this encoder ships.
 *
 *   npx tsx scripts/render-workflow-preview.ts            # all workflows
 *   npx tsx scripts/render-workflow-preview.ts l3-no-clobber
 */
import gifenc from "gifenc";
import pngjs from "pngjs";
// gifenc/pngjs are CJS; named ESM exports aren't reliably detected, so default-import + destructure.
const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as typeof import("gifenc");
const { PNG } = pngjs as unknown as typeof import("pngjs");
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, WORKFLOWS, capturePreviewFrames, type Workflow } from "./workflow-preview/capture";

async function render(wf: Workflow): Promise<boolean> {
  const captured = await capturePreviewFrames(wf);
  if (!captured) { console.log(`SKIP ${wf.id}: no trace matching ${wf.tracePattern}`); return false; }

  const enc = GIFEncoder();
  for (let i = 0; i < captured.frames.length; i++) {
    const png = PNG.sync.read(captured.frames[i]);
    const data = new Uint8Array(png.data);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, png.width, png.height, { palette, delay: captured.delaysMs[i] });
  }
  enc.finish();

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${wf.id}.gif`);
  writeFileSync(out, enc.bytes());
  console.log(`WROTE ${out}  (${captured.frames.length} frames, ${(enc.bytes().length / 1024).toFixed(0)} KB)  <- ${captured.traceFile}`);
  return true;
}

const only = process.argv[2];
const targets = only ? WORKFLOWS.filter((w) => w.id === only) : WORKFLOWS;
if (!targets.length) { console.error(`no workflow "${only}"; ids: ${WORKFLOWS.map((w) => w.id).join(", ")}`); process.exit(1); }
let ok = 0;
for (const wf of targets) { if (await render(wf)) ok++; }
console.log(`\n${ok}/${targets.length} previews rendered into ${OUT_DIR}`);
