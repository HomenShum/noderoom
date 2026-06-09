import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import type { AgentStep } from "../src/agent/types";
import type { StepJournal } from "../src/agent/journal";
import { stableJournalHash } from "../src/agent/journal";

const agentStepJournalGetRef = makeFunctionReference<"query">("agentStepJournal:get") as any;
const agentStepJournalRecordRef = makeFunctionReference<"mutation">("agentStepJournal:record") as any;

export function makeConvexStepJournal(args: {
  ctx: {
    runQuery: (ref: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (ref: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  jobId: Id<"agentJobs">;
  sliceKey: string;
  inputHash?: string;
  modelName: () => string;
}): StepJournal {
  const inputHash = args.inputHash ?? args.sliceKey;
  return {
    async get(step: number) {
      return await args.ctx.runQuery(agentStepJournalGetRef, {
        jobId: args.jobId,
        sliceKey: args.sliceKey,
        step,
      }) as AgentStep | undefined;
    },
    async record(step: number, result: AgentStep) {
      await args.ctx.runMutation(agentStepJournalRecordRef, {
        jobId: args.jobId,
        sliceKey: args.sliceKey,
        step,
        model: args.modelName(),
        inputHash,
        outputHash: stableJournalHash(result),
        result,
      });
    },
  };
}
