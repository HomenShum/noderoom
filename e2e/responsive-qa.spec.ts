/**
 * Responsive QA probe (read-only, additive) — see QA task 2026-06-09.
 *
 * Drives the app in MEMORY mode (no backend) across 4 viewports and asserts:
 *   1. No horizontal overflow: document.documentElement.scrollWidth <= viewport width + 1
 *   2. Public chat composer visible
 *   3. Artifact panel visible (desktop) or intentionally collapsed (<=980px per
 *      src/app/styles.css:404 — `.r-panel.left/.artifact/.right { display:none }`)
 *   4. Left rail usable (desktop) or intentionally collapsed (same media query)
 *   5. Tab bar (artifact-tabs) reachable — fully inside the viewport when shown
 * Screenshots land in test-results/responsive/<name>.png.
 *
 * "Intentionally collapsed" is verified, not assumed: at <=980px the panels
 * start hidden, the .r-toggle-group affordances must exist, and tapping the
 * artifact toggle must open a usable overlay with its tab bar inside the viewport.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

const VIEWPORTS = [
  { name: "phone-375x812", width: 375, height: 812 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "laptop-1280x800", width: 1280, height: 800 },
  { name: "desktop-1860x900", width: 1860, height: 900 },
] as const;

const OUT_DIR = path.join("test-results", "responsive");

/** Diagnostic: list the widest offenders if the page overflows horizontally. */
async function widestElements(page: import("@playwright/test").Page, limit = 5) {
  return page.evaluate((max) => {
    const vw = document.documentElement.clientWidth;
    const hits: Array<{ sel: string; right: number; width: number }> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
        hits.push({ sel: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(r.right), width: Math.round(r.width) });
      }
    }
    return hits.sort((a, b) => b.right - a.right).slice(0, max);
  }, limit);
}

for (const vp of VIEWPORTS) {
  test(`responsive QA — ${vp.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await enterDemoRoom(page);
    // Let the workspace settle (panel mount + fonts) before measuring.
    await page.waitForTimeout(250);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const shot = path.join(OUT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    testInfo.annotations.push({ type: "screenshot", description: shot });

    // ── 1. No horizontal overflow ──────────────────────────────────────────
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollWidth > vp.width + 1) {
      const offenders = await widestElements(page);
      testInfo.annotations.push({ type: "overflow-offenders", description: JSON.stringify(offenders) });
    }
    expect(
      scrollWidth,
      `horizontal overflow at ${vp.name}: documentElement.scrollWidth=${scrollWidth} > viewport ${vp.width}+1`,
    ).toBeLessThanOrEqual(vp.width + 1);

    // ── 2. Public chat composer visible ────────────────────────────────────
    await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();

    const artifact = page.getByTestId("artifact-panel");
    const leftRail = page.getByTestId("left-rail");
    const tabs = page.getByTestId("artifact-tabs");
    const toggles = page.locator(".r-toggle-group");

    if (vp.width > 980) {
      // ── 3/4/5 desktop: all panels up, tab bar fully reachable ────────────
      await expect(artifact).toBeVisible();
      await expect(leftRail).toBeVisible();
      await expect(tabs).toBeVisible();
      const box = await tabs.boundingBox();
      expect(box, "artifact-tabs must have a bounding box").not.toBeNull();
      expect(box!.x, "tab bar starts inside viewport").toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, "tab bar ends inside viewport").toBeLessThanOrEqual(vp.width + 1);
      // Tab buttons are actually clickable (reachable), not just painted.
      const firstTab = tabs.locator("button").first();
      await expect(firstTab).toBeVisible();
      // Panel toggles remain available on desktop.
      await expect(toggles).toBeVisible();
    } else {
      // ── 3/4/5 compact — HARD ASSERTS for the P0 fix (was annotation-only when the old media
      // query display:none'd both the panels AND the toggles, making them unreachable):
      // chat is the default single pane; the top-bar toggles are the panel switcher; a toggle tap
      // MUST yield a visible overlay panel (same show-state path openArtifact/ref-chips use).
      await expect(artifact, "artifact panel starts closed <=980px (chat-first)").toBeHidden();
      await expect(leftRail, "left rail starts closed <=980px (chat-first)").toBeHidden();
      await expect(toggles, "panel toggles MUST be visible — they are the only path to the panels").toBeVisible();
      const toggleButtons = toggles.locator("button");
      await expect(toggleButtons, "all three panel toggles exist").toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const b = await toggleButtons.nth(i).boundingBox();
        expect(b, `panel toggle ${i} has a bounding box`).not.toBeNull();
        expect(Math.min(b!.width, b!.height), `panel toggle ${i} meets the >=24px floor`).toBeGreaterThanOrEqual(24);
      }
      // Tap the artifact toggle → the overlay opens with a usable tab bar inside the viewport.
      await toggleButtons.nth(1).click(); // order: [files&people, artifact, private agent]
      await expect(artifact, "artifact overlay visible after toggle tap").toBeVisible();
      await expect(tabs, "artifact tab bar usable in the overlay").toBeVisible();
      const box = await tabs.boundingBox();
      expect(box, "artifact-tabs must have a bounding box").not.toBeNull();
      expect(box!.x + box!.width, "tab bar ends inside viewport").toBeLessThanOrEqual(vp.width + 1);
      // Close it — chat returns as the single pane.
      await toggleButtons.nth(1).click();
      await expect(artifact).toBeHidden();
      await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();
    }
  });
}
