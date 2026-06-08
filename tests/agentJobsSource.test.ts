import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("long-running agent job source invariants", () => {
  it("schedules continuation inside finishSlice, not after the action checkpoint returns", () => {
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");

    expect(jobs).toContain("export const finishSlice");
    expect(jobs).toContain("ctx.scheduler.runAfter(Math.max(0, a.scheduledNextAt - now)");
    expect(runner).not.toContain("ctx.scheduler.runAfter(DEFAULT_RESUME_DELAY_MS");
    expect(runner).not.toContain("ctx.scheduler.runAfter(delayMs");
  });

  it("has user-operable cancel and retry states for the featured free-auto path", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(schema).toContain('v.literal("cancelled")');
    expect(jobs).toContain("export const cancel");
    expect(jobs).toContain("export const retry");
    expect(jobs).toContain('status: "queued"');
  });

  it("starts free-auto through Convex Workflow while preserving scheduler fallback for old jobs", () => {
    const config = readFileSync("convex/convex.config.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const workflows = readFileSync("convex/agentWorkflows.ts", "utf8");

    expect(config).toContain("@convex-dev/workflow");
    expect(config).toContain("@convex-dev/workpool");
    expect(jobs).toContain('runtime: "workflow"');
    expect(jobs).toContain("start(ctx, internal.agentWorkflows.freeAutoWorkflow");
    expect(jobs).toContain('job.runtime !== "workflow"');
    expect(workflows).toContain("new WorkflowManager(components.workflow");
    expect(workflows).toContain("MAX_WORKFLOW_SLICES");
  });

  it("expands spreadsheet locks through formula dependency records", () => {
    const locks = readFileSync("convex/locks.ts", "utf8");
    const index = readFileSync("convex/spreadsheetIndexLib.ts", "utf8");

    expect(locks).toContain("expandElementIdsWithSpreadsheetDependencies");
    expect(locks).toContain("expanded to");
    expect(index).toContain("spreadsheetDependencies");
    expect(index).toContain("by_parent");
  });
});
