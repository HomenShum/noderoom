# Episode brief — noderoom-live-collab-v1

**Title:** I Tried to Make a Demo GIF for a Spreadsheet Agent. It Turned Into a Multiplayer AI Workspace.

**Thesis:** The agent filling cells was not the hard part. The hard part was letting humans and
agents mutate the same shared artifact safely — locks, versions, drafts, review.

**Core viewer feeling:** "I thought this was an AI spreadsheet demo, but live collaboration
state is the real engineering problem."

**Audience:** AI builders · product engineers · technical founders · agent-workflow people.

**Visual promise:** naive demo → conflict → code diff → lock/draft/merge mental model →
working multi-user/agent room → the proof pipeline that generated the video itself.

**Technical claims (every one must point at evidence):**
| Claim | Evidence |
|---|---|
| Agent edits ride the same versioned CAS path as humans | `convex/artifacts.ts` `applyCellEditCore` · `tests/roomEngine.test.ts` |
| Same-cell concurrent edits converge, loser reverts honestly | 3-user eval Act 4 (`e2e/three-user-collab.spec.ts`) |
| Review mode turns agent writes into in-context proposals | `docs/walkthroughs/review-approve.gif` (live capture) · FRICTION_LOG 0/3 entry |
| The demo clips are reproducible from a versioned spec | `scripts/walkthroughs/specs.ts` → `remotion/walkthrough.data.js` |

**Required captures:** already produced by the walkthrough pipeline (`docs/walkthroughs/*.{gif,mp4}`).
**Staged (not yet buildable):** the *naive-version failure replay* needs a `v0-naive` git tag or a
staged fixture room — logged in storyboard as `staged: true`. Motion-canvas mental-model scene and
ElevenLabs voiceover are interface-defined in `storyboard.yaml` but not wired.
