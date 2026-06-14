export { model, priceRun, isTransientError, retryBackoffMs } from "./adapter";
export type { AgentModel, AgentStep, TokenUsage } from "../core/types";
import { OPENROUTER_FREE_AUTO_MODEL } from "./openRouterFreeModels";
export {
  OPENROUTER_FREE_META_MODEL,
  discoverOpenRouterFreeModels,
  isOpenRouterFreeAutoModel,
  rankOpenRouterFreeModels,
  selectOpenRouterFreeModels,
  type OpenRouterFreeModelMode,
  type OpenRouterModelInfo,
  type RankedOpenRouterModel,
} from "./openRouterFreeModels";

export const OPENROUTER_MODEL_PREFIX = "openrouter/";

export function normalizeOpenRouterModel(modelName: string): string {
  if (!modelName) return OPENROUTER_FREE_AUTO_MODEL;
  return modelName.startsWith(OPENROUTER_MODEL_PREFIX) ? modelName : `${OPENROUTER_MODEL_PREFIX}${modelName}`;
}