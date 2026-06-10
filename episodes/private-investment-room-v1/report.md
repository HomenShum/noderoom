# Production report — private-investment-room-v1

**Rendered:** `renders/short.mp4` — 41.8s vertical, 8MB, h264 + real ElevenLabs narration.
**Machine judge: 16/16, verdict publish** (first cut — [judge.md](./judge.md)).

This is the first episode built for a specific high-trust audience (family offices / private
investment teams — `episodes/_audiences/family-office.yaml`). What that meant in practice:
- The opening scene is THEIR room: an IC prep board with targets, tiers, and owners — captured
  live with **fictional companies only** (Meridian Robotics, Caldera Therapeutics, Northwind
  Logistics, Atlas Maritime Partners). The restraint is itself the trust signal.
- Every scene answers a question this audience already asks: "who changed what?" (provenance),
  "can the agent act without sign-off?" (no — proposals), "what changed since last week?"
  (versions + undo).
- No luxury language, no hype. Quiet competence per the audience rulebook.

Scene sources: `ic-room.mp4` (new live capture, spec `ic-room`, optIn) · `review-approve.mp4`
and `sheet-undo.mp4` (reused live captures) · one closing card.

Regenerate: capture `ic-room` → `voiceover.ts` → `episode.ts` → `remotion render episode-short`.
