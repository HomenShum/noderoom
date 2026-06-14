export type DownstreamTarget = "gmail" | "notion" | "slack" | "linear" | "csv";
export type DownstreamDestination = "gmail" | "notion" | "slack" | "linear" | "linkedin" | "crm_csv";
export type DiligenceDownstreamDestination = DownstreamDestination;

export interface DownstreamDraft {
  target: DownstreamTarget;
  title: string;
  body: string;
  sourceArtifactIds: string[];
  status: "draft_ready" | "external_adapter_required";
}

export interface DiligencePublishInput {
  company: string;
  summary: string;
  evidenceUrls: string[];
  artifactIds: string[];
}

export interface DownstreamArtifact {
  id: string;
  title: string;
  kind: "diligence_report" | "company_row_export" | "runway_chart" | "room_recap" | string;
  body: string;
  sourceArtifactIds: string[];
  sourceUrls: string[];
  createdAt: number;
}

export interface DiligenceDownstreamDraft {
  id: string;
  destination: DownstreamDestination;
  title: string;
  body: string;
  approvalRequired: boolean;
  sourceArtifactIds: string[];
  sourceUrls: string[];
  status: "needs_approval" | "ready" | "prepared";
  createdAt: number;
}

export type DownstreamPublishDraft = DiligenceDownstreamDraft;

export interface DownstreamDraftInput {
  title: string;
  summary: string;
  bullets?: string[];
  artifactUrl?: string;
}

export interface PreparedDownstreamDraft {
  target: Exclude<DownstreamTarget, "csv">;
  title: string;
  body: string;
  ctaLabel: string;
  status: "prepared";
}

export function buildDownstreamDiligenceDrafts(input: DiligencePublishInput): DownstreamDraft[] {
  const sources = input.evidenceUrls.length ? `\n\nSources:\n${input.evidenceUrls.map((url) => `- ${url}`).join("\n")}` : "";
  const body = `${input.company} diligence update\n\n${input.summary}${sources}`;
  return [
    {
      target: "csv",
      title: `${input.company} CRM export row`,
      body,
      sourceArtifactIds: input.artifactIds,
      status: "draft_ready",
    },
    {
      target: "gmail",
      title: `Draft update: ${input.company} diligence`,
      body,
      sourceArtifactIds: input.artifactIds,
      status: "external_adapter_required",
    },
    {
      target: "notion",
      title: `${input.company} diligence page`,
      body,
      sourceArtifactIds: input.artifactIds,
      status: "external_adapter_required",
    },
  ];
}

export function prepareDownstreamDraft(target: Exclude<DownstreamTarget, "csv">, input: DownstreamDraftInput): PreparedDownstreamDraft {
  const bullets = (input.bullets ?? []).map((bullet) => `- ${bullet}`).join("\n");
  const artifactLine = input.artifactUrl ? `\n\nArtifact: ${input.artifactUrl}` : "";
  const body = `${input.summary}${bullets ? `\n\n${bullets}` : ""}${artifactLine}`.trim();
  const ctaLabel = target === "gmail"
    ? "Draft Gmail update"
    : target === "notion"
      ? "Create Notion page"
      : target === "slack"
        ? "Prepare Slack post"
        : "Prepare Linear issue";
  return {
    target,
    title: target === "gmail" ? `Draft update: ${input.title}` : input.title,
    body,
    ctaLabel,
    status: "prepared",
  };
}

export function prepareDownstreamDrafts(
  input: DownstreamDraftInput,
  targets: Array<Exclude<DownstreamTarget, "csv">> = ["gmail", "notion", "slack", "linear"],
): PreparedDownstreamDraft[] {
  return targets.map((target) => prepareDownstreamDraft(target, input));
}

export function createDiligenceDownstreamDrafts(
  artifact: DownstreamArtifact,
  destinations: DownstreamDestination[] = ["gmail", "notion", "slack", "linear", "crm_csv"],
): DiligenceDownstreamDraft[] {
  const sourceBlock = artifact.sourceUrls.length ? `\n\nSources:\n${artifact.sourceUrls.map((url) => `- ${url}`).join("\n")}` : "";
  return destinations.map((destination) => {
    const approvalRequired = destination !== "crm_csv";
    return {
      id: `${destination}_${artifact.id}_${artifact.createdAt}`,
      destination,
      title: titleForDestination(destination, artifact.title),
      body: `${artifact.body}${sourceBlock}`,
      approvalRequired,
      sourceArtifactIds: artifact.sourceArtifactIds,
      sourceUrls: artifact.sourceUrls,
      status: approvalRequired ? "needs_approval" : "ready",
      createdAt: Date.now(),
    };
  });
}

function titleForDestination(destination: DownstreamDestination, title: string): string {
  if (destination === "gmail") return `Draft Gmail update: ${title}`;
  if (destination === "notion") return `Create Notion page: ${title}`;
  if (destination === "slack") return `Draft Slack recap: ${title}`;
  if (destination === "linear") return `Create Linear follow-up: ${title}`;
  if (destination === "linkedin") return `Draft LinkedIn research note: ${title}`;
  return `Export CRM CSV: ${title}`;
}
