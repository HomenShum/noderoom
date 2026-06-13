import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Center-stage split mode (memory mode, no backend).
 *
 * Closes the "center-stage split mode" gap from docs/synthesis/specs/A_UI_SHELL.md
 * (TARGET_2026_06 L197): a primary Work Surface (e.g. the Q3 model) can open a second
 * reference surface (proof / source / wiki) BESIDE it without leaving the center stage.
 * Split is self-contained in the Artifact panel — the right Copilot is untouched.
 */

// Desktop bands where two panes fit comfortably (isCompact kicks in at <=980px).
const SPLIT_BANDS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1280", width: 1280, height: 800 },
] as const;

test.describe("center-stage split mode", () => {
  test("defaults to a single surface with a split control present", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const stage = page.getByTestId("work-surface");
    await expect(stage).toHaveAttribute("data-split", "false");
    // Exactly one surface by default; no secondary pane mounted.
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await expect(page.getByTestId("artifact-panel-secondary")).toHaveCount(0);

    // The seeded demo room has multiple artifacts, so the split control is enabled.
    const toggle = page.getByTestId("artifact-split-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  for (const band of SPLIT_BANDS) {
    test(`opens a second surface beside the primary and closes it again — ${band.name}`, async ({ page }) => {
      await page.setViewportSize({ width: band.width, height: band.height });
      await enterDemoRoom(page);

      const stage = page.getByTestId("work-surface");
      const primary = page.getByTestId("artifact-panel");
      const secondary = page.getByTestId("artifact-panel-secondary");

      // Open: the secondary surface mounts beside the primary; both stay on the center stage.
      await page.getByTestId("artifact-split-toggle").click();
      await expect(stage).toHaveAttribute("data-split", "true");
      await expect(primary).toBeVisible();
      await expect(secondary).toBeVisible();
      await expect(page.getByTestId("artifact-split-toggle")).toHaveAttribute("aria-pressed", "true");

      // Two panes really sit side by side (secondary's left edge is right of the primary's left edge).
      const a = await primary.boundingBox();
      const b = await secondary.boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(b!.x).toBeGreaterThan(a!.x);

      // The secondary has its own independent tab strip.
      await expect(page.getByTestId("artifact-tabs-secondary")).toBeVisible();

      // Close from the secondary pane: it unmounts, primary remains, stage collapses to single.
      await page.getByTestId("artifact-split-close").click();
      await expect(secondary).toHaveCount(0);
      await expect(primary).toBeVisible();
      await expect(stage).toHaveAttribute("data-split", "false");
    });
  }
});
