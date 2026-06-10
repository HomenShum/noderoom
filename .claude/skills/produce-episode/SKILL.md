---
name: produce-episode
description: Produce an evidence-backed software explainer episode from a storyboard — demo video, README GIF + MP4, code-diff story, before/after product narrative. Use when the user asks for a demo video, an explainer, an episode, social/YouTube cuts of a feature, or "turn this change into content". Builds on the readme-walkthroughs skill (capture layer) and the episodes/ manifest structure.
---

# Produce Episode

Turn the repo's real engineering into an evidence-backed explainer. An episode is a structured
artifact (`episodes/<id>/`), never an ad-hoc recording. The recurring story grammar:

> I tried to make X → the demo exposed Y → so I built Z → old behavior → the code → the mental
> model → the new behavior → the proof artifact generated from this repo.

## Inputs
- `episodes/$ARGUMENTS/brief.md` — thesis, audience, claims-with-evidence table
- `episodes/$ARGUMENTS/storyboard.yaml` — ordered scenes; each has `type`, `status: ready|staged`,
  `narration`, `source` (for ready scenes) and `evidence` (always)

## Hard rules
- **Never invent product behavior.** Every claim grounds in: a code path, a git diff, a live
  capture, a test result, or fixture data. The brief's claims table is the contract.
- **No secrets/tokens/real customer data** in any frame or output. Captures use fresh
  throwaway rooms (`GIF-*` codes) on deterministic seeds.
- **Capture the failure before the fix when possible** (`failure_capture` scenes). If a failure
  can't be reproduced honestly, mark the scene `staged` — do not fake it.
- Deterministic fixtures over live external data; live-LLM scenes get `retries` + fresh rooms.

## Procedure (what runs TODAY)
1. Read `brief.md` + `storyboard.yaml`; verify every `ready` scene's `source` and `evidence` exist.
2. Capture layer: `npm run walkthroughs [featureIds]` — the readme-walkthroughs skill owns this
   (specs → live capture → `remotion/walkthrough.data.js`). Respect all its pitfalls.
3. Render layer: `npm run walkthroughs:render` — emits BOTH `docs/walkthroughs/<id>.gif`
   (two-pass palette, ≤10MB) and `<id>.mp4` (H.264, the episode/social source material).
4. Proof pack: README "Watch it work" section embeds the GIFs; the storyboard's ready-scene MP4s
   are the cut list for a 60s vertical/short edit.
5. Quality gate before calling it done: all `ready` sources exist on disk · no secrets visible in
   frames · every claim in brief.md still points at real evidence · GIFs within size budget ·
   the app still runs (live-DOM check).
6. Write `episodes/$ARGUMENTS/report.md`: which scenes rendered, which are staged and why, sizes,
   evidence links.

## Staged stages (interfaces defined, NOT yet built — do not pretend they ran)
- `failure-replay`: drive the SAME spec against a `v0-*` git tag in a worktree to record the
  naive version failing. Needs tags or a fixture flag that disables the guard being demoed.
- `code-zoom`: extract the 20–40 relevant lines per `code_diff` scene, animate old→new with
  callouts in a Remotion code panel.
- `motion-diagram`: Motion Canvas vector scenes for `motion_canvas` beats (lock→draft→merge).
- `voiceover-elevenlabs`: narration.mp3 + timings.json from the scenes' `narration` fields, then
  a timing-reconciliation pass (lengthen holds or split scenes, never rush narration).
- `publish-pack`: per-platform copy (YouTube/LinkedIn/X/README) from the same brief — same truth,
  different frequency.

## v1 acceptance (the milestone this skill exists for)
One command-chain produces, from a deterministic scenario:
`docs/walkthroughs/<feature>.gif` + `<feature>.mp4` + the README snippet — all regenerable, all
evidence-linked. That exists today for the 5 NodeRoom features; the episode cut (60s short) is
assembled from the ready-scene MP4s.
