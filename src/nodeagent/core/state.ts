import type { AgentResult, AgentStopReason } from "./types";

export type NodeAgentRunPhase = "idle" | "running" | "handoff" | "done" | "error";

export interface NodeAgentRunState {
  phase: NodeAgentRunPhase;
  stopReason?: AgentStopReason;
  exhausted: boolean;
}

export function phaseForStopReason(stopReason?: AgentStopReason): NodeAgentRunPhase {
  if (!stopReason) return "running";
  if (stopReason === "done") return "done";
  if (stopReason === "error") return "error";
  return "handoff";
}

export function deriveRunState(result?: Partial<AgentResult> | null): NodeAgentRunState {
  if (!result) return { phase: "idle", exhausted: false };
  return {
    phase: phaseForStopReason(result.stopReason),
    stopReason: result.stopReason,
    exhausted: result.exhausted === true,
  };
}
