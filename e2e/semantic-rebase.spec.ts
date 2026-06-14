import { enterDemoRoom, expect, test } from "./fixtures";

test("semantic rebase conflict drill is visible, reviewable, and applies only after host approval", async ({ page }) => {
  await enterDemoRoom(page);

  const panel = page.getByTestId("artifact-panel");
  await panel.getByTestId("collab-conflict").click();

  const revenueVariance = panel.locator('[data-cell-key="r_rev__variance"]');
  const semanticChip = revenueVariance.locator('[data-testid="proposal-inline"][data-semantic="true"]');

  await expect(semanticChip).toBeVisible({ timeout: 15_000 });
  await expect(semanticChip).toContainText("+19%");
  await expect(revenueVariance).toContainText("+24%");

  const semanticCard = panel.locator('[data-testid="proposal-card"][data-semantic="true"]').first();
  await expect(semanticCard).toBeVisible();
  await expect(semanticCard.getByTestId("semantic-proposal-meta")).toContainText("Semantic rebase");
  await expect(page.getByTestId("room-trace")).toContainText("Semantic rebase opened");

  await semanticChip.getByTestId("proposal-inline-approve").click();

  await expect(revenueVariance.locator('[data-testid="proposal-inline"]')).toHaveCount(0);
  await expect(revenueVariance).toContainText("+19%");
  await expect(page.getByTestId("room-trace")).toContainText("approved");
});
