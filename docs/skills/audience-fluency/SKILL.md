# Audience Fluency Skill

description: Build culturally fluent proof artifacts for specific high-trust audiences before producing README demos, videos, GIFs, posts, or interview narratives. Use when translating NodeRoom features into family-office, GTM, finance, founder, wealth-advisor, M&A, or other professional workflow scenes.

## Thesis

Recognition before persuasion. The artifact should show that NodeRoom understands the room it belongs inside: the people, documents, decisions, anxieties, privacy expectations, and review rituals. Do not start from "AI fills a spreadsheet." Start from a real workflow where time, trust, discretion, provenance, and control matter.

## Required Stages

1. **audience-fluency-research**
   - Read or cite current audience-facing sources: reports, event agendas, job guides, public interviews, buyer materials, or workflow documentation.
   - Output or update `episodes/_audiences/<audience>.yaml`.

2. **client-world-map**
   - Map people, meetings, artifacts, decisions, anxieties, and hidden coordination pain.
   - Output a short `world_map.md` section in the episode brief or linked docs.

3. **scenario-translator**
   - Translate one NodeRoom feature into a client-world scene.
   - Example: "agent proposal review" becomes "advisor prepares a memo, AI suggests a cell change, host reviews it at the cell before the principal sees it."

4. **lexicon-miner**
   - Mine vocabulary that sounds native without becoming jargon cosplay.
   - Prefer terms like `principal`, `advisor`, `investment committee`, `diligence memo`, `capital call`, `governance`, `audit trail`, `provenance`, and `discretion`.
   - Avoid cheap luxury signals like `elite`, `premium`, `VIP`, `luxury AI`, yachts, jets, watches, or generic wealth theater.

5. **trust-signal-check**
   - Verify the artifact shows review before action, source provenance, sensitive-context awareness, restrained language, and clear caveats.
   - If a capability is staged, label it staged in the brief.

6. **cultural-fluency-eval**
   - Score the output on context accuracy, language fluency, status restraint, trust awareness, decision relevance, and proof quality.
   - Run `npm run content:fluency:check` for deterministic repository checks.

## Required Artifact Shape

Every audience-specific episode must include:

- an `episodes/_audiences/<audience>.yaml` file with cultural values, repeated questions, recognizable artifacts, product mapping, language to use/avoid, required trust signals, and sources;
- an episode `brief.md` that references that audience file;
- a concrete high-trust scenario;
- a product-proof mapping table from scene beats to existing app evidence;
- explicit caveats for staged or not-yet-built capabilities;
- no private, real client, or sensitive data in fixtures or media.

## Current Canonical Example

- Audience context: `episodes/_audiences/family-office.yaml`
- Audience research guide: `episodes/_audiences/README.md`
- Episode brief: `episodes/private-investment-room-v1/brief.md`
- Generic proof episode: `episodes/noderoom-live-collab-v1/report.md`

The family-office/private-investment lane is intentionally yellow until an audience-specific rendered episode exists and passes a video/content judge.
