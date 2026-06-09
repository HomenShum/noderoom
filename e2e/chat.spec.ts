import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

/**
 * Real-DOM chat coverage (memory mode, no backend). Proves the Wave-1 optimistic / honest-status
 * fixes through the actual rendered UI — the layer convex-test and unit tests cannot reach.
 */
test.describe("chat — optimistic send + edit (memory mode)", () => {
  test.beforeEach(async ({ page }) => { await enterDemoRoom(page); });

  test("send renders an instant, stably-keyed, confirmed bubble", async ({ page }) => {
    const chat = publicChat(page);
    const body = `hello-${test.info().testId}-${Date.now().toString(36)}`;
    await chat.getByTestId("chat-composer").fill(body);
    await chat.getByTestId("chat-send").click();

    const bubble = chat.getByTestId("chat-message").filter({ hasText: body });
    await expect(bubble).toBeVisible();
    // Memory writes are synchronous → the bubble is confirmed, never stuck in the pending state.
    await expect(bubble).toHaveAttribute("data-state", "confirmed");
    // The stable clientMsgId key means the bubble is a single node, not a remounted duplicate.
    await expect(bubble).toHaveCount(1);
  });

  test("editing own message paints the new text in place", async ({ page }) => {
    const chat = publicChat(page);
    const body = `editme-${Date.now().toString(36)}`;
    await chat.getByTestId("chat-composer").fill(body);
    await chat.getByTestId("chat-send").click();

    const bubble = chat.getByTestId("chat-message").filter({ hasText: body });
    await expect(bubble).toBeVisible();
    await bubble.getByTestId("chat-edit").click();
    const editor = bubble.getByRole("textbox", { name: /edit message/i });
    await editor.fill(`${body}-edited`);
    await bubble.getByTestId("chat-edit-save").click();

    await expect(chat.getByTestId("chat-message").filter({ hasText: `${body}-edited` })).toBeVisible();
    await expect(bubble.getByTestId("chat-edit-error")).toHaveCount(0);
  });
});
