import { describe, expect, it } from "vitest";
import { scanConvexBoundarySource } from "../src/eval/convexBoundaryPolicy";

describe("convex boundary policy", () => {
  it("flags query writes", () => {
    const violations = scanConvexBoundarySource(`
      export const bad = query({
        handler: async (ctx) => {
          await ctx.db.insert("logs", {});
        },
      });
    `);

    expect(violations.map((item) => item.message)).toContain("queries must be read-only; move writes/logging to a mutation");
  });

  it("flags direct db access inside actions", () => {
    const violations = scanConvexBoundarySource(`
      export const bad = action({
        handler: async (ctx) => {
          await ctx.db.get("abc");
        },
      });
    `);

    expect(violations.map((item) => item.message)).toContain("actions should persist by calling runMutation/runQuery, not ctx.db directly");
  });

  it("flags network calls inside mutations", () => {
    const violations = scanConvexBoundarySource(`
      export const bad = mutation({
        handler: async () => {
          await fetch("https://example.com");
        },
      });
    `);

    expect(violations.map((item) => item.message)).toContain("mutations should not call external networks; move provider work to an action");
  });

  it("follows local helpers called by Convex handlers", () => {
    const violations = scanConvexBoundarySource(`
      function writeLog(ctx) {
        return ctx.db.insert("logs", {});
      }

      export const bad = query({
        handler: async (ctx) => writeLog(ctx),
      });
    `);

    expect(violations.map((item) => item.message)).toContain("queries must be read-only; move writes/logging to a mutation");
  });

  it("allows action-side network work", () => {
    const violations = scanConvexBoundarySource(`
      export const ok = action({
        handler: async (ctx) => {
          const response = await fetch("https://example.com");
          await ctx.runMutation(internal.write, { ok: response.ok });
        },
      });
    `);

    expect(violations).toEqual([]);
  });

  it("allows action runQuery/runMutation orchestration", () => {
    const violations = scanConvexBoundarySource(`
      export const ok = action({
        handler: async (ctx) => {
          const row = await ctx.runQuery(internal.read, {});
          await ctx.runMutation(internal.write, { row });
        },
      });
    `);

    expect(violations).toEqual([]);
  });

  it("requires receipts for job-scoped domain mutations", () => {
    const violations = scanConvexBoundarySource(`
      export const bad = mutation({
        args: { jobId: v.optional(v.id("agentJobs")) },
        handler: async (ctx, a) => {
          await ctx.db.insert("nodes", { createdByJobId: a.jobId });
        },
      });
    `);

    expect(violations.map((item) => item.message)).toContain("agent domain mutations with jobId must write an agentMutationReceipts row");
  });
});
