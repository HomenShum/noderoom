# Episode brief — private-investment-room-v1 (affluent lane, Episode 1)

**Audience:** `episodes/_audiences/family-office.yaml` — load it first; every scene must pass its
`trust_signals_required`.

**Title:** I Tried to Make a Spreadsheet Agent Demo. It Turned Into a Private Investment Room.

**Thesis:** High-trust decisions require provenance and discretion. An AI agent is useful in an
investment-committee room only if every output has a trace, every edit has ownership, and every
summary can be reviewed before it becomes part of the decision memory.

**Scene (recognition layer):** A family-office team reviews a private-market opportunity before
Monday's IC meeting. The diligence sheet, memo notes, and advisor comments are scattered. One
analyst updates operating metrics, another drafts the memo, the agent pulls evidence — and the
question that matters is not "can AI fill cells," it's **"who changed what, why, from which
source — and what does the principal see?"**

**Feature mapping (product proof under the scene):**
| Beat | Feature | Existing evidence |
|---|---|---|
| Two people + an agent on one diligence sheet, nobody clobbered | CAS versions + locks | 3-user eval Acts 3–4 |
| The agent must propose, not write | review mode, inline approve at the cell | `docs/walkthroughs/review-approve.mp4` (live) |
| "Where did this number come from?" | room traces + run telemetry + source-linked research cells | research enrichment captures |
| "What changed since last week?" | versioned elements + Undo | `docs/walkthroughs/sheet-undo.mp4` |
| Principal-ready one-pager | note/wiki summary from the sheet | note-edit live smoke (Q3 takeaways) |

**Tone:** quiet competence. No luxury imagery, no overclaiming. Fixture data only (fictional
companies, fictional figures) — the demo itself must demonstrate sensitive-context awareness.

**Staged:** permissioned role-views beat (principal vs advisor vs next-gen) — the permissions
surface exists for private channels/drafts but role-specific artifact views are not built; do not
imply otherwise.
