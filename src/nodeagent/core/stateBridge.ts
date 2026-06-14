export type PiAgentLifecycleEvent =
  | { type: "job.started"; jobId: string; at: number }
  | { type: "model.delta"; jobId: string; text: string; at: number }
  | { type: "tool.call"; jobId: string; tool: string; callId: string; at: number }
  | { type: "tool.result"; jobId: string; tool: string; callId: string; ok: boolean; at: number }
  | { type: "job.handoff"; jobId: string; reason: string; at: number }
  | { type: "job.finished"; jobId: string; ok: boolean; at: number };

export interface ConvexMutationSpec {
  module: "agentJobs" | "agentStepJournal" | "messages" | "collab";
  functionName: string;
  args: Record<string, unknown>;
}

export function toConvexMutationSpec(event: PiAgentLifecycleEvent): ConvexMutationSpec {
  if (event.type === "model.delta") {
    return { module: "messages", functionName: "postPrivateAgentReply", args: event };
  }
  if (event.type === "tool.call" || event.type === "tool.result") {
    return { module: "agentStepJournal", functionName: "record", args: event };
  }
  if (event.type === "job.handoff" || event.type === "job.finished") {
    return { module: "agentJobs", functionName: "finishSlice", args: event };
  }
  return { module: "agentJobs", functionName: "createOrReuse", args: event };
}

export const STATE_BRIDGE_BOUNDARY =
  "Pi-style lifecycle events are adapted into Convex mutations; Convex remains the durable system of record.";

export function toConvexSafeLifecycleEvent(event: { type: string; [key: string]: unknown }) {
  const { type, ...rest } = JSON.parse(JSON.stringify(event)) as { type: string; [key: string]: unknown };
  return { kind: type, payload: rest };
}

