# Excel paper — rendering uploaded workbooks like the actual file

**Design rule: Excel skin, NodeRoom skeleton.** The grid is a pure VIEW over `art.elements`; every
edit travels `{elementId, baseVersion}` through `commit() → applyEdit` exactly like every other
sheet. The renderer never owns truth, so no amount of visual fidelity work can regress CAS, locks,
drafts, or release semantics.

Prior art:
- Google Sheets / Excel co-editing — the presence grammar (colored range outline + name flag)
  users already know; NodeRoom's collab states map onto it 1:1 instead of inventing chips
- Notion / Linear — light "paper" documents embedded in dark app chrome
- SheetJS SSF — the number-format grammar `src/app/numberFormat.ts` implements a tested subset of

## The two layers

| Layer | What | Where |
|---|---|---|
| Skin (render-only) | Light paper, A1 headers, file numFmts/styles/widths/merges, formula bar | `ExcelGridSheet` in `src/ui/panels/Artifact.tsx`, `.xl-*` in `styles.css` |
| Skeleton (untouched) | Locks, CAS versions, drafts, proposals, release | `src/engine/roomEngine.ts` — zero changes for any of this work |

### Style layer contract (captured at upload, BOUNDED)

`meta.excelGrid` carries: `styles` (per-cell `{f,b,i,u,a,bg,fc,ind,bt,bb}`, **non-default cells
only**, 4k-entry cap), `numFmts` (dictionary, 64 cap), `colWidths` (chars→px), `merges` (200 cap,
ranges >1k cells ignored). Capture: `captureCellStyle` in `src/app/spreadsheetParser.ts`.
A pathological workbook degrades to unstyled rendering — never to an unbounded meta blob.

Number formats render via `formatExcelNumber` (General, decimals, grouping, percent, currency,
accounting parens, quoted literal suffixes). Unknown formats fall back to the raw value — an
unsupported format must never silently misrender a number. Font color: the FILE's explicit color
wins; dark fills without one get the light-ink luminance heuristic.

### Collab states in the Sheets presence grammar

| Engine truth | Rendering |
|---|---|
| Lock held by other | Holder-colored inset outline; ONE name flag per lock (`data-testid="lock-flag"`); cell read-only |
| CAS conflict | Shared `onError` feedback (same path as every sheet) |
| Cell version + provenance | Formula bar (`v{n} · evidence`) for the SELECTED cell — where Excel puts metadata |
| Agent formula | Formula bar text; the grid shows the formatted value |

## Proof

`e2e/excel-grid.spec.ts` uploads a styled workbook live: `0.0%` renders `33.7%`, bold white-on-blue
merged section header spans 3 columns (covered cells absorbed), formula bar follows selection, and
an inline edit lands as v2 with the write in the room trace. Unit: `tests/numberFormat.test.ts`,
style-layer case in `tests/spreadsheetParser.test.ts`.

## Known residuals (honest scope)

- **Lock-flag e2e** — the rendering is code-identical to the proven `lockedByOther` path, but no
  UI flow locks an *uploaded* sheet yet; e2e coverage lands with the Collaborate-mode modeling
  eval, where the agent locks uploaded-sheet ranges live.
- **Frozen panes** — not captured; row/column headers are already sticky, which covers the common
  finance-model case (frozen header rows).
- **Calc engine** — none, by design. Formulas display from the file's cached results; agent-written
  formulas show in the formula bar. Recompute belongs to the agent/eval lane, not the renderer.

## Grid-engine contingency (Phase 4) — verdict 2026-06-11

The DOM table + paging handles the current bar (L5's 600-row sheet). A grid engine is adopted
ONLY on a measured perf failure, not aesthetics. Contingency ranking, revised after primary-source
checks (npm registry + GitHub API, 2026-06-11):

1. ~~Glide Data Grid~~ → **demoted.** Effectively in maintenance mode: last stable npm release
   6.0.3 (stable channel frozen since ~2024), alphas stopped 2025-10, last repo commit 2026-01-21
   (an unpublished alpha bump + two small fixes), 122 open issues, no credible community fork
   (top fork: 5 stars). The code is mature and MIT — existing users aren't broken — but adopting
   it NEW means owning patches on a frozen dependency with no React-19-stable release. Its
   `highlightRegions` API remains the best lock-outline design reference.
2. **Univer** (Apache-2.0) — very active (13k★, daily pushes), React 19 peer, native range
   protection. Cost: MB-scale bundle + inverted ownership (you sync into ITS model). Pick only if
   we also want its formula engine.
3. **react-data-grid** (MIT) — active, 15kB, textbook controlled `rows`/`onRowsChange`. Cost:
   no range selection; range overlays + all Excel chrome are DIY (we've now built most of that
   chrome ourselves anyway, which weakens the case for any swap further).

Revisit trigger: interaction latency >100ms or scroll jank on a real uploaded workbook at the
20k-cell artifact cap, measured in the responsive-QA e2e.
