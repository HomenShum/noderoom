/**
 * The deterministic scripted model — NO AI SDK import, so it's safe to bundle on
 * the client (the no-keys in-memory `/ask` + demos use it). The real model lives
 * in model.ts (which pulls the AI SDK and only runs in Node / the Convex action).
 */

import type { AgentModel, AgentStep, AgentMessage, ToolCall } from "./types";

export type ScriptStep = { say?: string; toolCalls?: { tool: string; args: Record<string, unknown> }[]; done?: boolean };
export type Planner = (ctx: { step: number; messages: AgentMessage[] }) => ScriptStep;

export function scriptedModel(planner: Planner, name = "scripted"): AgentModel {
  let step = 0;
  return {
    name,
    async next({ messages }): Promise<AgentStep> {
      const s = planner({ step: step++, messages });
      const toolCalls: ToolCall[] = (s.toolCalls ?? []).map((c, i) => ({ id: `s${step}_${i}`, tool: c.tool, args: c.args }));
      return { text: s.say, toolCalls, done: !!s.done || (toolCalls.length === 0 && !s.say) };
    },
  };
}

/** Helper for scripted planners: pull versions from the most recent read_range results. */
export function lastVersions(messages: AgentMessage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of messages) {
    if (m.role !== "tool" || m.toolName !== "read_range") continue;
    try {
      const cells = JSON.parse(m.content) as { id: string; version: number }[];
      for (const c of cells) out[c.id] = c.version;
    } catch { /* ignore */ }
  }
  return out;
}
