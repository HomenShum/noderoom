/**
 * REAL-APP workflow previews. Unlike the trace-replay previews (scripts/render-workflow-preview.ts,
 * which draw a synthetic sheet from trace JSON), these screenshot the ACTUAL NodeRoom 4-panel UI as
 * the real agent runtime drives a workflow, and encode the real DOM frames into a looping GIF.
 *
 * Memory mode (/?mode=memory) runs the same UI + the same agent runtime/tools against the in-memory
 * engine — real pixels, no backend, reproducible. Output: docs/eval/workflow-previews/app-*.gif.
 *
 *   npx playwright test capture-previews
 */
import { test, expect } from "./fixtures";
import { enterDemoRoom } from "./fixtures";
import gifenc from "gifenc";
import pngjs from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as typeof import("gifenc");
const { PNG } = pngjs as unknown as typeof import("pngjs");

const OUT = "docs/eval/workflow-previews";

type Frame = { buf: Buffer; delay: number };

function encodeGif(frames: Frame[], file: string) {
  const enc = GIFEncoder();
  for (const f of frames) {
    const png = PNG.sync.read(f.buf);
    const data = new Uint8Array(png.data);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, png.width, png.height, { palette, delay: f.delay });
  }
  enc.finish();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${file}`, enc.bytes());
}

test.use({ viewport: { width: 1860, height: 900 } });

test("real-app preview — Room NodeAgent fills the variance column (lock → CAS → release)", async ({ page }) => {
  await enterDemoRoom(page);
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();
  const run = page.getByTestId("collab-run");
  await expect(run).toBeVisible();

  const frames: Frame[] = [];
  const shoot = async (delay: number) => { frames.push({ buf: await panel.screenshot({ type: "png" }), delay }); };

  await shoot(1300);                       // before: empty variance cells + "Run collaboration"
  await run.click();                       // the real agent runtime starts (scripted model, in-memory engine)
  for (let i = 0; i < 16; i++) {           // during: lock → read → CAS-edit per cell, trace growing
    await page.waitForTimeout(160);
    await shoot(260);
  }
  // settle on the finished state (cells filled, trace receipts, collab "done")
  await page.waitForTimeout(700);
  await shoot(2000);

  encodeGif(frames, "app-variance-fill.gif");
  expect(frames.length).toBeGreaterThan(10);
  // eslint-disable-next-line no-console
  console.log(`captured ${frames.length} real-app frames -> ${OUT}/app-variance-fill.gif`);
});

test("real-app preview — GTM research enrichment (source-backed CellPayload)", async ({ page }) => {
  await enterDemoRoom(page);
  // Switch the artifact panel to the Research grid.
  await page.locator(".r-tab", { hasText: /Research/i }).first().click();
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();
  const enrich = page.getByTestId("research-enrich");
  await expect(enrich).toBeVisible();

  const frames: Frame[] = [];
  const shoot = async (delay: number) => { frames.push({ buf: await panel.screenshot({ type: "png" }), delay }); };
  await shoot(1300);                       // before: pending accounts, "Enrich N pending"
  if (await enrich.isEnabled()) {
    await enrich.click();                  // scripted research agent enriches pending rows
    for (let i = 0; i < 16; i++) { await page.waitForTimeout(170); await shoot(270); }
  }
  await page.waitForTimeout(700);
  await shoot(2000);
  encodeGif(frames, "app-research-enrich.gif");
  expect(frames.length).toBeGreaterThan(5);
  // eslint-disable-next-line no-console
  console.log(`captured ${frames.length} real-app frames -> ${OUT}/app-research-enrich.gif`);
});

test("real-app preview — a human edits a variance cell (CAS commit by hand)", async ({ page }) => {
  await enterDemoRoom(page);
  const panel = page.getByTestId("artifact-panel");
  const cell = panel.locator("button.r-cell-edit").filter({ hasText: "add" }).first();
  await expect(cell).toBeVisible();

  const frames: Frame[] = [];
  const shoot = async (delay: number) => { frames.push({ buf: await panel.screenshot({ type: "png" }), delay }); };
  await shoot(1200);                       // before: empty cell ("+ add")
  await cell.click();                      // open the inline editor
  await shoot(550);
  const input = panel.locator("input.r-cell-input");
  await expect(input).toBeVisible();
  await input.fill("+20.5%");
  await shoot(650);                        // typing
  await page.keyboard.press("Enter");      // CAS commit
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(160); await shoot(300); }
  await shoot(1800);                       // committed (versioned)
  encodeGif(frames, "app-manual-edit.gif");
  expect(frames.length).toBeGreaterThan(6);
  // eslint-disable-next-line no-console
  console.log(`captured ${frames.length} real-app frames -> ${OUT}/app-manual-edit.gif`);
});
