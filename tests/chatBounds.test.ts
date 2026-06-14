import { describe, it, expect, beforeEach } from "vitest";
import { driverFor, privateStreamDrivers } from "../src/ui/Chat";

// C1/BOUND regression: `privateStreamDrivers` is a module-level Map that survives every unmount and
// room navigation. Each private agent reply mints a fresh streamId, so without eviction it grows for
// the life of the tab. These tests pin the cap and prove eviction never touches a live stream.

describe("private stream driver registry is bounded (Chat.tsx C1/BOUND)", () => {
  beforeEach(() => privateStreamDrivers.clear());

  it("stays <= 64 across 200 completed private streams (sustained-use scenario)", () => {
    // Maya keeps one room tab open all afternoon and fires the private NodeAgent 200 times; each
    // reply finishes and nothing is reading it any more.
    for (let i = 0; i < 200; i++) {
      driverFor(`stream_${i}`).status = "done";
    }
    expect(privateStreamDrivers.size).toBeLessThanOrEqual(64);
  });

  it("never evicts an active stream even under heavy churn", () => {
    const active = driverFor("active");
    active.status = "streaming";
    active.listeners.add(() => {});
    for (let i = 0; i < 200; i++) driverFor(`s_${i}`).status = "done";
    expect(privateStreamDrivers.has("active")).toBe(true);
    expect(privateStreamDrivers.size).toBeLessThanOrEqual(64);
  });

  it("keeps a finished driver that still has a mounted reader", () => {
    const read = driverFor("done_but_read");
    read.status = "done";
    read.listeners.add(() => {}); // a component is still displaying its final text
    for (let i = 0; i < 200; i++) driverFor(`x_${i}`).status = "done";
    expect(privateStreamDrivers.has("done_but_read")).toBe(true);
  });
});
