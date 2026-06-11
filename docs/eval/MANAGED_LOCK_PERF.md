# Managed Lock Performance Eval

Date: 2026-06-11.

This eval records the production-target change from model-managed coordination
to runtime-managed coordination.

The original ladder intentionally exposed `propose_lock` and `release_lock` to
the model. That was useful for proving the protocol, but it is not the cheapest
production shape once the invariant is established. The production bundle now
exposes managed write tools:

- `write_locked_cells`
- `write_locked_cell_results`
- `write_locked_cell`
- `write_locked_cell_result`

The model supplies business intent, target cells, values/formulas/evidence, and
base versions. The runtime acquires the exact lock, writes with CAS, drafts when
blocked, releases in `finally`, and returns coordination evidence.

## Commands

```bash
npm run eval:managed-lock
npx tsx evals/managedLockPerf.ts --strict --real deepseek/deepseek-v4-flash --json-out docs/eval/managed-lock-performance-live.json
```

## Results

| Lane | Mode | Model calls | Agent tool calls | Model-visible coordination calls | Tool trace |
|---|---:|---:|---:|---:|---|
| Explicit lock tools | deterministic | 7 | 6 | 2 | `propose_lock -> read_range -> edit_cell -> read_range -> edit_cell -> release_lock` |
| Runtime-managed lock | deterministic | 3 | 2 | 0 | `read_range -> write_locked_cells` |
| Explicit lock tools | live `deepseek/deepseek-v4-flash` | 5 | 5 | 2 | `read_range -> propose_lock -> edit_cell -> edit_cell -> release_lock` |
| Runtime-managed lock | live `deepseek/deepseek-v4-flash` | 4 | 3 | 0 | `read_range -> write_locked_cells -> read_range` |

Both lanes passed: target values were written, no locks were leaked, and the
managed result carried `coordinationEvidence` showing the runtime acquired and
released the range lock.

## Lesson

Give the agent:

- business intent
- target cells
- values/formulas/evidence
- base versions from reads

Take away from the agent:

- lock acquisition
- unlock sequencing
- range coordination
- draft-on-blocked mechanics
- release-in-finally cleanup

The eval exists to prevent a common agent mistake: using an LLM to perform
deterministic coordination that the harness can do more cheaply and reliably.

## Verification

- `npx vitest run tests/managedLockTools.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run eval:managed-lock`
- live provider run above with `.env.local` keys loaded into the process
