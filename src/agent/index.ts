/** Agent harness — public surface. See docs/AGENT_RUNTIME.md. */
export * from "./types";
export { MANAGED_LOCK_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./systemPrompt";
export { buildContext, buildResearchContext } from "./context";
export { MANAGED_LOCK_TOOLS, PRODUCTION_ROOM_TOOLS, PRODUCTION_TOOL_NAMES, ROOM_TOOLS, TOOL_NAMES } from "./tools";
export { InMemoryRoomTools } from "./roomTools";
export { anthropicModel, model, priceRun } from "./model";
export {
  OPENROUTER_FREE_AUTO_MODEL,
  OPENROUTER_FREE_META_MODEL,
  discoverOpenRouterFreeModels,
  rankOpenRouterFreeModels,
  selectOpenRouterFreeModels,
} from "./openRouterFreeModels";
export type { OpenRouterFreeModelMode, OpenRouterModelInfo, RankedOpenRouterModel } from "./openRouterFreeModels";
export { scriptedModel, lastVersions } from "./scripted";
export type { ScriptStep, Planner } from "./scripted";
export { AgentRunError, runAgent } from "./runtime";
export { compactMessages, estimateChars } from "./compaction";
export type { CompactionOpts, CompactionResult } from "./compaction";
