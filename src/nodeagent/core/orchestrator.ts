import type { AgentResult, AgentTraceEvent } from "./types";

export type NodeAgentTaskKind =
  | "interactive_chat"
  | "company_research"
  | "finance_runway"
  | "spreadsheet_edit"
  | "benchmark_eval"
  | "free_auto_long_running";

export type NodeAgentLifecycleStatus =
  | "queued"
  | "claimed"
  | "running"
  | "handoff"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface NodeAgentJobRoute {
  lane: "fast_interactive" | "workflow_slice" | "benchmark";
  convexEntrypoint: string;
  maxSliceMs: number;
  durableJobTable: "agentJobs";
}

export interface NodeAgentBatch<T> {
  index: number;
  items: T[];
  reason: string;
}

export interface NodeAgentRunReceipt {
  status: NodeAgentLifecycleStatus;
  agentResult?: Pick<AgentResult, "stopReason" | "steps" | "usage" | "handoff">;
  trace?: AgentTraceEvent[];
}

export const NODEAGENT_CONVEX_FUNCTIONS = {
  startOrReuseJob: "agentJobs.createOrReuse",
  runRoomAgent: "agent.runRoomAgent",
  runPrivateAgent: "agent.runPrivateAgent",
  runFreeAutoSlice: "agentJobRunner.runFreeAutoJobSlice",
  recordStep: "agentStepJournal.record",
  finishSlice: "agentJobs.finishSlice",
} as const;

export function routeForTask(kind: NodeAgentTaskKind): NodeAgentJobRoute {
  if (kind === "interactive_chat") {
    return {
      lane: "fast_interactive",
      convexEntrypoint: NODEAGENT_CONVEX_FUNCTIONS.runRoomAgent,
      maxSliceMs: 90_000,
      durableJobTable: "agentJobs",
    };
  }
  if (kind === "benchmark_eval") {
    return {
      lane: "benchmark",
      convexEntrypoint: NODEAGENT_CONVEX_FUNCTIONS.startOrReuseJob,
      maxSliceMs: 180_000,
      durableJobTable: "agentJobs",
    };
  }
  return {
    lane: "workflow_slice",
    convexEntrypoint: NODEAGENT_CONVEX_FUNCTIONS.runFreeAutoSlice,
    maxSliceMs: 540_000,
    durableJobTable: "agentJobs",
  };
}

export function splitBulkCompanyBatches<T>(items: readonly T[], batchSize = 8): NodeAgentBatch<T>[] {
  const size = Math.max(1, Math.floor(batchSize));
  const out: NodeAgentBatch<T>[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push({
      index: out.length,
      items: items.slice(i, i + size),
      reason: "bounded slice so Convex actions checkpoint before the runtime limit",
    });
  }
  return out;
}

export function shouldUseDurableWorkflow(kind: NodeAgentTaskKind): boolean {
  return routeForTask(kind).lane !== "fast_interactive";
}

export function splitBulkDiligence<T>(items: readonly T[], options: { batchSize?: number } = {}) {
  return splitBulkCompanyBatches(items, options.batchSize ?? 8);
}

