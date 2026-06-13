export type IntakeDecisionKind =
  | "command"
  | "steering_patch"
  | "parallel_subagent"
  | "wait"
  | "clarification"
  | "note"
  | "cancel"
  | "priority_change";

export type SurfaceRef = {
  artifactId: string;
  elementIds?: string[];
  visibility?: "public" | "private";
};

export type IntakeDecision = {
  kind: IntakeDecisionKind;
  goal: string;
  requiresModel: boolean;
  mutating: boolean;
  priority: "low" | "normal" | "high";
  reason: string;
};

export type PlanPreviewInput = {
  decision: IntakeDecision;
  targetArtifacts: string[];
  intendedReadSet?: string[];
  intendedWriteSet?: string[];
  formulaDependencies?: Record<string, string[]>;
  chartDependencies?: Record<string, string[]>;
  memoDependencies?: Record<string, string[]>;
  activeHumanEdits?: string[];
  activeAgentClaims?: string[];
  pendingProposals?: string[];
  privateRefs?: SurfaceRef[];
  estimatedCostUsd?: number;
  authorizedCostUsd?: number;
  allowFormulaOverwrite?: boolean;
  formulaCells?: string[];
};

export type PlanPreview = {
  targetArtifacts: string[];
  readSet: string[];
  writeSet: string[];
  expandedAffectedSet: string[];
  conflicts: Array<{ kind: "human_edit" | "agent_claim" | "pending_proposal" | "privacy" | "formula" | "budget"; ref: string; detail: string }>;
  scheduling: "run_now" | "draft_first" | "wait_for_human" | "request_authorization" | "blocked";
  cost: { estimatedUsd: number; authorizedUsd: number };
  evidencePolicy: "required";
};

export function classifyIntakeMessage(raw: string): IntakeDecision {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (/^(cancel|stop|abort)\b/.test(lower)) return decision("cancel", text, false, true, "User asked to stop active work.");
  if (/^(wait|pause|hold)\b/.test(lower)) return decision("wait", text, false, false, "User asked the harness to wait.");
  if (/^(priority|urgent|rush)\b/.test(lower)) return decision("priority_change", text, false, false, "User changed scheduling priority.", "high");
  if (/^(note|memo):/.test(lower)) return decision("note", text.replace(/^[^:]+:\s*/i, ""), false, false, "User added room context.");
  if (/\b(parallel|subagent|split this|fan out)\b/.test(lower)) return decision("parallel_subagent", text, true, true, "User requested parallelized agent work.");
  if (/\b(instead|actually|revise|change the plan|steer)\b/.test(lower)) return decision("steering_patch", text, true, true, "User is steering an existing or planned job.");
  if (/\?$/.test(text) && !/^\/(ask|free)\b/i.test(text)) return decision("clarification", text, true, false, "Question can be answered before mutating room state.");
  return decision("command", text.replace(/^\/(?:ask|free)\s*/i, ""), true, true, "Default room command.");
}

export function buildPlanPreview(input: PlanPreviewInput): PlanPreview {
  const readSet = unique(input.intendedReadSet ?? []);
  const writeSet = unique(input.intendedWriteSet ?? []);
  const expanded = expandAffectedSet(writeSet, [
    input.formulaDependencies ?? {},
    input.chartDependencies ?? {},
    input.memoDependencies ?? {},
  ]);
  for (const read of readSet) if (!expanded.includes(read)) expanded.push(read);

  const conflicts: PlanPreview["conflicts"] = [];
  for (const ref of input.activeHumanEdits ?? []) if (overlaps(ref, expanded)) conflicts.push({ kind: "human_edit", ref, detail: "Human has an active local edit in the affected set." });
  for (const ref of input.activeAgentClaims ?? []) if (overlaps(ref, expanded)) conflicts.push({ kind: "agent_claim", ref, detail: "Another agent already claims this affected set." });
  for (const ref of input.pendingProposals ?? []) if (overlaps(ref, expanded)) conflicts.push({ kind: "pending_proposal", ref, detail: "A pending proposal already targets this work." });
  for (const ref of input.privateRefs ?? []) conflicts.push({ kind: "privacy", ref: ref.artifactId, detail: "Private artifact reference cannot be used in a public plan." });
  for (const ref of input.formulaCells ?? []) {
    if (!input.allowFormulaOverwrite && writeSet.includes(ref)) conflicts.push({ kind: "formula", ref, detail: "Formula cell write requires explicit formula replacement policy." });
  }

  const estimated = input.estimatedCostUsd ?? 0;
  const authorized = input.authorizedCostUsd ?? 0;
  if (estimated > authorized) conflicts.push({ kind: "budget", ref: "cost", detail: `Estimated $${estimated.toFixed(4)} exceeds authorized $${authorized.toFixed(4)}.` });

  return {
    targetArtifacts: unique(input.targetArtifacts),
    readSet,
    writeSet,
    expandedAffectedSet: expanded,
    conflicts,
    scheduling: schedulingFor(conflicts, input.decision),
    cost: { estimatedUsd: estimated, authorizedUsd: authorized },
    evidencePolicy: "required",
  };
}

function decision(kind: IntakeDecisionKind, goal: string, requiresModel: boolean, mutating: boolean, reason: string, priority: IntakeDecision["priority"] = "normal"): IntakeDecision {
  return { kind, goal, requiresModel, mutating, priority, reason };
}

function expandAffectedSet(seeds: string[], dependencyMaps: Array<Record<string, string[]>>): string[] {
  const out = unique(seeds);
  const queue = [...out];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const map of dependencyMaps) {
      for (const next of map[cur] ?? []) {
        if (out.includes(next)) continue;
        out.push(next);
        queue.push(next);
      }
    }
  }
  return out;
}

function schedulingFor(conflicts: PlanPreview["conflicts"], decision: IntakeDecision): PlanPreview["scheduling"] {
  if (decision.kind === "wait") return "wait_for_human";
  if (decision.kind === "cancel") return "blocked";
  if (conflicts.some((c) => c.kind === "privacy" || c.kind === "formula")) return "blocked";
  if (conflicts.some((c) => c.kind === "budget")) return "request_authorization";
  if (conflicts.some((c) => c.kind === "human_edit" || c.kind === "agent_claim" || c.kind === "pending_proposal")) return "draft_first";
  return "run_now";
}

function overlaps(ref: string, affected: string[]) {
  return affected.includes(ref);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
