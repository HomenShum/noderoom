# Private NodeAgent v2 — "Everyone has a copilot in the room"

> Status: **SHIPPED (v2.2)** — built, deployed, and verified on https://noderoom.live. The public lane
> (edit the shared sheet + post public chat as your personal agent), the 🔒/🌐 composer toggle, and the
> subtle attribution (owner-tinted avatar, `via {name}` chip, cell provenance dot) are live. Prod-verified:
> the personal agent filled a shared variance cell **and** posted a `via Maya` public reply.
>
> **v2.2 adds (this wave):** agents (Room + personal) now edit **every artifact type — notes, the post-it
> wall, and any sheet — not just the variance sheet** (kind-routed JIT context + `edit_cell` create/set/
> delete on the same CAS spine). New rooms seed the full **sheet + note + wall** trio. Room-switch
> isolation is hardened + documented (see [ROOM_SWITCH_ISOLATION.md](./ROOM_SWITCH_ISOLATION.md)).
> Prod-verified: the Room agent appended a `Q3 takeaways` section to a NOTE and added two post-its to a
> WALL via `kind:"create"`. The deeper **private-draft-then-merge** path (agent drafts privately, you
> promote) remains the next step.

## 1. The bigger idea
Today a room has humans + **one shared Room agent**. v2 makes it humans + the shared Room agent +
**each person's own agent**. Your agent reads the whole room, works for *you*, and — when you say so —
acts in the shared room: edits the spreadsheet and/or speaks in public chat. The differentiator is
**curation**: the private lane replies privately; the Room lane acts publicly
through the shared job/CAS/proposal path; private artifact draft-then-merge is
still not shipped. Many agents and many humans touch one artifact, and the
lock → draft → smart-merge (CAS) spine keeps it clobber-free.

## 2. Three lanes for your agent
1. **Advise (private)** — *(shipped)* reads the room, replies only to you. Default.
2. **Edit the shared artifact (public)** — *(new)* on your command it changes the shared sheet through the
   **same lock/draft/CAS path** the Room agent uses. Respects room policy:
   - auto-allow **off** → it files a **proposal** (you/host approve → it applies). Safe default.
   - auto-allow **on** → it commits directly, CAS-guarded (no clobber).
   Every change is attributed to *your* agent (carries `ownerId`).
3. **Reply in public chat** — *(new)* on your command it posts to public chat as your agent. Or you
   **Promote** any private draft (message) to public with the existing button.

**The promote bridge:** private draft (message or proposed edit) → you click Promote/Approve → it goes
public, attributed to you. Nothing your agent does becomes public without your nod (unless auto-allow).

## 3. Visual design — subtle, not noisy (product-designer rules)
The risk: N personal agents + 1 Room agent + N humans on one sheet = attribution soup. Fix = **lean on
color + tiny markers; never banners.**
- **Color = identity.** Each human already has an avatar color. Their personal agent inherits a *tinted*
  version of that color. The shared Room agent keeps the fixed brand accent (orange ◆). Glance test:
  orange = the room's agent; a person-tinted ◆ = that person's agent.
- **Agent vs human:** agents keep the ◆ marker; a personal agent's ◆ is in the owner's tint.
- **A personal agent acting in public:** the public chat bubble gets a small, muted **"via {Name}"** chip
  (e.g. "via Maya") — one line, quiet, not a badge wall.
- **Cell provenance (subtle):** keep the existing post-edit glow. Add a tiny **provenance dot** in the
  actor's color on just-changed cells (human = their color, Room agent = orange, personal agent = owner
  tint). Visible on hover + in the trace — not a permanent loud badge. Sheet stays clean.
- **Your panel gets a lane control:** a small segmented **🔒 Private / 🌐 Room** toggle on the private
  composer. Default Private. Pick Room and the send button quietly notes it will act in the room.
- **Restraint:** no flashing, no thick colored borders, no per-message banners. Color tint + small chips
  + hover tooltips + the trace carry all attribution.

## 4. No-clobber guarantees (unchanged spine, more actors)
- Every public edit (human, Room agent, personal agent) goes through CAS + lock → draft → smart-merge.
- Personal-agent public edits use the **same** `applyAgentCellEdit` / proposal path → conflicts surface,
  nothing is silently overwritten, and `agentSteps`/traces stay tamper-evident with `ownerId` attribution.
- Concurrency stays provable by the same multi-user eval (now extended to personal agents).

## 5. Build phases
- **P1 — public lane (edit):** generalize the agent runner so the private actor can run the tool-loop on
  the shared sheet (reuse `runRoomAgent` machinery; factor a shared runner taking actor + chat channel +
  approval policy). Proposals when auto-allow off; CAS commits when on. Attribute by `ownerId`.
- **P2 — public lane (chat):** let the private agent post to public chat (attributed), + keep Promote.
- **P3 — lane control UI:** the 🔒/🌐 toggle on the private composer; route `askPrivateAgent(goal, {publish})`.
- **P4 — visual attribution:** owner-tinted agent avatars, "via {Name}" chips, cell provenance dots (CSS +
  small UI), all subtle.
- **P5 — eval:** extend the 3-user eval so a *personal* agent edits the shared sheet (proposal → approve →
  visible to all) and posts a promoted public reply, verified across all three views + screenshots.

## 6. Locked decisions (chosen)
1. **Default publicness:** **follow the room's auto-allow** — on → direct CAS commit; off → proposal you/host approve. (Same as the public Room agent.)
2. **Trigger:** **composer toggle** — a small 🔒 Private / 🌐 Room segmented switch on the private composer; default Private.
3. **Identity color:** **owner's color, lighter tint** per personal agent; the shared Room agent stays orange ◆.

## 7. Risks
- **Attribution clutter** → mitigated by the color-first, no-banner rule.
- **Cost** (more agents → more LLM calls) → public lane is explicit (opt-in per action), not automatic.
- **Backend deploy** to the shared dev deployment (affects Q3DEMO) → ship behind the same green gates.
- **Scope** → P1–P4 is the feature; P5 proves it. Private artifact *drafting with merge* is the deepest
  part; start with proposals (reuses existing review flow) before full private-draft-then-merge.
