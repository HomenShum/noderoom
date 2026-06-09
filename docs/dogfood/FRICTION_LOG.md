# Friction log — append-only

Format (Stripe practice, Google stoplight — see [INTUITIVENESS_QA.md](./INTUITIVENESS_QA.md) §3B):
log **while doing a real task**, never retrospectively. Every entry must end as a filed issue
or a written won't-fix reason.

> 🟢 delightful / worked first try · 🟡 frustrating, found a way · 🔴 would have given up if this weren't my job

---

## 2026-06-09 — Convention-parity sweep (persona: close-review host + GTM list owner)

**Context:** first run of the intuitiveness instrument; code-level sweep against the
muscle-memory benchmark (Excel/Sheets, Slack, Docs, HubSpot).

| Stoplight | Moment | Expected (because…) | What happened | Disposition |
|---|---|---|---|---|
| 🟢 | Esc mid-cell-edit | Excel: Esc cancels | Cancels, restores prior value | — |
| 🟡 | Enter on cell commit | Excel: commit + move down | Commits, stays put | Won't-fix for 5-row sheet; revisit on bigger grids |
| 🟡 | ↑ in chat composer | Slack: edits my last message | Nothing; must hover → pencil | Fix queued |
| 🟡 | Paste a 3×2 range onto the sheet | Sheets: fills 6 cells | Single-cell input only | Defer — research import is the bulk path (reason logged) |
| 🔴 | Made a bad edit, want it back | Sheets: Ctrl+Z | No undo anywhere; hand-revert | Fix queued — versions already exist server-side, surface them |
| 🔴 | Approve the agent's proposed cell edit | Docs: Accept sits next to the change | Must scan the bottom activity strip, find it, approve | Fix queued — in-context approve chip at the cell; keep strip for "Accept all" |
| 🔴 | Re-paste the same account list | HubSpot: updates existing records | Creates `acme_1` duplicate rows | Fix queued — dedupe by company key on import |
