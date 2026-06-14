export { MANAGED_LOCK_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./systemPrompt";
export { RUNWAY_DILIGENCE_SKILL, RUNWAY_DILIGENCE_SKILL_BRIEF } from "./runwayDiligence";

import { MANAGED_LOCK_SYSTEM_PROMPT } from "./systemPrompt";
import { RUNWAY_DILIGENCE_SKILL_BRIEF } from "./runwayDiligence";

export const NODEAGENT_PROMPT_SUITE = {
  system: MANAGED_LOCK_SYSTEM_PROMPT,
  finance: RUNWAY_DILIGENCE_SKILL_BRIEF,
} as const;