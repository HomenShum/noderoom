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

## Stage 0 — audience-world research (recognition before persuasion)
Before any scene is written, load the audience file the brief names from
`episodes/_audiences/<name>.yaml` (doctrine + fluency grid: `episodes/_audiences/README.md`).
Content has THREE layers, in order: **product proof → context recognition → cultural fluency**.
The scenario comes from the audience's world (their meetings, documents, anxieties), the feature
appears INSIDE it — never the reverse. Use the audience's `lexicon_use` naturally; never the
`lexicon_avoid` words; honor every `trust_signals_required` entry in the demo itself (shown, not
narrated). Aesthetic rule: quiet competence, not loud wealth.

## Procedure (what runs TODAY)
1. Read `brief.md` + `storyboard.yaml`; verify every `ready` scene's `source` and `evidence` exist.
2. Capture layer: `npm run walkthroughs [featureIds]` — the readme-walkthroughs skill owns this
   (specs → live capture → `remotion/walkthrough.data.js`). Respect all its pitfalls.
3. Render layer: `npm run walkthroughs:render` — emits BOTH `docs/walkthroughs/<id>.gif`
   (two-pass palette, ≤10MB) and `<id>.mp4` (H.264, the episode/social source material).
4. Proof pack: README "Watch it work" section embeds the GIFs; the storyboard's ready-scene MP4s
   are the cut list for a 60s vertical/short edit.
5. Voiceover (WIRED): `npx tsx scripts/walkthroughs/voiceover.ts <episodeId>` — ElevenLabs TTS per
   scene narration → `voiceover/<scene>.mp3` + `timings.json`, then the reconciliation pass
   (a scene's visual must outlast its narration +0.5s; >12s narration → split the scene).
   Key resolves env → `.env.local` → `../nodebench-ai/.env.local`; never print or commit it.
6. Quality gate before calling it done: all `ready` sources exist on disk · no secrets visible in
   frames · every claim in brief.md still points at real evidence · GIFs within size budget ·
   the app still runs (live-DOM check).
6b. **Video judge (WIRED)**: `npx tsx scripts/walkthroughs/judge-video.ts <episodeId> [renders/x.mp4]`
   — Gemini video understanding watches the actual render and scores 8 dimensions (state clarity,
   caption sync, pacing, audio, legibility, proof-feel, safety, restraint) with timestamped
   defects → `judge.md`/`judge.json`. P0 defects block publishing; P1 fix before posting; P2 log
   and ship (do NOT enter a re-render polish loop for P2s — the judge said publish).
7. **Trust-signal check** (for audience-targeted episodes): does the demo SHOW sensitive-context
   awareness (fixture data, fresh rooms)? source provenance? review-before-action? Does it avoid
   wealth stereotypes, imprecise language, and overclaiming?
8. **Cultural-fluency eval** — score 0–2 each, evidence required: context accuracy (would this
   scenario happen in their world?) · language fluency (native, not forced) · status restraint
   (no cheap luxury signaling) · trust awareness (privacy/discretion/review addressed) · decision
   relevance (real decisions, not generic productivity) · proof quality (credible evidence shown).
   Anything scoring 0 blocks publishing.
9. Write `episodes/$ARGUMENTS/report.md`: which scenes rendered, which are staged and why, sizes,
   evidence links, trust/fluency scores.

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
