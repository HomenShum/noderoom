import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Intake PlanPreview as a first-class composer artifact (TARGET_2026_06 L195 / L100-101).
 * The typed intakePreflight contract is surfaced live: as the user composes, the card classifies the
 * message (IntakeDecision) and previews how the harness would schedule it before any provider spend.
 */
test.describe("intake plan preview", () => {
  test("classifies the composer draft and previews scheduling before send", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const composer = page.getByTestId("chat-composer");
    const preview = page.getByTestId("intake-plan-preview");
    const sched = page.getByTestId("intake-scheduling");

    // Empty draft -> no preview (no noise).
    await expect(preview).toHaveCount(0);

    // A plain directive routes as a new command that can run now.
    await composer.fill("reconcile Q3 revenue");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-kind", "command");
    await expect(preview).toHaveAttribute("data-scheduling", "run_now");
    await expect(sched).toHaveText(/run now/i);

    // "wait ..." is held for the human.
    await composer.fill("wait for the final close numbers");
    await expect(preview).toHaveAttribute("data-kind", "wait");
    await expect(preview).toHaveAttribute("data-scheduling", "wait_for_human");

    // "cancel ..." is blocked from mutating.
    await composer.fill("cancel that run");
    await expect(preview).toHaveAttribute("data-kind", "cancel");
    await expect(preview).toHaveAttribute("data-scheduling", "blocked");

    // Steering language is recognized as a patch, not a fresh command.
    await composer.fill("actually use the website as the primary evidence instead");
    await expect(preview).toHaveAttribute("data-kind", "steering_patch");

    // Clearing the draft removes the preview.
    await composer.fill("");
    await expect(preview).toHaveCount(0);
  });
});
