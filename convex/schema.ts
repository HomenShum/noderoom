/**
 * NodeRoom Convex schema — the production contract behind the in-memory engine.
 *
 * The spike runs on RoomEngine (deterministic, no keys); production persists the
 * SAME shapes here and streams them via reactive queries. Every collaborative
 * field is keyed so the lock/CAS/draft/idempotency logic ports directly:
 *   - elements carry a `version` (per-element CAS baseline)
 *   - changeOps carry an `opId` (idempotency) + `baseVersion` (CAS)
 *   - messages carry a `clientMsgId` (idempotent send + optimistic reconcile)
 *   - locks carry an element-id list (the affected range)
 *
 * Convex's internal OCC alone does NOT prevent stale-baseline clobber — the
 * per-element `version` + the application-level CAS check is what does (see the
 * `applySpreadsheetDelta`/`applyCellEdit` pattern). New fields ship `v.optional`.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const actor = v.object({
  kind: v.union(v.literal("user"), v.literal("agent")),
  id: v.string(),
  name: v.string(),
  scope: v.optional(v.union(v.literal("public"), v.literal("private"))),
  ownerId: v.optional(v.string()),
});

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    title: v.string(),
    hostId: v.string(),
    autoAllow: v.boolean(),
    status: v.union(v.literal("live"), v.literal("ended")),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  members: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    role: v.union(v.literal("host"), v.literal("member")),
    anon: v.boolean(),
    color: v.string(),
    authToken: v.optional(v.string()),
    authTokenHash: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    lastSeenAt: v.number(),
  }).index("by_room", ["roomId"]),

  artifacts: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("sheet"), v.literal("note"), v.literal("wall")),
    title: v.string(),
    version: v.number(),
    order: v.array(v.string()),
    updatedAt: v.number(),
    meta: v.optional(v.any()),
  }).index("by_room", ["roomId"]),

  /** One row per element (cell / block / sticky) — the CAS unit. */
  elements: defineTable({
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    version: v.number(),
    value: v.any(),
    updatedAt: v.number(),
    updatedBy: actor,
  }).index("by_artifact", ["artifactId", "elementId"]),

  /** The lock tool — an affected range made read-only for non-holders. */
  locks: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementIds: v.array(v.string()),
    holder: actor,
    sessionId: v.string(),
    reason: v.string(),
    status: v.union(v.literal("active"), v.literal("released")),
    createdAt: v.number(),
    /** Lease TTL — a crashed/abandoned holder's lock auto-expires so it can't block a cell forever. */
    expiresAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
  })
    .index("by_room_status", ["roomId", "status"])
    .index("by_artifact_status", ["artifactId", "status"]),

  drafts: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    author: actor,
    ops: v.array(v.object({
      opId: v.string(),
      artifactId: v.string(),
      elementId: v.string(),
      kind: v.union(v.literal("set"), v.literal("create"), v.literal("delete")),
      value: v.optional(v.any()),
      baseVersion: v.number(),
    })),
    note: v.string(),
    blockedByLockId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("merged"), v.literal("discarded"), v.literal("conflict")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_room_status", ["roomId", "status"]),

  proposals: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    op: v.any(),
    author: actor,
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_room_status", ["roomId", "status"]),

  agentSessions: defineTable({
    roomId: v.id("rooms"),
    agentId: v.string(),
    agentName: v.string(),
    scope: v.union(v.literal("public"), v.literal("private")),
    ownerId: v.optional(v.string()),
    status: v.union(v.literal("idle"), v.literal("working"), v.literal("blocked"), v.literal("drafting"), v.literal("done")),
    heldLockId: v.optional(v.string()),
    lastAction: v.string(),
    updatedAt: v.number(),
  }).index("by_room", ["roomId"]),

  messages: defineTable({
    roomId: v.id("rooms"),
    /** "public" or a private owner id. */
    channel: v.string(),
    author: actor,
    text: v.string(),
    clientMsgId: v.string(),
    kind: v.union(v.literal("chat"), v.literal("agent"), v.literal("system")),
    createdAt: v.number(),
  })
    .index("by_room_channel", ["roomId", "channel", "createdAt"])
    .index("by_clientMsgId", ["roomId", "clientMsgId"]),

  traces: defineTable({
    roomId: v.id("rooms"),
    ts: v.number(),
    actor,
    type: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
  }).index("by_room", ["roomId", "ts"]),

  /** Per-agent-run telemetry — model, steps, tool calls, tokens, cost, latency. */
  agentRuns: defineTable({
    roomId: v.id("rooms"),
    agentId: v.string(),
    model: v.string(),
    goal: v.string(),
    steps: v.number(),
    toolCalls: v.number(),
    conflictsSurvived: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    ms: v.number(),
    exhausted: v.boolean(),
    stopReason: v.optional(v.string()),
    remainingMs: v.optional(v.number()),
    deadlineAt: v.optional(v.number()),
    handoff: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]).index("by_idempotency", ["idempotencyKey", "createdAt"]),

  /** APPEND-ONLY step-level trace — the agent's full (tool · args → result) decision
   * sequence per run. The audit + trajectory-eval record: never updated, linked to a
   * run, attributed (agentId/model via the run), with the elementId a write touched
   * for per-cell provenance. `args`/`result` are JSON, size-capped (BOUND_READ). */
  agentJobs: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actor,
    goal: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("retrying"),
      v.literal("completed"),
      v.literal("blocked"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    modelPolicy: v.string(),
    runtime: v.optional(v.union(v.literal("scheduler"), v.literal("workflow"))),
    workflowId: v.optional(v.string()),
    workId: v.optional(v.string()),
    cursor: v.optional(v.any()),
    handoff: v.optional(v.any()),
    attempts: v.number(),
    maxAttempts: v.number(),
    latestRunId: v.optional(v.id("agentRuns")),
    leaseId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    finalText: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId", "updatedAt"])
    .index("by_status_nextRunAt", ["status", "nextRunAt"]),

  agentJobAttempts: defineTable({
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    attempt: v.number(),
    status: v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("failed")),
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    error: v.optional(v.string()),
    scheduledNextAt: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.number(),
  }).index("by_job", ["jobId", "attempt"]),

  spreadsheetCells: defineTable({
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    coordinate: v.string(),
    rowId: v.string(),
    columnId: v.string(),
    rowIndex: v.number(),
    colIndex: v.number(),
    rowHeader: v.string(),
    columnHeader: v.string(),
    rawValue: v.string(),
    formula: v.optional(v.string()),
    semanticSummary: v.string(),
    updatedAt: v.number(),
  })
    .index("by_artifact_element", ["artifactId", "elementId"])
    .index("by_artifact_row_col", ["artifactId", "rowIndex", "colIndex"]),

  spreadsheetChunks: defineTable({
    artifactId: v.id("artifacts"),
    chunkId: v.string(),
    rowStart: v.number(),
    rowEnd: v.number(),
    colStart: v.number(),
    colEnd: v.number(),
    elementIds: v.array(v.string()),
    text: v.string(),
    updatedAt: v.number(),
  }).index("by_artifact_chunk", ["artifactId", "chunkId"]),

  spreadsheetDependencies: defineTable({
    artifactId: v.id("artifacts"),
    parentElementId: v.string(),
    childElementId: v.string(),
    parentCoordinate: v.string(),
    childCoordinate: v.string(),
    formula: v.string(),
    updatedAt: v.number(),
  })
    .index("by_parent", ["artifactId", "parentElementId"])
    .index("by_child", ["artifactId", "childElementId"]),

  agentSteps: defineTable({
    runId: v.id("agentRuns"),
    roomId: v.id("rooms"),
    agentId: v.string(),
    idx: v.number(),
    tool: v.string(),
    args: v.string(),
    result: v.string(),
    /** Honest outcome derived from the result — never "ok" on a failed CAS (HONEST_STATUS). */
    status: v.union(v.literal("ok"), v.literal("conflict"), v.literal("locked"), v.literal("error")),
    ms: v.number(),
    ts: v.number(),
    /** Set for edit_cell steps — enables "why is this cell this value" provenance. */
    elementId: v.optional(v.string()),
    /** Tamper-evidence: SHA-256 over this record's sorted-key serialization, chained to the previous. */
    recordHash: v.string(),
    prevStepHash: v.string(),
  })
    .index("by_run", ["runId", "idx"])
    .index("by_room_element", ["roomId", "elementId"]),
});
