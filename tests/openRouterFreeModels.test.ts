import { describe, expect, it } from "vitest";
import { priceRun } from "../src/agent/model";
import { getProviderForModel, resolveModelAlias } from "../src/agent/modelCatalog";
import {
  OPENROUTER_FREE_AUTO_MODEL,
  discoverOpenRouterFreeModels,
  isFreeTextModel,
  rankOpenRouterFreeModels,
  type OpenRouterModelInfo,
} from "../src/agent/openRouterFreeModels";

const models: OpenRouterModelInfo[] = [
  {
    id: "small/no-tools:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 128_000,
    supported_parameters: ["max_tokens"],
  },
  {
    id: "qwen/qwen3-coder:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 1_048_576,
    supported_parameters: ["max_tokens", "tools", "tool_choice"],
  },
  {
    id: "openai/gpt-oss-120b:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 131_072,
    supported_parameters: ["max_tokens", "tools", "tool_choice", "reasoning"],
  },
  {
    id: "paid/model",
    pricing: { prompt: "0.1", completion: "0", request: "0" },
    context_length: 1_000_000,
    supported_parameters: ["tools"],
  },
];

describe("OpenRouter free auto routing", () => {
  it("filters to zero-priced text models", () => {
    expect(isFreeTextModel(models[0])).toBe(true);
    expect(isFreeTextModel(models[3])).toBe(false);
  });

  it("ranks tool-capable free models by capability signals", () => {
    const ranked = rankOpenRouterFreeModels(models, "agent");
    expect(ranked.map((m) => m.id)).toEqual(["qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]);
    expect(ranked[0].reasons).toContain("coding/agent specialist");
  });

  it("keeps free-auto opt-in instead of hiding it behind generic aliases", () => {
    expect(resolveModelAlias("openrouter")).toBe("kimi-k2.6");
    expect(resolveModelAlias("auto")).toBe("gemini-3.5-flash");
    expect(resolveModelAlias("free")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("free-auto")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("kimi")).toBe("moonshotai/kimi-k2.6:free");
  });

  it("treats discovered slash ids and free-auto as OpenRouter models", () => {
    expect(getProviderForModel(OPENROUTER_FREE_AUTO_MODEL)).toBe("openrouter");
    expect(getProviderForModel("nvidia/nemotron-3-super-120b-a12b:free")).toBe("openrouter");
  });

  it("reports zero cost for free routes", () => {
    expect(priceRun("openrouter/free-auto", 100_000, 10_000)).toBe(0);
    expect(priceRun("qwen/qwen3-coder:free", 100_000, 10_000)).toBe(0);
    expect(priceRun("openrouter/owl-alpha", 100_000, 10_000)).toBe(0);
  });

  it("does not mask aborted discovery as a static fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("aborted");
    };

    await expect(discoverOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      signal: controller.signal,
    })).rejects.toThrow("aborted");
  });
});
