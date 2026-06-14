import type { RunwayMilestone, RunwayResult } from "./runwayForecaster";

export interface MilestonePlan {
  company: string;
  status: RunwayResult["status"];
  milestones: RunwayMilestone[];
  firstAction: string;
}

export function planRunwayMilestones(result: RunwayResult): MilestonePlan {
  return {
    company: result.company,
    status: result.status,
    milestones: result.milestones,
    firstAction: result.milestones[0]?.label ?? "Gather missing runway inputs",
  };
}