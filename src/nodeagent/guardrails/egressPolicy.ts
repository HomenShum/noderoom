type Env = Record<string, string | undefined>;

export type ProviderEgressArtifact = {
  title?: string;
  kind?: string;
  meta?: unknown;
};

export type ProviderEgressEntrypoint = "public_ask" | "private_agent" | "free" | "system" | "automation";

export type ProviderEgressDecision =
  | { ok: true; policy: "provider_egress_v1" }
  | { ok: false; policy: "provider_egress_v1"; reason: string; artifactTitle?: string };

export function isOpenRouterFreeRoute(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "openrouter/free-auto" || normalized === "openrouter/free" || normalized.endsWith(":free");
}

export function isExternalProviderRoute(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !!normalized && !normalized.startsWith("local/") && normalized !== "local" && normalized !== "none";
}

export function providerEgressDecision(args: {
  model: string;
  entrypoint: ProviderEgressEntrypoint;
  artifacts: ProviderEgressArtifact[];
  env?: Env;
}): ProviderEgressDecision {
  const env = args.env ?? process.env;
  const external = isExternalProviderRoute(args.model);
  const freeRoute = isOpenRouterFreeRoute(args.model) || args.entrypoint === "free";
  if (!external) return { ok: true, policy: "provider_egress_v1" };

  for (const artifact of args.artifacts) {
    const risk = classifyArtifactEgress(artifact);
    if (risk.explicitBlock) {
      return blocked("explicit_local_only", artifact);
    }
    if (risk.sensitive) {
      return blocked("sensitive_artifact", artifact);
    }
    if (freeRoute && risk.fileDerived && env.OPENROUTER_FREE_ALLOW_FILE_EGRESS !== "1") {
      return blocked("free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS", artifact);
    }
    if (freeRoute && risk.providerDerived && env.OPENROUTER_REQUIRE_NO_TRAINING !== "1") {
      return blocked("free_provider_parse_requires_OPENROUTER_REQUIRE_NO_TRAINING", artifact);
    }
  }

  return { ok: true, policy: "provider_egress_v1" };
}

export function assertProviderEgressAllowed(args: {
  model: string;
  entrypoint: ProviderEgressEntrypoint;
  artifacts: ProviderEgressArtifact[];
  env?: Env;
}): ProviderEgressDecision {
  const decision = providerEgressDecision(args);
  if (!decision.ok) {
    throw new Error(`provider_egress_blocked:${decision.reason}`);
  }
  return decision;
}

function classifyArtifactEgress(artifact: ProviderEgressArtifact): {
  explicitBlock: boolean;
  sensitive: boolean;
  fileDerived: boolean;
  providerDerived: boolean;
} {
  const meta = objectRecord(artifact.meta);
  const privacy = objectRecord(meta?.privacy);
  const document = objectRecord(meta?.document);
  const upload = objectRecord(meta?.upload);
  const providerParse = objectRecord(meta?.providerParse);
  const egress = stringValue(privacy?.egress ?? meta?.egress ?? meta?.egressPolicy);
  const sensitivity = stringValue(privacy?.sensitivity ?? meta?.sensitivity ?? meta?.classification);
  const parser = stringValue(document?.parser);
  const status = stringValue(document?.status);
  const requiredRuntime = Array.isArray(document?.requiredRuntime) ? document.requiredRuntime.map((v) => String(v).toLowerCase()) : [];

  return {
    explicitBlock: egress === "blocked" || egress === "local_only" || egress === "no_external_provider",
    sensitive: sensitivity === "private" || sensitivity === "restricted" || sensitivity === "sensitive",
    fileDerived: !!upload || !!providerParse || parser === "provider" || status === "server_parser_required" || requiredRuntime.includes("ocr"),
    providerDerived: !!providerParse || parser === "provider",
  };
}

function blocked(reason: string, artifact: ProviderEgressArtifact): ProviderEgressDecision {
  return { ok: false, policy: "provider_egress_v1", reason, artifactTitle: artifact.title };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
