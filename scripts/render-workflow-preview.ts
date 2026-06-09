/**
 * Render a "skill preview" GIF for a NodeRoom workflow from a REAL agent run trace.
 *
 * Pipeline: real trace (docs/eval/traces/**) -> animated HTML replayer -> Playwright frame capture
 * -> gifenc looping GIF (docs/eval/workflow-previews/<id>.gif). The trace is genuine agent runtime
 * output (lock/CAS/draft/merge tool calls), so the preview shows the actual user<->agent workflow,
 * not a mockup. Each frame = the sheet state after one agent step; first/last frames hold longer.
 *
 *   npx tsx scripts/render-workflow-preview.ts            # all workflows
 *   npx tsx scripts/render-workflow-preview.ts l3-no-clobber
 */
import { chromium } from "@playwright/test";
import gifenc from "gifenc";
import pngjs from "pngjs";
// gifenc/pngjs are CJS; named ESM exports aren't reliably detected, so default-import + destructure.
const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as typeof import("gifenc");
const { PNG } = pngjs as unknown as typeof import("pngjs");
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

type Cell = { id: string; label: string; value?: string };
type Workflow = { id: string; title: string; badge: string; subtitle: string; tracePattern: RegExp; cells: Cell[] };

const TRACES_DIR = "docs/eval/traces";
const OUT_DIR = "docs/eval/workflow-previews";
const REPLAYER = resolve("scripts/workflow-preview/replayer.html");

const VARIANCE_ROWS: Cell[] = [
  { id: "r_rev__variance", label: "Revenue / variance", value: "+24%" },
  { id: "r_cogs__variance", label: "COGS / variance", value: "+27.5%" },
  { id: "r_gp__variance", label: "Gross profit / variance", value: "+21.7%" },
  { id: "r_ni__variance", label: "Net income / variance", value: "" },
];

const WORKFLOWS: Workflow[] = [
  { id: "l1-read", title: "Read", badge: "L1 / context", subtitle: "Report a value without changing anything", tracePattern: /ladder_L1_read/, cells: VARIANCE_ROWS },
  { id: "l2-edit", title: "Edit with CAS", badge: "L2 / single write", subtitle: "Claim the cell, read its version, write with compare-and-set", tracePattern: /ladder_L2_edit/, cells: VARIANCE_ROWS },
  { id: "l3-no-clobber", title: "No clobber", badge: "L3 / concurrent", subtitle: "A human edits mid-write; CAS rejects the stale write and the agent re-reads", tracePattern: /ladder_L3_conflict/, cells: VARIANCE_ROWS },
  { id: "l4-draft", title: "Draft when blocked", badge: "L4 / locked range", subtitle: "The range is locked, so the agent drafts the change for smart-merge", tracePattern: /ladder_L4_blocked/, cells: VARIANCE_ROWS },
  { id: "l6-long-horizon", title: "Long horizon", badge: "L6 / multi-cell + recovery", subtitle: "Fill five cells under repeated conflicts, compacting context, never locking", tracePattern: /ladder_L6_long/, cells: VARIANCE_ROWS },
];

function findTrace(pattern: RegExp): string | null {
  if (!existsSync(TRACES_DIR)) return null;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".json") && pattern.test(p)) hits.push(p);
    }
  };
  walk(TRACES_DIR);
  hits.sort(); // newest dir name (timestamp prefix) sorts last
  return hits.length ? hits[hits.length - 1] : null;
}

async function render(wf: Workflow): Promise<boolean> {
  const traceFile = findTrace(wf.tracePattern);
  if (!traceFile) { console.log(`SKIP ${wf.id}: no trace matching ${wf.tracePattern}`); return false; }
  const traceJson = JSON.parse(readFileSync(traceFile, "utf8"));
  const trace = traceJson.trace ?? [];
  const wfData = { title: wf.title, badge: wf.badge, subtitle: wf.subtitle, cells: wf.cells, trace };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 760, height: 420 }, deviceScaleFactor: 2 });
  await page.addInitScript((d) => { (window as unknown as { __WF__: unknown }).__WF__ = d; }, wfData);
  await page.goto("file://" + REPLAYER);
  const frameCount: number = await page.evaluate(() => (window as unknown as { frameCount: () => number }).frameCount());

  const enc = GIFEncoder();
  const stage = page.locator("#stage");
  for (let i = 0; i < frameCount; i++) {
    await page.evaluate((n) => (window as unknown as { showFrame: (n: number) => void }).showFrame(n), i);
    await page.waitForTimeout(120);
    const buf = await stage.screenshot({ type: "png" });
    const png = PNG.sync.read(buf);
    const data = new Uint8Array(png.data);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    const delay = i === 0 ? 1300 : i === frameCount - 1 ? 1900 : 950; // hold the goal + the result
    enc.writeFrame(index, png.width, png.height, { palette, delay });
  }
  enc.finish();
  await browser.close();

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${wf.id}.gif`);
  writeFileSync(out, enc.bytes());
  console.log(`WROTE ${out}  (${frameCount} frames, ${(enc.bytes().length / 1024).toFixed(0)} KB)  <- ${traceFile}`);
  return true;
}

const only = process.argv[2];
const targets = only ? WORKFLOWS.filter((w) => w.id === only) : WORKFLOWS;
if (!targets.length) { console.error(`no workflow "${only}"; ids: ${WORKFLOWS.map((w) => w.id).join(", ")}`); process.exit(1); }
let ok = 0;
for (const wf of targets) { if (await render(wf)) ok++; }
console.log(`\n${ok}/${targets.length} previews rendered into ${OUT_DIR}`);
