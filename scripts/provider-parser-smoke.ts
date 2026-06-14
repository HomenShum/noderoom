import "./benchmark/loadEnv";

const {
  hasProviderParserKey,
  providerParserModelCandidates,
  runLiveProviderParser,
  sanitizeProviderError,
} = await import("../src/nodeagent/models/providerParserLive");
import type { CanonicalFileRef } from "../src/app/providerParserAdapter";
import type { ProviderParser } from "../src/engine/types";

const providers: ProviderParser[] = parseProviders(process.argv.slice(2));
const sourceText = [
  "Account,Segment,Pipeline,Close Plan,Source",
  "ParselyFi,Enterprise,$44M,Multithread JPM workflow,parselyfy-jpm-workflow.pdf",
  "Northstar Bank,Finance,$12M,Q3 variance follow-up,sales-gtm-workflow.pptx",
].join("\n");

const file: CanonicalFileRef = {
  storageId: "convex-smoke-storage-provider-parser-001",
  artifactId: "artifact-provider-smoke-raw",
  fileName: "provider-parser-smoke.csv",
  mimeType: "text/csv",
  size: Buffer.byteLength(sourceText),
};

let failed = false;
for (const provider of providers) {
  if (!hasProviderParserKey(provider)) {
    console.log(`SKIP ${provider.padEnd(10)} missing ${keyName(provider)}`);
    continue;
  }

  let passed = false;
  for (const model of providerParserModelCandidates(provider)) {
    try {
      const started = Date.now();
      const result = await runLiveProviderParser({
        provider,
        model,
        file,
        source: { text: sourceText, bytes: Buffer.from(sourceText) },
        prompt: [
          "Extract this GTM/finance upload into one table with Account, Segment, Pipeline, Close Plan, and Source.",
          "Use evidence snippets from the source text and preserve the Convex storage id as source metadata.",
        ].join(" "),
      });
      const tableCount = result.extraction.tables?.length ?? 0;
      const rowCount = result.extraction.tables?.reduce((sum, table) => sum + table.rows.length, 0) ?? 0;
      const artifactCount = result.artifacts.length;
      if (tableCount === 0 || rowCount === 0 || artifactCount === 0) {
        throw new Error(`empty extraction: tables=${tableCount} rows=${rowCount} artifacts=${artifactCount}`);
      }
      const artifact = result.artifacts[0];
      const sourceStorageId = artifact.meta?.providerParse?.sourceStorageId;
      const providerFileId = artifact.meta?.providerParse?.providerFileId;
      if (sourceStorageId !== file.storageId) throw new Error(`source storage id mismatch: ${sourceStorageId}`);
      if (!providerFileId || providerFileId === file.storageId) throw new Error("provider file cache id was not separated");
      console.log([
        `OK   ${provider.padEnd(10)}`,
        `model=${model}`,
        `tables=${tableCount}`,
        `rows=${rowCount}`,
        `artifacts=${artifactCount}`,
        `providerFile=${providerFileId.split(":").slice(0, 2).join(":")}:...`,
        `ms=${Date.now() - started}`,
      ].join(" "));
      passed = true;
      break;
    } catch (error) {
      console.log(`FAIL ${provider.padEnd(10)} model=${model} ${sanitizeProviderError(error)}`);
    }
  }

  if (!passed) failed = true;
}

if (failed) process.exitCode = 1;

function parseProviders(args: string[]): ProviderParser[] {
  const all: ProviderParser[] = ["gemini", "openai", "anthropic", "openrouter"];
  const raw = args.find((arg) => arg.startsWith("--providers="))?.split("=")[1];
  if (!raw) return all;
  const requested = raw.split(",").map((v) => v.trim()).filter(Boolean);
  const valid = requested.filter((v): v is ProviderParser => all.includes(v as ProviderParser));
  return valid.length ? valid : all;
}

function keyName(provider: ProviderParser): string {
  switch (provider) {
    case "gemini": return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "openai": return "OPENAI_API_KEY";
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "openrouter": return "OPENROUTER_API_KEY";
    default: return String(provider);
  }
}
