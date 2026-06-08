/**
 * Lock lease TTL — a crashed/abandoned holder's lock auto-expires so it can't block a cell forever
 * (the guide's named anti-pattern: indefinite locks). Deterministic via an injected clock.
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";

describe("lock lease TTL (no cell blocks forever)", () => {
  it("an active lock expires after the TTL and the cell becomes reclaimable by another actor", () => {
    let t = 1_000_000;
    const engine = new RoomEngine({ now: () => t });
    const d = buildDemoRoom(engine);
    const cell = "r_ni__variance";
    const holder = d.agents.room;
    const other = { ...d.agents.room, id: "other-agent", name: "Other" };

    // Holder locks the cell; another actor is correctly denied while the lease is live.
    expect(engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: [cell], holder, sessionId: "sA", reason: "editing" }).ok).toBe(true);
    expect(engine.lockFor(d.sheetId, cell)).toBeTruthy();
    expect(engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: [cell], holder: other, sessionId: "sB", reason: "edit" }).ok).toBe(false);

    // Holder crashes (never releases). Time advances past the 5-min lease TTL.
    t += 5 * 60_000 + 1;
    expect(engine.lockFor(d.sheetId, cell)).toBeUndefined(); // lease expired → treated as gone

    // The cell is reclaimable — no permanent block from a dead agent.
    expect(engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: [cell], holder: other, sessionId: "sB", reason: "edit" }).ok).toBe(true);
  });
});
