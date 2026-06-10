/**
 * Walkthrough capturer — drives the LIVE app (real Convex backend, real LLM for agent features)
 * through each FeatureSpec, captures clean per-state frames + cursor click targets, and emits
 * `remotion/walkthrough.data.js` + frames under `remotion/public/frames/<feature>/`.
 *
 * Run:  npx tsx scripts/walkthroughs/capture.ts            (all features)
 *       npx tsx scripts/walkthroughs/capture.ts chat sheet-undo   (subset)
 *
 * Design: each click/type step emits TWO beats — the pre-frame the cursor glides over (with the
 * recorded target + ripple) and the post-frame outcome — so the rendered walkthrough always shows
 * empty state → where the cursor clicked → loading → result. LLM features retry in a FRESH room.
 */
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { FEATURES, type FeatureSpec, type Step, type After } from "./specs.js";

const BASE = process.env.WALKTHROUGH_BASE ?? "https://noderoom.live";
const VIEW = { width: 1280, height: 800 };
const ROOT = process.cwd();
const PUB = join(ROOT, "remotion", "public");
const onlyIds = process.argv.slice(2);

type Segment = { frame: string; caption: string; cursor: { x: number; y: number } | null; click: boolean; kind: "state" | "action" | "typed" | "loading" | "result"; holdMs: number };
type FeatureOut = { id: string; title: string; skipped: boolean; error?: string; segments: Segment[] };

const VARS = ["r_rev", "r_cogs", "r_gp", "r_opex", "r_ni"].map((r) => `${r}__variance`);

async function settle(page: Page, ms = 420) { await page.waitForTimeout(ms); }

async function shoot(page: Page, dir: string, n: number): Promise<string> {
  const rel = `frames/${dir}/${String(n).padStart(2, "0")}.png`;
  await page.screenshot({ path: join(PUB, rel) });
  return rel;
}

async function center(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: "visible", timeout: 15_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = (await loc.boundingBox())!;
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

async function waitAfter(page: Page, a: After | undefined) {
  if (!a) return settle(page);
  if ("textSel" in a) {
    await page.waitForFunction(
      ({ sel, inc }) => ((document.querySelector(sel) as HTMLElement | null)?.innerText ?? "").includes(inc),
      { sel: a.textSel, inc: a.includes }, { timeout: a.timeoutMs ?? 20_000 });
  } else {
    await page.locator(a.sel).first().waitFor({ state: a.state ?? "visible", timeout: a.timeoutMs ?? 20_000 });
  }
  await settle(page);
}

async function createRoom(ctx: BrowserContext, code: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?create=${code}&name=Maya`, { waitUntil: "domcontentloaded" });
  await page.locator('.r-panel.center [data-testid="chat-composer"]').waitFor({ timeout: 60_000 });
  await page.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await page.locator('[data-cell-key="r_rev__variance"]').waitFor({ timeout: 30_000 });
  await page.addStyleTag({ content: "*::-webkit-scrollbar{display:none!important} .r-tour{display:none!important}" });
  await settle(page, 800);
  return page;
}

async function seedResearch(page: Page, code: string) {
  // The room's OWN session token (from the browser) authorizes seeding a research artifact.
  const sess = JSON.parse(await page.evaluate((k) => localStorage.getItem(k) ?? "{}", `noderoom:live:${code}`));
  if (!sess.token) throw new Error(`seedResearch: no session in localStorage for ${code}`);
  const url = readFileSync(join(ROOT, ".env.local"), "utf8").match(/VITE_CONVEX_URL=(.+)/)![1].trim();
  const client = new ConvexHttpClient(url);
  const proof = { actor: { kind: "user" as const, id: String(sess.memberId), name: String(sess.name) }, token: String(sess.token) };
  const artId = await client.mutation(api.artifacts.createArtifact, { roomId: sess.roomId, kind: "sheet", title: "Company research", seed: [], proof });
  await client.mutation(api.artifacts.addResearchRows, {
    roomId: sess.roomId, artifactId: artId, requester: proof,
    rows: [
      { company: "OpenAI", website: "https://openai.com", tier: "A", owner: "Maya" },
      { company: "Stripe", website: "https://stripe.com", tier: "A", owner: "Maya" },
      { company: "Figma", website: "https://figma.com", tier: "B", owner: "Sam" },
    ],
  });
  console.log(`  [seed] research artifact ${String(artId)} created in ${code}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await page.locator('.r-panel.center [data-testid="chat-composer"]').waitFor({ timeout: 30_000 });
  // Open the research sheet: left-rail file entry first, artifact-tab fallback.
  const rail = page.getByTestId("left-rail").getByText("Company research").first();
  try {
    await rail.click({ timeout: 10_000 });
  } catch {
    await page.locator('[data-testid="artifact-tabs"] button', { hasText: /research/i }).first().click({ timeout: 10_000 });
  }
  await page.addStyleTag({ content: "*::-webkit-scrollbar{display:none!important} .r-tour{display:none!important}" });
  await page.locator(".r-research").waitFor({ timeout: 15_000 });
  await settle(page, 800);
}

/** Deterministic in-browser demo engine at the SAME prod URL — same UI, scripted agent. */
async function memoryDemo(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mode=memory`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  await page.getByRole("button", { name: /Enter the Q3 diligence room/i }).click({ timeout: 30_000 });
  await page.locator('.r-panel.center [data-testid="chat-composer"]').waitFor({ timeout: 30_000 });
  await page.getByTestId("tour-skip").click({ timeout: 5000 }).catch(() => {});
  await page.addStyleTag({ content: "*::-webkit-scrollbar{display:none!important} .r-tour{display:none!important}" });
  await settle(page, 800);
  return page;
}

async function runFeature(spec: FeatureSpec, attempt: number): Promise<FeatureOut> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const code = `GIF-${spec.id.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const dir = spec.id;
  rmSync(join(PUB, "frames", dir), { recursive: true, force: true });
  mkdirSync(join(PUB, "frames", dir), { recursive: true });
  const segments: Segment[] = [];
  let n = 0;
  try {
    const page = spec.setup === "memoryDemo" ? await memoryDemo(ctx) : await createRoom(ctx, code);
    if (spec.setup === "seedResearchRoom") await seedResearch(page, code);

    for (const step of spec.steps) {
      if (step.kind === "state") {
        await settle(page, step.settleMs ?? 420);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "state", holdMs: step.holdMs ?? 1700 });
      } else if (step.kind === "click") {
        const cur = await center(page, step.sel);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: cur, click: true, kind: "action", holdMs: step.holdMs ?? 950 });
        await page.locator(step.sel).first().click();
        await waitAfter(page, step.after);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.afterCaption ?? step.caption, cursor: null, click: false, kind: "result", holdMs: step.afterCaption ? 1700 : 950 });
      } else if (step.kind === "type") {
        const cur = await center(page, step.sel);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: cur, click: false, kind: "action", holdMs: 800 });
        const loc = page.locator(step.sel).first();
        await loc.click();
        await loc.fill(step.text);
        await settle(page, 250);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "typed", holdMs: 1300 });
        if (step.pressEnter) {
          await loc.press("Enter");
          await waitAfter(page, step.after);
          if (step.afterCaption) segments.push({ frame: await shoot(page, dir, ++n), caption: step.afterCaption, cursor: null, click: false, kind: "result", holdMs: 1700 });
        } else if (step.after) {
          await waitAfter(page, step.after);
        }
      } else if (step.kind === "key") {
        await page.keyboard.press(step.key);
        await waitAfter(page, step.after);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "result", holdMs: 1500 });
      } else if (step.kind === "loading") {
        await page.locator(step.sel).first().waitFor({ timeout: step.timeoutMs ?? 30_000 });
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "loading", holdMs: 1600 });
      } else if (step.kind === "waitResult") {
        const t0 = Date.now();
        const timeout = step.timeoutMs ?? 150_000;
        if (step.predicate === "cellsFilled") {
          const want = Number(step.arg ?? "2");
          await page.waitForFunction(({ keys, want }) => {
            const filled = keys.filter((k) => { const t = ((document.querySelector(`[data-cell-key="${k}"]`) as HTMLElement | null)?.innerText ?? "").trim(); return t.length > 0 && !/^add\b/i.test(t); });
            return filled.length >= want;
          }, { keys: VARS, want }, { timeout, polling: 1500 });
        } else if (step.predicate === "chipsVisible") {
          await page.locator('[data-testid="proposal-inline"]').first().waitFor({ timeout });
        } else {
          await page.waitForFunction((inc) => document.body.innerText.includes(inc!), step.arg, { timeout });
        }
        await settle(page, 700);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "result", holdMs: 2100 });
        console.log(`  [${spec.id}] result after ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }
    await browser.close();
    return { id: spec.id, title: spec.title, skipped: false, segments };
  } catch (e) {
    // Failure forensics: freeze the exact UI state + where we were (kept out of walkthrough data).
    try {
      const pages = ctx.pages();
      const p = pages[pages.length - 1];
      if (p) {
        await p.screenshot({ path: join(PUB, "frames", dir, "zz-fail.png") }).catch(() => {});
        const rail = await p.getByTestId("left-rail").innerText().catch(() => "(no rail)");
        console.log(`  [${spec.id}] FAIL-STATE rail: ${rail.replace(/\s+/g, " | ").slice(0, 220)}`);
      }
    } catch { /* forensics are best-effort */ }
    await browser.close();
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    if (attempt < (spec.retries ?? 0)) {
      console.log(`  [${spec.id}] attempt ${attempt + 1} failed (${msg}) — retrying in a fresh room`);
      return runFeature(spec, attempt + 1);
    }
    return { id: spec.id, title: spec.title, skipped: true, error: msg, segments: [] };
  }
}

const run = async () => {
  mkdirSync(join(ROOT, "remotion"), { recursive: true });
  const picked = onlyIds.length ? FEATURES.filter((f) => onlyIds.includes(f.id)) : FEATURES;
  const out: FeatureOut[] = [];
  // keep previously-captured features when running a subset
  let prior: FeatureOut[] = [];
  try { prior = (await import("file://" + join(ROOT, "remotion", "walkthrough.data.js"))).default.features; } catch { /* first run */ }
  for (const spec of picked) {
    console.log(`[capture] ${spec.id} — ${spec.title}`);
    out.push(await runFeature(spec, 0));
  }
  const merged = [...FEATURES.map((f) => out.find((o) => o.id === f.id) ?? prior.find((p) => p.id === f.id)).filter(Boolean)] as FeatureOut[];
  const data = { capturedAt: new Date().toISOString(), baseUrl: BASE, viewport: VIEW, features: merged };
  writeFileSync(join(ROOT, "remotion", "walkthrough.data.js"), `// AUTO-GENERATED by scripts/walkthroughs/capture.ts — live-captured walkthrough data.\nexport default ${JSON.stringify(data, null, 2)};\n`);
  console.log(JSON.stringify(merged.map((f) => ({ id: f.id, skipped: f.skipped, segments: f.segments.length, error: f.error })), null, 2));
};
void run();
