import type { TraceEvent } from "../engine/types";

export const SIGNAL_TAPE_MAX = 60;

export interface StatusLine {
  kind: "ok" | "warn" | "err";
  text: string;
}

export function selectPublicSignalTraces(traces: TraceEvent[], max = SIGNAL_TAPE_MAX): TraceEvent[] {
  return traces
    .filter((trace) => trace.actor.scope !== "private")
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .slice(-max);
}

export function statusText(latest: TraceEvent | undefined, pendingProposals: number, jobStatus?: string): StatusLine {
  if (pendingProposals > 0) return { kind: "warn", text: `${pendingProposals} agent proposal${pendingProposals === 1 ? "" : "s"} awaiting review` };
  if (jobStatus && !["completed", "cancelled"].includes(jobStatus)) return { kind: jobStatus === "failed" ? "err" : "warn", text: `Long-running job ${jobStatus}` };
  if (!latest) return { kind: "ok", text: "Room ready - no committed events yet" };
  if (/denied|conflict|blocked|failed/i.test(latest.type)) return { kind: "warn", text: latest.summary };
  return { kind: "ok", text: latest.summary };
}
