import "./benchmark/loadEnv";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MODEL_EVAL_SCENARIOS,
  SUPPORTED_MODEL_ROUTES,
  buildModelEvalCommands,
  resolveRouteSet,
  scenariosForSuite,
  type ModelEvalSuite,
} from "./benchmark/modelEvalConfig";

type Plan = {
  generatedAt: string;
  suite: ModelEvalSuite | "all";
  routeSet: string;
  routes: string[];
  scenarios: typeof MODEL_EVAL_SCENARIOS;
  commands: ReturnType<typeof buildModelEvalCommands>;
};

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function optionNumber(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionSuite(): ModelEvalSuite | "all" {
  const raw = optionValue("--suite") ?? "all";
  if (raw === "all" || raw === "research" || raw === "collaboration") return raw;
  throw new Error(`Unsupported --suite=${raw}; expected all, research, or collaboration`);
}

function shellQuote(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function printPlan(plan: Plan): void {
  console.log(`model eval matrix · suite=${plan.suite} · routeSet=${plan.routeSet}`);
  console.log(`routes (${plan.routes.length}): ${plan.routes.join(", ")}`);
  console.log(`scenarios (${plan.scenarios.length}):`);
  for (const scenario of plan.scenarios) {
    console.log(`  - ${scenario.id}: ${scenario.gate}`);
  }
  console.log("commands:");
  for (const command of plan.commands) {
    console.log(`  ${command.id}: ${command.command} ${command.args.map(shellQuote).join(" ")}`);
    console.log(`    writes: ${command.writes.join(", ")}`);
  }
}

function writePlan(path: string, plan: Plan): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(plan, null, 2));
  console.log(`wrote ${path}`);
}

function runPlan(plan: Plan): number {
  const allowFailures = process.argv.includes("--allow-failures");
  let failures = 0;
  for (const command of plan.commands) {
    console.log(`\n>>> ${command.command} ${command.args.map(shellQuote).join(" ")}`);
    const child = spawnSync(command.command, command.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    if ((child.status ?? 1) !== 0) {
      failures++;
      console.error(`command ${command.id} exited ${child.status}`);
      if (!allowFailures) return child.status ?? 1;
    }
  }
  return failures > 0 && !allowFailures ? 1 : 0;
}

function main(): void {
  const suite = optionSuite();
  const routeSet = optionValue("--routes") ?? optionValue("--route-set") ?? "supported";
  const routes = resolveRouteSet(routeSet, suite);
  const plan: Plan = {
    generatedAt: new Date().toISOString(),
    suite,
    routeSet,
    routes,
    scenarios: scenariosForSuite(suite),
    commands: buildModelEvalCommands({
      suite,
      routeSet,
      companies: optionNumber("--companies"),
      modelTimeoutMs: optionNumber("--model-timeout-ms"),
      modelReserveMs: optionNumber("--model-reserve-ms"),
      rowHardTimeoutMs: optionNumber("--row-hard-timeout-ms"),
      rungTimeoutMs: optionNumber("--rung-timeout-ms"),
      rungReserveMs: optionNumber("--rung-reserve-ms") ?? optionNumber("--reserve-ms"),
    }),
  };
  if (process.argv.includes("--list-routes")) {
    for (const route of SUPPORTED_MODEL_ROUTES) {
      console.log(`${route.route}\t${route.promotion}\t${route.suites.join(",")}\t${route.notes}`);
    }
    return;
  }
  printPlan(plan);
  const jsonOut = optionValue("--json-out");
  if (jsonOut) writePlan(jsonOut, plan);
  if (process.argv.includes("--live")) process.exitCode = runPlan(plan);
}

main();
