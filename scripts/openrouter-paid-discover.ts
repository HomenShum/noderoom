import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
};

const args = process.argv.slice(2);
const limit = Number(optionValue("--limit") ?? 25);
const jsonOut = optionValue("--json-out") ?? "docs/eval/openrouter-top-paid-tools-snapshot.json";
const url = "https://openrouter.ai/api/v1/models?sort=top-weekly&supported_parameters=tools";

const response = await fetch(url, {
  headers: {
    "HTTP-Referer": "https://github.com/HomenShum/noderoom",
    "X-Title": "NodeRoom benchmark route audit",
  },
});

if (!response.ok) {
  throw new Error(`OpenRouter model discovery failed: ${response.status} ${response.statusText}`);
}

const body = await response.json() as { data?: OpenRouterModel[] };
const models = (body.data ?? [])
  .filter((model) => pricePerMillion(model.pricing?.prompt) > 0 || pricePerMillion(model.pricing?.completion) > 0)
  .slice(0, limit)
  .map((model, index) => ({
    rank: index + 1,
    id: model.id,
    name: model.name ?? model.id,
    contextLength: model.context_length ?? 0,
    inputPerMillionUsd: pricePerMillion(model.pricing?.prompt),
    outputPerMillionUsd: pricePerMillion(model.pricing?.completion),
    supportsTools: model.supported_parameters?.includes("tools") === true,
    supportsToolChoice: model.supported_parameters?.includes("tool_choice") === true,
    supportsStructuredOutputs: model.supported_parameters?.includes("structured_outputs") === true,
    supportedParameters: model.supported_parameters ?? [],
  }));

const snapshot = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: url,
  selection: {
    sort: "top-weekly",
    supportedParameters: ["tools"],
    paidOnly: true,
    limit,
  },
  modelCount: models.length,
  models,
};

writeJson(jsonOut, snapshot);
console.log(`wrote ${jsonOut}`);
console.log(`OpenRouter paid tool-capable snapshot: ${models.length} model(s)`);

function pricePerMillion(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? Number((parsed * 1_000_000).toFixed(6)) : 0;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
