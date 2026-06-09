import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers. The default flow drives the app in MEMORY mode (no backend): the Landing's
 * "Enter the Q3 diligence room" button mounts the EngineStoreProvider over the seeded demo room.
 */
export async function enterDemoRoom(page: Page): Promise<void> {
  await page.goto("/?mode=memory");
  // Suppress the first-run guided tour for non-tour specs — its card would overlay the UI under test.
  // (The dedicated tour spec clears this flag to exercise auto-start.)
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  await page.getByRole("button", { name: /Enter the Q3 diligence room/i }).click();
  // The public chat panel (center) is the anchor for most assertions.
  await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();
}

/** The public chat panel (center). Scopes selectors so the private agent panel (right) never matches. */
export function publicChat(page: Page) {
  return page.locator(".r-panel.center");
}

export const test = base;
export { expect };
