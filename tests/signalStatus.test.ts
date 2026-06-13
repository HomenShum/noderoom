import { describe, expect, it } from "vitest";
import type { TraceEvent } from "../src/engine/types";
import { selectPublicSignalTraces, SIGNAL_TAPE_MAX, statusText } from "../src/ui/signalStatus";

function trace(id: string, ts: number, scope?: "public" | "private"): TraceEvent {
  return {
    id,
    roomId: "room",
    ts,
    actor: { kind: "agent", id: `agent-${id}`, name: `Agent ${id}`, scope },
    type: "agent_status",
    summary: `${id} summary`,
  };
}

describe("signal status selectors", () => {
  it("filters private agent traces before building the public strip", () => {
    const traces = [trace("public", 1, "public"), trace("private", 2, "private")];

    expect(selectPublicSignalTraces(traces).map((t) => t.id)).toEqual(["public"]);
  });

  it("caps signal traces and keeps deterministic newest-first membership", () => {
    const traces = Array.from({ length: SIGNAL_TAPE_MAX + 5 }, (_, i) => trace(`t${i}`, i, "public"));

    const selected = selectPublicSignalTraces(traces);

    expect(selected).toHaveLength(SIGNAL_TAPE_MAX);
    expect(selected[0].id).toBe("t5");
    expect(selected.at(-1)?.id).toBe(`t${SIGNAL_TAPE_MAX + 4}`);
  });

  it("does not invent a green success when no trace exists", () => {
    expect(statusText(undefined, 0)).toEqual({ kind: "ok", text: "Room ready - no committed events yet" });
  });
});
