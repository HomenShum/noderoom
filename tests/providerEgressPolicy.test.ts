import { describe, expect, it } from "vitest";
import {
  providerEgressDecision,
  providerRouteDecision,
} from "../src/nodeagent/guardrails/egressPolicy";

describe("provider route policy", () => {
  it("blocks providers outside the production allowlist before any HTTP request", () => {
    const decision = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "public_ask",
      env: { NODEAGENT_ALLOWED_PROVIDERS: "openrouter" },
    });

    expect(decision).toMatchObject({
      ok: false,
      policy: "provider_route_v1",
      reason: "provider_not_allowed",
      provider: "gemini",
    });
  });

  it("fails the free entrypoint closed when it is pointed at a paid model without an explicit override", () => {
    const blocked = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "free",
      env: {},
    });
    const allowed = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "free",
      env: { FREE_AUTO_ALLOW_PAID_MODEL: "1" },
    });

    expect(blocked).toMatchObject({
      ok: false,
      reason: "free_entrypoint_requires_free_model_or_FREE_AUTO_ALLOW_PAID_MODEL",
    });
    expect(allowed).toMatchObject({
      ok: true,
      provider: "gemini",
      entrypoint: "free",
    });
  });

  it("emits auditable route receipts for allowed provider calls", () => {
    const decision = providerRouteDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      env: { OPENROUTER_REQUIRE_NO_TRAINING: "1" },
    });

    expect(decision).toMatchObject({
      ok: true,
      policy: "provider_route_v1",
      provider: "openrouter",
      noTrainingRequired: true,
    });
    expect(decision.basis.join(" ")).toContain("no_training_required:true");
  });
});

describe("provider artifact egress policy", () => {
  it("blocks private-agent context when any included artifact is local-only or sensitive", () => {
    expect(providerEgressDecision({
      model: "gemini-3.5-flash",
      entrypoint: "private_agent",
      artifacts: [{ title: "Board pack", meta: { privacy: { egress: "local_only" } } }],
      env: {},
    })).toMatchObject({ ok: false, reason: "explicit_local_only" });

    expect(providerEgressDecision({
      model: "gemini-3.5-flash",
      entrypoint: "private_agent",
      artifacts: [{ title: "Comp plan", meta: { classification: "restricted" } }],
      env: {},
    })).toMatchObject({ ok: false, reason: "sensitive_artifact" });
  });

  it("blocks free-route file-derived and provider-derived artifacts unless the required policy flags are set", () => {
    const fileDerived = { title: "Uploaded OCR", meta: { document: { status: "server_parser_required" } } };
    const providerDerived = { title: "Gemini parse", meta: { providerParse: { providerFileId: "file-1" } } };

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [fileDerived],
      env: {},
    })).toMatchObject({ ok: false, reason: "free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS" });

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [providerDerived],
      env: { OPENROUTER_FREE_ALLOW_FILE_EGRESS: "1" },
    })).toMatchObject({ ok: false, reason: "free_provider_parse_requires_OPENROUTER_REQUIRE_NO_TRAINING" });

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [providerDerived],
      env: { OPENROUTER_FREE_ALLOW_FILE_EGRESS: "1", OPENROUTER_REQUIRE_NO_TRAINING: "1" },
    })).toMatchObject({ ok: true });
  });
});
