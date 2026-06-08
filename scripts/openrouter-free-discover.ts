import "./benchmark/loadEnv";
import { z } from "zod";
import { judge } from "../src/agent/model";
import { model } from "../src/agent/model";
import { selectOpenRouterFreeModels } from "../src/agent/openRouterFreeModels";

const limit = parseLimit();
const smoke = process.argv.includes("--smoke");
const agentSmoke = process.argv.includes("--agent-smoke");
const candidates = await selectOpenRouterFreeModels({ mode: "agent", limit, forceRefresh: true });

console.log(`OpenRouter free-auto candidates (${candidates.length})`);
for (const [index, model] of candidates.entries()) {
  const context = model.context_length ?? model.top_provider?.context_length ?? 0;
  const params = model.supported_parameters ?? [];
  console.log([
    `${String(index + 1).padStart(2, " ")}.`,
    model.id.padEnd(46),
    `score=${model.score.toFixed(1).padStart(7, " ")}`,
    `ctx=${context}`,
    `params=${params.filter((p) => ["tools", "tool_choice", "structured_outputs", "response_format", "reasoning"].includes(p)).join(",")}`,
    `reasons=${model.reasons.slice(0, 5).join("; ")}`,
  ].join(" "));
}

if (smoke) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("SKIP smoke missing OPENROUTER_API_KEY");
  } else {
    const text = await judge("openrouter/free-auto", "Reply with exactly: OK");
    console.log(`SMOKE openrouter/free-auto -> ${JSON.stringify(text.slice(0, 80))}`);
  }
}

if (agentSmoke) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("SKIP agent smoke missing OPENROUTER_API_KEY");
  } else {
    const route = model("openrouter/free-auto");
    const res = await route.next({
      system: "You are a tool-using smoke test. When asked, call the report_answer tool exactly once.",
      messages: [{ role: "user", content: "Call report_answer with value OK." }],
      tools: [{
        name: "report_answer",
        description: "Report a short answer.",
        schema: z.object({ value: z.string() }),
        execute: async () => ({ ok: true }),
      }],
    });
    const first = res.toolCalls[0];
    console.log(`AGENT_SMOKE ${route.name} -> ${first?.tool ?? "no_tool"} ${JSON.stringify(first?.args ?? {})}`);
    if (first?.tool !== "report_answer" || String(first.args.value) !== "OK") process.exitCode = 1;
  }
}

function parseLimit(): number {
  const arg = process.argv.find((v) => v.startsWith("--limit="));
  const value = Number(arg?.split("=")[1] ?? 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 10;
}
