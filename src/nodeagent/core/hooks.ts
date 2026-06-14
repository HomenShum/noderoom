import { useMemo } from "react";
import type { AgentResult } from "./types";
import { deriveRunState } from "./state";

export function useNodeAgentState(result?: Partial<AgentResult> | null) {
  return useMemo(() => deriveRunState(result), [result?.stopReason, result?.exhausted]);
}
