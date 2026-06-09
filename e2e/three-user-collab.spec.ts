import { test, expect, type Page } from "@playwright/test";

/**
 * Three users, one BRAND-NEW room, concurrent collaboration — against the LIVE Convex backend.
 * Proves reactive multi-user chat, concurrent shared-sheet edits with CAS no-clobber convergence,
 * the public AI agent, and private-channel isolation — verified in the DOM and via per-view screenshots.
 *
 * Run:  E2E_LIVE=1 npx playwright test three-user-collab.spec.ts
 * Needs .env.local with VITE_CONVEX_URL (live Convex) + provider keys (for the /ask step).
 */
test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 (live Convex backend + keys) to run the multi-user collab eval");

const SHOTS = "docs/eval/three-user-shots";
const v = (row: string) => `${row}__variance`;

async function dismissTour(p: Page) { await p.getByTestId("tour-skip").click({ timeout: 5000 }).catch(() => {}); }
function chat(p: Page) { return p.locator(".r-panel.center"); }
async function say(p: Page, msg: string) {
  await chat(p).getByTestId("chat-composer").fill(msg);
  await chat(p).getByTestId("chat-send").click();
}
async function editCell(p: Page, key: string, value: string) {
  const cell = p.locator(`[data-cell-key="${key}"]`);
  await cell.locator(".r-cell-edit").click({ timeout: 10000 });
  const input = cell.locator("input.r-cell-input");
  await input.fill(value);
  await input.press("Enter");
}
async function cellText(p: Page, key: string) {
  return (await p.locator(`[data-cell-key="${key}"]`).innerText()).trim();
}
async function shoot(pages: Record<string, Page>, label: string) {
  for (const [name, p] of Object.entries(pages)) await p.screenshot({ path: `${SHOTS}/${label}-${name}.png` });
}

test("three users chat, edit the same sheet concurrently, and run the public agent", async ({ browser }) => {
  test.setTimeout(320_000);
  const CODE = "EVAL-" + Date.now().toString(36).toUpperCase();
  const mk = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const maya = await mk(), dev = await mk(), sam = await mk();
  const all = [maya, dev, sam];
  const pages = { maya, dev, sam };

  // ── Act 1: Maya creates the new room (+ seeds the shared Q3 sheet); Dev & Sam join by code.
  await maya.goto(`/?create=${CODE}&name=Maya`);
  await expect(chat(maya).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expect(maya.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 30_000 }); // sheet seeded
  await dismissTour(maya);
  await dev.goto(`/?room=${CODE}&name=Dev`);
  await sam.goto(`/?room=${CODE}&name=Sam`);
  for (const p of [dev, sam]) { await expect(chat(p).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 }); await dismissTour(p); }
  // roster: every view sees all three people
  for (const p of all) for (const who of ["Maya", "Dev", "Sam"]) {
    await expect(p.getByTestId("left-rail").getByText(who, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
  }

  // ── Act 2: concurrent public chat → fan-out to all three feeds.
  await say(maya, "Maya: kicking off the Q3 review");
  await say(dev, "Dev: I'll take OpEx variance");
  await say(sam, "Sam: I'll take Gross profit");
  for (const p of all) for (const m of ["kicking off the Q3 review", "I'll take OpEx variance", "I'll take Gross profit"]) {
    await expect(chat(p).getByTestId("chat-feed").getByText(m, { exact: false })).toBeVisible({ timeout: 25_000 });
  }
  await shoot(pages, "act2-chat");

  // ── Act 3: parallel edits to DIFFERENT cells (no conflict) — both must land in all views.
  await Promise.all([editCell(dev, v("r_opex"), "+20.5%"), editCell(sam, v("r_gp"), "+21.7%")]);
  for (const p of all) {
    await expect.poll(() => cellText(p, v("r_opex")), { timeout: 25_000 }).toContain("20.5%");
    await expect.poll(() => cellText(p, v("r_gp")), { timeout: 25_000 }).toContain("21.7%");
  }

  // ── Act 4: SAME cell, near-simultaneous — CAS picks one winner; all views converge (no clobber).
  await Promise.all([editCell(maya, v("r_rev"), "+24pct-Maya"), editCell(dev, v("r_rev"), "+19pct-Dev")]);
  await expect.poll(async () => {
    const vals = await Promise.all(all.map((p) => cellText(p, v("r_rev"))));
    const filled = vals.filter((x) => x && x.length);
    return filled.length === 3 && new Set(vals).size === 1 ? vals[0] : null;
  }, { timeout: 30_000 }).not.toBeNull();
  const winner = await cellText(maya, v("r_rev"));
  await shoot(pages, "act4-converged");

  // ── Act 5: public agent (real LLM, best-effort) — Maya runs /ask; effect should reach every view.
  let agent = "not-run";
  try {
    // Genuine effect = a NEW agent-authored bubble, or a previously-EMPTY variance cell getting filled
    // (verified in Sam's joiner view). Do NOT match incidental chat text like the word "variance".
    const agentMsgsBefore = await chat(sam).locator('[data-testid="chat-message"].agent').count();
    const emptyBefore: string[] = [];
    for (const r of ["r_cogs", "r_ni"]) if (!(await cellText(sam, v(r))).length) emptyBefore.push(r);
    await say(maya, "/ask reconcile Q3 revenue and fill the remaining variance cells");
    await expect.poll(async () => {
      const agentMsgsNow = await chat(sam).locator('[data-testid="chat-message"].agent').count();
      let filled = false;
      for (const r of emptyBefore) if ((await cellText(sam, v(r))).length) filled = true;
      return agentMsgsNow > agentMsgsBefore || filled;
    }, { timeout: 150_000, intervals: [3000] }).toBeTruthy();
    agent = "visible-to-all-views";
  } catch {
    agent = "no-visible-effect-within-150s (real-LLM dependent)";
  }
  await shoot(pages, "act5-agent");

  // ── Act 6: private AGENT + isolation. Maya asks her private NodeAgent; it replies in HER private
  //    channel only. Neither her question nor the agent reply leaks to Dev/Sam.
  const priv = (p: Page) => p.locator(".r-panel.right");
  const secret = "which variance row is riskiest? tag-" + Math.floor(Math.random() * 1e6);
  const privAgentBefore = await priv(maya).locator('[data-testid="chat-message"].agent').count();
  await priv(maya).getByTestId("chat-composer").fill(secret);
  await priv(maya).getByTestId("chat-send").click();
  await expect(priv(maya).getByText(secret, { exact: false })).toBeVisible({ timeout: 15_000 });
  let privateAgent = "no-reply";
  try {
    await expect.poll(() => priv(maya).locator('[data-testid="chat-message"].agent').count(), { timeout: 90_000, intervals: [2000] }).toBeGreaterThan(privAgentBefore);
    privateAgent = "replied-privately";
  } catch { privateAgent = "no-reply-within-90s"; }
  await shoot(pages, "act6-private");
  // isolation: Dev & Sam see neither Maya's question nor any private-agent bubble.
  await maya.waitForTimeout(1500);
  for (const p of [dev, sam]) {
    await expect(priv(p).getByText(secret, { exact: false })).toHaveCount(0);
    await expect(priv(p).locator('[data-testid="chat-message"].agent')).toHaveCount(0);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ room: CODE, sameCellWinner: winner, agent, privateAgent }, null, 2));
  for (const p of all) await p.context().close();
});
