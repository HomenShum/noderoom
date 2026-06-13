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
  // The Work Surface is the always-on anchor; Copilot may be closed on compact screens.
  await expect(page.getByTestId("artifact-panel")).toBeVisible();
}

/** The public chat lane in Copilot. Scopes selectors so the private agent lane never matches. */
export function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

export const test = base;
export { expect };
