import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import { embeddingVector } from "./embeddings";

const embeddingsClaimNextRef = makeFunctionReference<"mutation">("embeddings:claimNext") as any;
const embeddingsUpsertForSourceRef = makeFunctionReference<"mutation">("embeddings:upsertForSource") as any;
const embeddingsMarkFailedRef = makeFunctionReference<"mutation">("embeddings:markFailed") as any;

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

export const runOne = internalAction({
  args: {},
  handler: async (ctx) => {
    const job = await ctx.runMutation(embeddingsClaimNextRef);
    if (!job) return { ok: false as const, reason: "no_due_embedding_job" as const };
    try {
      const vector = embeddingVector(job.content);
      await ctx.runMutation(embeddingsUpsertForSourceRef, {
        jobId: job.jobId,
        roomId: job.roomId,
        sourceKind: job.sourceKind,
        sourceId: job.sourceId,
        sourceVersion: job.sourceVersion,
        contentHash: job.contentHash,
        provider: "local",
        model: "hashing-v1",
        dimension: vector.length,
        vector,
        visibility: job.visibility,
      });
      return { ok: true as const, sourceKind: job.sourceKind, sourceId: job.sourceId, dimension: vector.length };
    } catch (error) {
      await ctx.runMutation(embeddingsMarkFailedRef, { jobId: job.jobId, error: errorText(error) });
      return { ok: false as const, error: errorText(error) };
    }
  },
});
