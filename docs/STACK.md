# NodeRoom - Library And Convex-Component Stack

Principle: do not reinvent the wheel. Every concern below maps to a popular OSS
library or an official Convex component. NodeRoom's custom code is the lock ->
draft -> smart-merge engine, the agent harness contract, and the spreadsheet
semantic/dependency index.

## Decision Matrix

| Concern | Use | Convex-native | Replaces |
|---|---|---|---|
| Reactivity + optimistic UI | Convex `useQuery` / mutations / optimistic updates | core | `RoomEngine` mirror when backend is live |
| Collaborative note | TipTap + future `@convex-dev/prosemirror-sync` | official component | `contentEditable` blocks |
| Public + private agent chat | `@assistant-ui/react` for 1:1 agent threads; custom room feed for multi-author chat | first-party fit | bespoke private assistant thread |
| Agent run loop | Current custom bounded tool harness; future `@convex-dev/agent` where it fits | official component available | scripted-only agent |
| Durable agent runs | `agentJobs` slices wrapped by `@convex-dev/workflow` with `@convex-dev/workpool` controls | wired official components | scheduler-only continuation loops |
| Rate limiting | future `@convex-dev/rate-limiter` | official component | none |
| Schema/data migrations | future `@convex-dev/migrations` | official component | manual migrations |
| Spreadsheet/grid | current simple table; TanStack Table if true grid ergonomics are needed | works with cell rows + CAS | hand table at larger scale |
| Post-it wall | `@dnd-kit/core` + modifiers | works | hand pointer math |
| Icons | `lucide-react` | n/a | unicode glyphs |
| Document parsing | provider-first multimodal extraction; LiteParse Node fallback | Node action/worker lane | ad hoc text-only parsing |

## Wired Now

- `@convex-dev/workflow` and `@convex-dev/workpool` are installed and configured in `convex/convex.config.ts`.
- `/free` creates an `agentJobs` row, starts `freeAutoWorkflow`, and runs bounded `runFreeAutoJobSlice` action steps.
- `agentJobs` remains the user-facing durable system of record. Workflow ids are runtime metadata.
- Scheduler continuation remains only for legacy `runtime="scheduler"` jobs.
- Spreadsheet artifacts now have semantic cell records, structural chunk records, and formula dependency records.
- `propose_lock` expands requested spreadsheet cells through downstream formula dependencies before granting a lock.
- Provider parser output and uploaded spreadsheets both write evidence-bearing `CellPayload`s and semantic index summaries.
- LiteParse is installed as a Node-only fallback adapter and exercised by `npm run liteparse:smoke`.

## Still Future

- Convex File Storage as the raw-file system of record for every upload.
- Provider-specific Convex Storage -> Gemini/OpenAI/Claude Files API binary upload actions.
- Production LiteParse/OCR worker deployment for Office/image conversion at scale.
- `@convex-dev/rate-limiter`, `@convex-dev/migrations`, anonymous auth, and prosemirror sync.
- Full vector embedding index for spreadsheet semantic cells/chunks; current implementation is lexical ranked retrieval over the same durable records.

## Cautions

- Do not import AI SDK or native LiteParse modules into Convex function modules. Convex actions use the direct HTTP `convexModel` adapter; LiteParse stays in a Node worker/script lane.
- Workflow action retries are disabled for `/free` slices because provider calls can double-bill. The slice runner owns attempt accounting and retry/backoff.
- Provider file ids are cache metadata. Convex storage/artifact ids remain canonical.
- CRDT/OT is right for prose notes, not spreadsheet cells. Spreadsheet writes use app-level version CAS plus affected-range locks.
- `@convex-dev/*` components are still 0.x packages. Pin versions and treat upgrades as migrations.
