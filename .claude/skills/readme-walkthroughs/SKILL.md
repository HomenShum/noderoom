---
name: readme-walkthroughs
description: Produce animated WALKTHROUGH GIFs for the README — never static "hero shot" GIFs. Use this skill whenever the user asks for README demos, product GIFs, demo recordings, "show the feature working", marketing clips of the app, or to refresh/regenerate the walkthrough GIFs after a UI change. It drives the LIVE app with Playwright through a versioned spec, captures clean per-state frames + cursor click targets, and renders a Remotion composition with a gliding cursor, click ripple, step captions, and a progress bar. Also use it when adding a NEW feature that deserves a README demo (add a spec, capture, render, embed).
---

# README walkthroughs — captured from the live app, rendered as guided demos

## The non-negotiable bar (why this skill exists)

A hero-shot GIF (final state looping) proves nothing. A walkthrough must show, in order:
**the empty state → where the cursor clicked (with a ripple) → the loading state → the result**,
with a step caption and a progress bar, so a viewer who has never seen the app can follow it.
Loading states are first-class: an agent "thinking" beat is part of the story, never cut.

## The three-stage pipeline (all in this repo)

1. **Spec** — `scripts/walkthroughs/specs.ts`. Each feature is an ordered list of
   `capture-this-state` / `do-this-action` steps (state | click | type | key | loading |
   waitResult), each with a human caption. The spec is the versioned "tape" (VHS-style): the GIF
   is reproducible from it on every release. LLM-dependent features set `retries` — each retry
   gets a FRESH room.
2. **Capture** — `npx tsx scripts/walkthroughs/capture.ts [featureIds…]`. Playwright drives the
   live app (`WALKTHROUGH_BASE`, default https://noderoom.live) with real APIs, screenshots clean
   frames (no cursor — the cursor is rendered later), records each click target's coordinates,
   and emits `remotion/walkthrough.data.js` + `remotion/public/frames/<id>/NN.png`. Subset runs
   merge with previously captured features.
3. **Render** — `npm run walkthroughs:render` (or per feature:
   `npx remotion render remotion/index.ts <id> docs/walkthroughs/<id>.gif --codec=gif
   --every-nth-frame=2 --scale=0.7`). The composition (`remotion/Walkthrough.tsx`) overlays the
   browser chrome, gliding cursor, ripple, captions, progress bar, and a subtle zoom toward each
   click. Embed the GIFs in README under "Watch it work".

## Motion + render parameters (research-grounded — change only with a reason)

| Param | Value | Why (source) |
|---|---|---|
| Cursor glide | spring `{stiffness:400, damping:45, mass:1}` + overshoot clamping, ~530ms | Confident, no wobble (MagicUI SmoothCursor; Remotion spring docs) |
| Click ripple | circle scales 0→4x over 600ms, linear fade to 0 | Material ripple spec (css-tricks) |
| Cursor on click | dip to 0.85x for ~150ms | Screen Studio convention |
| Zoom on click | 1 → 1.045 toward the click point, in/out over ~800ms | Screen Studio auto-zoom is click-driven, never free-floating |
| Captions | appear instantly, exit ≤150ms | Linear's asymmetric timing |
| GIF | 15fps (`--every-nth-frame=2` @30fps), ≤20s per feature, 1–6MB target, ≤10MB hard | rekort.app + GitHub limits; GIF is the only inline-autoplay README format |
| Embed | render ~900px wide, embed with `<img width="720">` | crisp without resampling (rekort) |

## Doing the job

- **UI changed?** Re-run capture for the affected features only, then re-render those GIFs.
- **New feature?** Add a `FeatureSpec` (5–9 steps; captions tell the story, ≤9 words each; final
  state holds ~2.2s), capture, render, add a README subsection.
- **Verify before embedding** (the GIF is a claim about the product — hold it to the live-DOM
  rule): every state in the spec visible in the GIF; cursor lands ON the control; loading beat
  present for any async step; file size within budget; captions readable at embed width.
- Keep room codes random per capture (`GIF-…`) so every walkthrough starts from a genuinely
  empty state on the live backend.

## Pitfalls (paid for, don't repay)

- **One browser context per persona** — shared localStorage silently reuses the first session.
- **Never assert "X is gone" without first asserting the container exists** — negative
  predicates pass vacuously on an unrendered panel.
- **LLM features flake (~50% observed)** — that's why `retries` exist and why each attempt needs
  a fresh room; a retried room must be re-created, never reused (stale state poisons frames).
- **Screenshot AFTER a ~420ms settle** — entrance animations (msgIn .3s) smear otherwise; the
  capturer injects CSS to hide scrollbars and the tour overlay.
- **Captions live in the spec, not the composition** — the comp must stay product-agnostic so
  the method ports to any app.
