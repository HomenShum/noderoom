# NodeRoom Open Design Redesign Contract

## Goal

Use `nexu-io/open-design` as a reference-contract system for the NodeRoom
redesign. The goal is not to reskin NodeRoom. The goal is to create a durable
visual and interaction contract that makes the product cleaner, more useful, and
more credible for finance diligence demos.

Target artifact: production NodeRoom web app, especially the fresh room,
startup diligence room, banker coach, spreadsheet/artifact work surface, chat
refs, and downstream handoff flow.

Audience: bankers, startup banking teams, analysts, reviewers, founders, and
conference/demo viewers who need to understand collaborative AI diligence
quickly.

## Evidence Used

| Source | What was used | Confidence |
|---|---|---|
| `nexu-io/open-design` README, commit `8895fe7` | Agentic design loop: brief, direction, artifact, critique, deliver. `DESIGN.md` as brand contract. | observed |
| Open Design `skills/reference-design-contract` | Required outputs: `DESIGN.md`, `design-contract.md`, `implementation-handoff.md`; keep/change/do-not-copy discipline. | observed |
| Open Design `design-systems/notion` | Calm workspace, warm neutrals, quiet borders, object/block structure. | observed |
| Open Design `design-systems/duolingo` | Progress, completion, habit-loop mechanics; intentionally not the playful styling. | observed |
| Open Design `design-systems/airtable` | Dense structured tables, sticky headers, structured fields, approachable data UI. | observed |
| Open Design `design-systems/trading-terminal` | Finance data density and high-signal state color; intentionally not terminal aesthetics. | observed |
| Open Design `design-systems/agentic` | Minimal controls, delegated task flow, clear outcomes. | observed |
| Open Design `design-systems/perplexity` | Source-backed research, quiet citations, dark credible reading surface. | observed |
| Quadratic official site | AI spreadsheet positioning: explainable and shareable insights from connected data. | observed |
| Attio official site and docs | AI CRM/object model and workflows. AI embedded in records/lists rather than bolted on. | observed |
| Existing NodeRoom docs and UI files | Current design system, benchmark, RoomShell, Artifact, Chat, banker coach direction. | observed |

## Keep, Change, Do Not Copy

| Reference | Keep | Change | Do not copy |
|---|---|---|---|
| Open Design | `DESIGN.md` contract, artifact-first loop, critique/handoff discipline. | Use as process and contract, not as product shell. | Do not copy Open Design home/studio UI or branding. |
| Notion | Calm workspace, object/block readability, progressive disclosure. | Make it more operational and stateful for diligence. | Do not make NodeRoom feel like a blank notes app. |
| Quadratic | Spreadsheet-native AI, explainable analysis, data/code/result adjacency. | Replace code focus with evidence/proposal/source focus. | Do not turn NodeRoom into only a spreadsheet. |
| Attio | Company/object intelligence, workflow state, AI fields in context. | Use for diligence objects, not full CRM complexity. | Do not surface CRM navigation in the main room. |
| Duolingo | Progress clarity, short task loops, completion feedback. | Make it quiet and professional. | No mascots, streak pressure, XP, cartoon buttons, or consumer-game energy. |
| Airtable | Structured table craft and approachable data density. | Add finance-grade provenance and review gates. | Do not use colorful base/table aesthetics everywhere. |
| Trading terminal | High-signal financial state and tabular density. | Calm it down for collaborative review. | Do not make the product look like Bloomberg/Eikon. |
| Figma | Multiplayer presence tied to exact object position. | Apply to artifacts, cells, evidence, and agent locks. | Do not import full design-tool toolbar complexity. |
| Perplexity | Source-backed answers and quiet citation behavior. | Make citations persistent inside artifacts, not answer-page endpoints. | Do not make research output disappear into chat. |

## Final Design Stance

NodeRoom should be a calm multiplayer diligence workspace where the AI makes the
next useful action obvious, evidence is always inspectable, and progress through
the workflow is visible without adding more controls. The surface should look
credible enough for JPM middle market/startup banking diligence, but lively
enough that users understand agents are actively working in the room.

## Product Workflow To Preserve

1. Fresh room and joining process.
2. Multi-user chat context.
3. Company/file intake.
4. Agent evidence gathering.
5. Artifact/spreadsheet/report updates.
6. Banker coach review.
7. Human approval or rejection.
8. Export/downstream handoff.

Learning/adaptation should improve prioritization, defaults, source ranking,
and visual emphasis. It must not silently change the workflow spine.

## Design Risks

- Too many controls remain visible because they are technically available.
- Command palette becomes a hiding place for complexity instead of subtraction.
- Duolingo reference is misread as gamification instead of progress clarity.
- Finance density becomes terminal cosplay.
- Coach/evidence behavior becomes another side panel instead of the trust layer.
- Downstream integrations appear before they are actionable.
- Chat refs fail silently or point to stale artifacts.

## Explicit Unknowns

- Final brand palette is not locked beyond the current NodeRoom terracotta accent.
- Final light-mode stance is not resolved.
- Whether a full generated Open Design HTML prototype should be created is open.
- Whether Open Design MCP/CLI should be installed locally is open; not required
  for the contract.

## Quality Gate

- Resting demo room has roughly 12 to 14 visible controls.
- No command palette is required to understand the core workflow.
- Banker coach evidence opens side-by-side with the source artifact.
- Proposal refs in chat open the target artifact or show an honest stale-ref error.
- Workflow progress is visible from intake through export.
- Any visible warning is actionable.
- Downstream handoff appears only after a draft/export exists.
- Every chart or diligence claim has inspectable provenance.
- Mobile layout has no horizontal overflow.
- No text overlaps or overflows compact controls.
- `prefers-reduced-motion` is respected.
