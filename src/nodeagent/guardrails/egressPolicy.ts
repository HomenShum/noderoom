import { getProviderForModel, resolveModelAlias, type LlmProvider } from "../models/modelCatalog";

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

export type ProviderRouteEntrypoint = ProviderEgressEntrypoint;
export type ProviderRouteProvider = LlmProvider | "local";
export type ProviderRouteReceipt = {
  policy: "provider_route_v1";
  requestedModel: string;
  resolvedModel: string;
  provider: ProviderRouteProvider;
  entrypoint: ProviderRouteEntrypoint;
  allowedProviders: ProviderRouteProvider[];
  noTrainingRequired: boolean;
  basis: string[];
};
export type ProviderRouteDecision =
  | ({ ok: true } & ProviderRouteReceipt)
  | ({ ok: false; reason: string; provider?: ProviderRouteProvider | null } & Omit<ProviderRouteReceipt, "provider">);

const DEFAULT_ALLOWED_PROVIDERS: ProviderRouteProvider[] = ["openai", "anthropic", "gemini", "openrouter", "local"];

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

export function providerRouteDecision(args: {
  model: string;
  entrypoint: ProviderRouteEntrypoint;
  env?: Env;
}): ProviderRouteDecision {
  const env = args.env ?? process.env;
  const requestedModel = args.model.trim();
  const resolvedModel = resolveModelAlias(requestedModel);
  const allowedProviders = providerAllowlist(env);
  const external = isExternalProviderRoute(resolvedModel);
  const provider = external ? getProviderForModel(resolvedModel) : "local";
  const noTrainingRequired = env.OPENROUTER_REQUIRE_NO_TRAINING === "1";
  const basis = [
    `entrypoint:${args.entrypoint}`,
    `requested:${requestedModel}`,
    `resolved:${resolvedModel}`,
    `external:${String(external)}`,
    `allowlist:${allowedProviders.join(",")}`,
    `no_training_required:${String(noTrainingRequired)}`,
  ];

  if (!provider) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "unknown_provider",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  if (!allowedProviders.includes(provider)) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "provider_not_allowed",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  if (
    args.entrypoint === "free" &&
    external &&
    !isOpenRouterFreeRoute(resolvedModel) &&
    env.FREE_AUTO_ALLOW_PAID_MODEL !== "1"
  ) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "free_entrypoint_requires_free_model_or_FREE_AUTO_ALLOW_PAID_MODEL",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  return {
    ok: true,
    policy: "provider_route_v1",
    requestedModel,
    resolvedModel,
    provider,
    entrypoint: args.entrypoint,
    allowedProviders,
    noTrainingRequired,
    basis,
  };
}

export function assertProviderRouteAllowed(args: {
  model: string;
  entrypoint: ProviderRouteEntrypoint;
  env?: Env;
}): ProviderRouteReceipt {
  const decision = providerRouteDecision(args);
  if (!decision.ok) {
    throw new Error(`provider_route_blocked:${decision.reason}`);
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

function providerAllowlist(env: Env): ProviderRouteProvider[] {
  const raw = env.NODEAGENT_ALLOWED_PROVIDERS ?? env.PROVIDER_EGRESS_ALLOWED_PROVIDERS;
  if (!raw) return DEFAULT_ALLOWED_PROVIDERS;
  const values = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean) as ProviderRouteProvider[];
  return values.length ? values : DEFAULT_ALLOWED_PROVIDERS;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
