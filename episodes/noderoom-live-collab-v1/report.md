# Production report — noderoom-live-collab-v1

**Rendered:** `renders/short.mp4` — 1080×1920 vertical, **54.8s**, h264 + aac (real ElevenLabs
narration muxed), 8.5MB, 1644 frames @30fps. First fully-rendered episode of the explainer
system; assembled by `scripts/walkthroughs/episode.ts` → `remotion/Episode.tsx`.

## Scene ledger
| Scene | Treatment | Source | Status |
|---|---|---|---|
| cold-open | live walkthrough video | `docs/walkthroughs/ask-agent.mp4` (real LLM run incl. thinking/lock-trace beat) | ✅ rendered |
| naive-problem | claim card (honest interim) | callouts only — no fake footage | ✅ rendered · capture staged |
| code-before-after | claim card | `convex/artifacts.ts` `applyCellEditCore` claims | ✅ rendered · code-zoom staged |
| mental-model | claim card | lock→draft→merge concepts | ✅ rendered · motion-canvas staged |
| review-mode | live walkthrough video | `docs/walkthroughs/review-approve.mp4` (live LLM proposals) | ✅ rendered |
| multiplayer-proof | live walkthrough video | `docs/walkthroughs/sheet-undo.mp4` | ✅ rendered |
| closing-thesis | claim card | thesis + "rendered from the repo" | ✅ rendered |

## Quality gate
- All ready-scene sources existed on disk before render ✅
- No secrets/real data in any frame (fresh `GIF-*` fixture rooms only) ✅
- Every claim traces to the brief's evidence table ✅
- Audio: narration present on all 7 scenes; every visual outlasts its narration (+1.2s floor) ✅
- Verified via ffprobe (streams/duration) + two rendered stills (video scene + card scene) ✅

## Machine judge (Gemini 3.5 Flash video understanding)
**Cut 3 (real code panel + animated diagram): verdict publish · 16/16** ([judge.md](./judge.md)).
The last two text-card scenes became real visuals: the code scene shows the ACTUAL guard lines
extracted from `convex/artifacts.ts` at assemble time (it can never drift from the repo), and the
mental-model scene is an animated diagram (human + agent reach the same cell → lock → draft →
review → merge). Cut 2 scored 16/16 with the failure footage; cut 1 scored 15/16.

## Failure-replay — DONE (the missing "pain" beat)
Branch `demo/v0-naive-agent` (pushed, **never merged, never deployed**): agents skip locks, CAS,
and traces in the IN-MEMORY engine only, and the naive `/ask` recomputes every cell
unconditionally. Captured deterministically via the walkthrough pipeline against a worktree dev
server (`WALKTHROUGH_BASE=http://localhost:5274 … capture.ts naive-overwrite`, spec is `optIn`).
Probe-verified before filming: Maya commits `+30.0% — Maya's manual calc` → `/ask` → silently
replaced by `+21.7%`, **zero trace of the agent's write** while its chat message claims the work.
The clip labels the naive build on screen (honesty rule). `naive-problem` scene: staged → ready.

## Deferred — with reasons, not vibes
- **failure-replay (the naive-overwrite clip):** checked history — the FIRST public commit
  (`c034223`) already ships the CAS engine; no pre-CAS version exists to replay. Needs a
  deliberately-built, clearly-labeled naive demo branch (guard disabled). Until then the
  naive-problem beat stays a claim card.
- **code-zoom / motion-canvas scenes:** interim claim cards carry the narration honestly;
  upgrading them is polish, not correctness.

## Regenerate
```
npx tsx scripts/walkthroughs/voiceover.ts noderoom-live-collab-v1   # narration (ElevenLabs)
npx tsx scripts/walkthroughs/episode.ts noderoom-live-collab-v1    # data + asset staging
npx remotion render remotion/index.ts episode-short episodes/noderoom-live-collab-v1/renders/short.mp4 --codec=h264
```
