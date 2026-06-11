# Finance Model Eval

This is the professional finance-modeling eval for uploaded three-statement
workbooks. It exists because a spreadsheet agent is not proven by a validator
alone: the agent must perform the workflow through the same tools a user sees
in NodeRoom.

Uploaded XLSX workbooks render as actual Excel-coordinate grids in the room:
column letters, row numbers, formulas, and cell evidence are preserved, and the
agent can read/write the same addresses (`F7`, `G18`, etc.) that the user sees.

## What Runs Now

`npm run eval:finance-model` seeds a `Your Model` sheet and runs NodeAgent
through the real in-memory room runtime:

```text
propose_lock critical forecast cells
  -> read_range current versions
  -> edit_cell linked formula payloads with CAS
  -> release_lock
  -> grade final artifact + trace
```

The default case uses an owned synthetic gold pack so traces and README media
can be committed. The local private workbook path uses the same runtime and
writes full traces under `docs/eval/finance-model-runs/`, which is gitignored.
Only the redacted summary at `docs/eval/finance-model-live.json` is committed.

## Commands

```bash
npm run eval:finance-model
npm run eval:finance-model -- --gold "C:\path\to\modeling-test.xlsx"
npx tsx evals/financeModelLive.ts --real deepseek/deepseek-v4-flash --workbook "C:\path\to\modeling-test.xlsx" --level=full --timeout-ms=420000
npm test -- tests/financeModelRuntime.test.ts
npm run workflow:trace-previews -- finance-model-solve
```

The private gold workbook can also be validated without running the agent:

```bash
npm run eval:finance-model-private -- --gold "C:\path\to\modeling-test.xlsx"
```

## Latest HALO Loop

Date: 2026-06-11.

Initial gap: the repo had a private answer-key workbook validator and a product
contract for Solve/Guide/Collaborate, but no runnable NodeAgent solve eval. That
meant we could claim the workbook was a good gold source, not that the agent
harness could actually complete the modeling workflow.

Fix:

- Added `evals/financeModelRuntime.ts` as the reusable runtime grader.
- Added `scripts/finance-model-eval.ts` and `npm run eval:finance-model`.
- Added `tests/financeModelRuntime.test.ts`.
- Added a trace-replayed GIF target, `finance-model-solve`.
- Added `evals/financeModelLive.ts` with smoke -> income -> full rungs for the
  private workbook.
- Fixed provider tool-call compatibility where blank `artifactId` should resolve
  to the primary artifact.
- Fixed the private oracle mapper: answer-key formulas are remapped by row label
  onto the actual `Your Model` sheet before the agent sees targets or the grader
  scores formulas. This prevents answer-key row drift from grading edits to
  headers or blank rows.
- Added deterministic formula-value scoring for the computable slice. The agent
  must author linked formulas; the harness computes values when all dependencies
  are visible instead of outsourcing arithmetic to the LLM.

Rerun:

- Synthetic public solve: passed, score 1.0, trace
  `docs/eval/traces/finance-model/finance_model_solve_synthetic.json`.
- Scripted private workbook solve: passed, score 1.0, workbook hash
  `3d2f577370eaf65ca35113fc185b9e78401f853bc08df1a9697c943c8f1baca2`, trace
  under the gitignored private run directory.
- Live income rung: `nex-agi/nex-n2-pro:free` passed 6/6 targets in 74.1s at
  $0.0000. It is promoted for income-statement smoke/income demos only.
- Live full rung: `deepseek/deepseek-v4-flash` passed all 16 targets in 174.8s
  at $0.0792. Latest redacted summary:
  `docs/eval/finance-model-live.json`. **This is a single live pass —
  reliability rate not yet measured.** The committed summary is one run, kept
  from a sequence of manual attempts; per the backlog promotion rule
  (`FEATURE_EVAL_BACKLOG.md`), marketing the full-solve feature requires
  >= 4/5 model-owned passes across room variants with the aggregate (not the
  best run) committed.
- Live full route boundary: `nex-agi/nex-n2-pro:free` is not promoted for full
  solve yet; one run wrote all 16 linked formulas but failed a then-overstrict
  value gate, and the corrected rerun hit an OpenRouter invalid-JSON provider
  response after lock/read. That is failure owner `provider`, not a promoted
  full-solve pass.
- Focused test: `tests/financeModelRuntime.test.ts` passed.
- Typecheck: `npm run typecheck -- --pretty false` passed.

## What It Grades

- `stoppedCleanly`: the agent finishes without exhausting the step budget.
- `lockedBeforeWrite`: the forecast cells are locked before any write.
- `writesOnlyForecastCells`: only critical forecast cells are touched.
- `allTargetsWritten`: every target forecast cell is written.
- `everyFormulaLinked`: formulas mention the required driver/assumption refs and
  required functions/tokens.
- `valueTieOutComputable`: outputs match the answer key within tolerance only
  for cells whose dependencies are visible in the compact context.
- `releasedLock`: the range is released after the write batch.
- `noAnswerKeyLeakage`: candidate-visible context never contains answer-key
  formulas.

## What Remains

- Guide mode: coach a user through the model with zero writes to answer cells.
- Collaborate mode: split income statement, cash flow statement, and balance
  sheet sections across teammates with draft-on-lock behavior.
- Route matrix: keep `deepseek/deepseek-v4-flash` as the full-solve champion
  until another cheap/free route clears the same full rung. Free routes can be
  used for smoke/income previews, not the full feature promise.
- Reliability proof: add `--runs N` aggregation (pass rate, p95 cost/time,
  per-attempt failureOwner ledger) so the champion claim measures "will it",
  not "can it ever" — see Harness Hardening in `FEATURE_EVAL_BACKLOG.md`.
