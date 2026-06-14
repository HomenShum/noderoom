import type { AgentMessage } from "./types";

export interface NodeAgentMemoryEntry {
  role: AgentMessage["role"];
  content: string;
  ts: number;
}

export function createMemory(entries: NodeAgentMemoryEntry[] = []): NodeAgentMemoryEntry[] {
  return [...entries].sort((a, b) => a.ts - b.ts);
}

// BOUND: cap retained memory so a long-running agent loop cannot grow it without limit (OOM guard).
const MAX_MEMORY_ENTRIES = 200;

export function appendMemory(memory: NodeAgentMemoryEntry[], entry: Omit<NodeAgentMemoryEntry, "ts"> & { ts?: number }) {
  const ts = entry.ts ?? Date.now();
  const next: NodeAgentMemoryEntry = { ...entry, ts };
  const last = memory[memory.length - 1];
  // Fast path: entries normally arrive in chronological order, so skip the O(n log n) re-sort.
  const merged = last && ts < last.ts ? [...memory, next].sort((a, b) => a.ts - b.ts) : [...memory, next];
  return merged.slice(-MAX_MEMORY_ENTRIES);
}

export function latestAssistantText(memory: NodeAgentMemoryEntry[]): string | undefined {
  return [...memory].reverse().find((entry) => entry.role === "assistant" && entry.content.trim())?.content;
}
