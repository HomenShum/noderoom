# Room-switch isolation — "the agent never does stuff on the wrong room"

> Question answered: *if a user leaves room A (or switches to room B) while an agent run they triggered
> is still in flight, can the agent keep acting on the previous room in a way that breaks things or
> bleeds into the new room?* **No.** Here is exactly why, with the enforcement points.

## The guarantee
**Cross-room state bleed cannot happen.** Every Convex query, mutation, and action is parameterized and
validated against a single `roomId`; an action launched for room A can only ever read and write room A.
Switching rooms on the client tears down room A's subscriptions and mounts room B's — the two never share
mutable state. An in-flight run for A simply *finishes on A* (correctly, visible to A's members) — which
is the right behavior, not a bug.

## Three independent server-side layers (why bleed is impossible)
1. **Re-query by `roomId`.** `convex/agent.ts:runRoomAgent` starts with
   `rooms.full({ roomId: a.roomId })`. A run started for A cannot load B's state.
2. **Artifact-membership check.** It then finds the target artifact *within that room's* artifacts and
   throws `artifact_room_mismatch` if it isn't there (`convex/agent.ts`). A cross-room `artifactId` is
   rejected before any write.
3. **Tools bound at construction.** `new ConvexRoomTools(ctx, a.roomId, a.artifactId, …)` — every
   `edit_cell` / `say` / lock mutation it issues carries that fixed `roomId`
   (`convex/convexRoomTools.ts`). The write path (`applyCellEditCore`) re-checks `requireArtifactInRoom`
   and, for jobs, `job_room_mismatch` (`convex/artifacts.ts`). Free-auto job slices claim a job whose
   `roomId` is fixed (`convex/agentJobRunner.ts`), so a long job keeps editing *its own* room.

Because identity (the actor proof / agent session) and the target are both validated against the same
`roomId` on every hop, there is no code path by which room A's run mutates room B.

## Client side: what switching rooms does
- The room view is keyed by `roomId`; on switch, Convex's `useQuery` subscriptions for A close and B's
  open automatically. No A-state renders inside B.
- Per-room session keys (`noderoom:live:<CODE>`) keep identities separate per room.

## The two real (cosmetic) gaps — now closed
A fire-and-forget `/ask` or private-agent call resolves a promise after the network round-trip. If the
user left the room first, the *server* run still finishes safely on its own room, but the *client* must
not touch an unmounted component or a stale channel. Hardened in `src/ui/Chat.tsx`:
- `aliveRef` gates `setThinking(false)` in every agent call's `.finally()` — no setState-after-unmount.
- `privTimerRef` holds the memory-mode reply timer and is cleared on unmount — no post into a stale
  channel after leaving.

## Deliberately NOT built (would be over-engineering)
- A job-cancellation-on-leave subsystem or client→server abort: the run is harmless on its own room and
  cancelling invents new failure modes for zero correctness gain. A long `/free` job outliving the
  session is **intentional** — it keeps working the room it was launched for and its results are there
  when anyone returns.
- Optimistic-update try/catch wrappers: the Convex SDK already no-ops optimistic writes on a closed query.

## Proven by
- `tests/allArtifactEdits.test.ts` + the existing `e2e/three-user-collab.spec.ts` Act 6 (private-channel
  isolation across three live browser views).
- The server scoping is structural (the three layers above) and exercised by every agent run.
