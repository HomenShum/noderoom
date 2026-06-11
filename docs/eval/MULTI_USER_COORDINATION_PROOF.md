# Multi-User Coordination Proof

This proof answers a narrow production question: when multiple users and agents
touch the same room, does correctness depend on the model behaving perfectly?

The answer should be no. The production path gives the model one managed write
tool, then the runtime and Convex mutation contract own the deterministic parts:
range lock acquisition, CAS, blocked-write drafting, release cleanup, and trace
evidence.

## Run

```bash
npm run eval:multiuser-coordination
```

The command writes `docs/eval/multi-user-coordination-proof.json`.

## What It Proves

| Scenario | Invariant |
|---|---|
| Managed batch write while peers act | A peer write to a locked target cell is rejected as data, while a peer write outside the target range still succeeds. |
| Stale human write | A stale `baseVersion` returns a CAS conflict and preserves the canonical value. |
| Human-vs-human same-cell edit | Two users writing the same cell from the same base produce one winner and one conflict result, in either arrival order. |
| Blocked second agent | A second agent blocked by an active lock drafts instead of forcing a write, then smart-merges after release. |
| Managed write with stale base | The runtime releases its lock in `finally` even when the CAS write conflicts. |

Every scenario also asserts that the room ends with zero active locks.

## Why This Is The Right Layer

The model should choose business intent:

- which cells or artifact elements need to change
- the value, formula, or evidence-bearing `CellPayload`
- the base versions it read
- the short reason shown in the trace

The model should not choose coordination mechanics:

- lock acquisition
- release order
- draft creation when blocked
- range fencing
- release cleanup after error

Those mechanics are deterministic harness behavior. In production they run
through Convex mutations; in this proof they run through the in-memory
`RoomEngine` implementation of the same room contract. That lets the test run
quickly and deterministically while still testing the actual coordination
semantics: no silent clobber, no room-wide blocking, no draft bypass, and no
lock leak.

## Production Promotion Gate

This proof is necessary but not sufficient for a production guarantee. The full
promotion gate is:

1. Deterministic engine proof: `npm run eval:multiuser-coordination`.
2. Unit floor around the same helper: `tests/multiUserCoordinationProof.test.ts`.
3. Convex mutation/type floor: `npx tsc --noEmit --project convex\tsconfig.json`.
4. Browser/live Convex smoke: `E2E_LIVE=1 E2E_REQUIRE_REVIEW_MODE=1 npx playwright test e2e/three-user-collab.spec.ts --project=chromium`.
   That layer proves multiple browser sessions observe the same canonical state
   after collisions, with no duplicate final writes and no leaked locks.

The README should claim production-safe coordination only for the layers that
have passed. Browser/live Convex evidence remains a separate proof layer from
the deterministic invariant test.
