import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// QA: verify the cleanliness-by-subtraction pass on the live worktree build.
const OUT = join(process.cwd(), ".tmp-qa");
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5301";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
try {
  // Demo room (seeded) → research toolbar + status strip with activity
  await page.goto(`${BASE}/?demo=WTSUB${Date.now() % 100000}&name=Founder`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='shell-bottom']", { timeout: 25000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, "wt-demo-room.png") });
  // Capture just the bottom strip + research toolbar region text for assertion
  const bottom = await page.locator("[data-testid='signal-tape']").innerText().catch(() => "(no signal-tape)");
  const moreBtn = await page.locator("[aria-label='More research actions']").count().catch(() => 0);
  const enrich = await page.locator("[data-testid='research-enrich']").count().catch(() => 0);
  console.log("SIGNAL_TAPE:", JSON.stringify(bottom));
  console.log("MORE_OVERFLOW_BTN:", moreBtn, "ENRICH_BTN:", enrich);
  console.log("flow_ok");
} catch (e) {
  console.log("flow_error:", e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: join(OUT, "wt-error.png") }).catch(() => {});
}
await ctx.close();
await browser.close();
console.log("done");
