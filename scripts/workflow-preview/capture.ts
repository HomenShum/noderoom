/**
 * Shared frame-capture pipeline for workflow previews: real trace (docs/eval/traces/**) ->
 * animated HTML replayer -> Playwright PNG frames. Extracted from render-workflow-preview.ts so
 * the GIF encoder AND the gemini-3.5-flash GIF judge (judge-demo-gif.ts) consume the IDENTICAL
 * frames — the judge must never see different pixels than the artifact pipeline produces.
 * (Sending the .gif bytes to Gemini is dishonest judging: the API reads only the first frame —
 * probed 2026-06-11.)
 */
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type Cell = { id: string; label: string; value?: string };
export type Workflow = { id: string; title: string; badge: string; subtitle: string; tracePattern: RegExp; cells: Cell[] };

export const TRACES_DIR = "docs/eval/traces";
export const OUT_DIR = "docs/eval/workflow-previews";
const REPLAYER = resolve("scripts/workflow-preview/replayer.html");

const VARIANCE_ROWS: Cell[] = [
  { id: "r_rev__variance", label: "Revenue / variance", value: "+24%" },
  { id: "r_cogs__variance", label: "COGS / variance", value: "+27.5%" },
  { id: "r_gp__variance", label: "Gross profit / variance", value: "+21.7%" },
  { id: "r_ni__variance", label: "Net income / variance", value: "" },
];

const FINANCE_MODEL_CELLS: Cell[] = [
  { id: "F7", label: "F7 / revenue", value: "" },
  { id: "F16", label: "F16 / interest expense", value: "" },
  { id: "F44", label: "F44 / revolver logic", value: "" },
  { id: "F73", label: "F73 / revolver balance", value: "" },
  { id: "F85", label: "F85 / balance check", value: "" },
  { id: "G85", label: "G85 / balance check", value: "" },
];

export const WORKFLOWS: Workflow[] = [
  { id: "l1-read", title: "Read", badge: "L1 / context", subtitle: "Report a value without changing anything", tracePattern: /ladder_L1_read/, cells: VARIANCE_ROWS },
  { id: "l2-edit", title: "Edit with CAS", badge: "L2 / single write", subtitle: "Claim the cell, read its version, write with compare-and-set", tracePattern: /ladder_L2_edit/, cells: VARIANCE_ROWS },
  { id: "l3-no-clobber", title: "No clobber", badge: "L3 / concurrent", subtitle: "A human edits mid-write; CAS rejects the stale write and the agent re-reads", tracePattern: /ladder_L3_conflict/, cells: VARIANCE_ROWS },
  { id: "l4-draft", title: "Draft when blocked", badge: "L4 / locked range", subtitle: "The range is locked, so the agent drafts the change for smart-merge", tracePattern: /ladder_L4_blocked/, cells: VARIANCE_ROWS },
  {
    id: "l5-large-range", title: "Large range", badge: "L5 / 600-row model", subtitle: "Load only the 5-row window around the target — never the full sheet",
    tracePattern: /ladder_L5_large_range/,
    cells: [
      { id: "lr_0418__variance", label: "Line 418 / variance", value: "" },
      { id: "lr_0419__variance", label: "Line 419 / variance", value: "" },
      { id: "lr_0420__variance", label: "Line 420 / variance", value: "" },
      { id: "lr_0421__variance", label: "Line 421 / variance", value: "" },
      { id: "lr_0422__variance", label: "Line 422 / variance", value: "" },
    ],
  },
  {
    // L6 writes FIVE cells (rev, cogs, gp, opex, ni) — the table must show all five or the goal
    // text "fill five cells" is mathematically unverifiable on screen (gemini judge finding).
    id: "l6-long-horizon", title: "Long horizon", badge: "L6 / multi-cell + recovery", subtitle: "Fill five cells under repeated conflicts, compacting context, never locking", tracePattern: /ladder_L6_long/,
    cells: [
      { id: "r_rev__variance", label: "Revenue / variance", value: "+24%" },
      { id: "r_cogs__variance", label: "COGS / variance", value: "+27.5%" },
      { id: "r_gp__variance", label: "Gross profit / variance", value: "+21.7%" },
      { id: "r_opex__variance", label: "Opex / variance", value: "" },
      { id: "r_ni__variance", label: "Net income / variance", value: "" },
    ],
  },
  {
    id: "finance-model-solve",
    title: "Finance Model Solve",
    badge: "Professional / 3-statement",
    subtitle: "Lock the forecast cells, read current versions, write linked formulas, release for review",
    tracePattern: /finance_model_solve/,
    cells: FINANCE_MODEL_CELLS,
  },
];

export function findTrace(pattern: RegExp): string | null {
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

export type CapturedPreview = {
  traceFile: string;
  /** PNG buffers, one per replayer frame, in order */
  frames: Buffer[];
  /** GIF display delay per frame (ms) — the pacing the viewer experiences */
  delaysMs: number[];
};

export function frameDelayMs(index: number, frameCount: number): number {
  // Mid-frame tempo raised twice on gemini-judge pacing findings (950 -> 1150 -> 1400): every
  // frame is a distinct CAS beat (read / write / reject / recover), so viewers need time to read
  // BOTH the row change and the status line. Heavy frames carry their own longer `hold` hints.
  return index === 0 ? 1500 : index === frameCount - 1 ? 2000 : 1400; // hold the goal + the result
}

export async function capturePreviewFrames(wf: Workflow): Promise<CapturedPreview | null> {
  const traceFile = findTrace(wf.tracePattern);
  if (!traceFile) return null;
  const traceJson = JSON.parse(readFileSync(traceFile, "utf8"));
  const trace = traceJson.trace ?? [];
  const wfData = { title: wf.title, badge: wf.badge, subtitle: wf.subtitle, cells: wf.cells, trace };

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 420 }, deviceScaleFactor: 2 });
    await page.addInitScript((d) => { (window as unknown as { __WF__: unknown }).__WF__ = d; }, wfData);
    await page.goto("file://" + REPLAYER);
    const frameCount: number = await page.evaluate(() => (window as unknown as { frameCount: () => number }).frameCount());
    const stage = page.locator("#stage");
    const frames: Buffer[] = [];
    const delaysMs: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      await page.evaluate((n) => (window as unknown as { showFrame: (n: number) => void }).showFrame(n), i);
      await page.waitForTimeout(120);
      frames.push(await stage.screenshot({ type: "png" }));
      // Replayer frames can carry a hold hint (conflicts/denials need reading time).
      const hold: number | null = await page.evaluate((n) => (window as unknown as { frameHold?: (n: number) => number | null }).frameHold?.(n) ?? null, i);
      delaysMs.push(hold ?? frameDelayMs(i, frameCount));
    }
    return { traceFile, frames, delaysMs };
  } finally {
    await browser.close();
  }
}
