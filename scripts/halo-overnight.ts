import "./benchmark/loadEnv";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGitIdentity } from "../evals/gitIdentity";

type Lane = "deterministic" | "live" | "full-live" | "ui";
type StepStatus = "pass" | "fail" | "skip" | "blocked";

type StepSpec = {
  id: string;
  label: string;
  lane: Lane;
  command: string;
  args: string[];
  timeoutMs: number;
  requiresAllEnv?: string[];
  requiresAnyEnv?: string[];
  includeWhen?: () => boolean;
  skipReason?: string;
  blockedExitCodes?: number[];
  blockedReason?: string;
};

type StepEvent = {
  schema: 1;
  runId: string;
  cycle: number;
  stepId: string;
  label: string;
  lane: Lane;
  status: StepStatus;
  startedAt: string;
  completedAt: string;
  ms: number;
  exitCode: number | null;
  logPath?: string;
  reason?: string;
  stdoutTail?: string;
  stderrTail?: string;
};

type RunnerStatus = {
  schema: 1;
  runId: string;
  startedAt: string;
  updatedAt: string;
  until: string;
  sleepMinutes: number;
  dryRun: boolean;
  once: boolean;
  cycle: number;
  state: "started" | "running" | "sleeping" | "completed";
  currentStep?: string;
  currentStepStartedAt?: string;
  currentStepLogPath?: string;
  currentStepLastHeartbeatAt?: string;
  sleepUntil?: string;
  lastEvent?: Pick<StepEvent, "stepId" | "status" | "completedAt" | "logPath" | "reason">;
  summaryPath: string;
  lockPath: string;
};

type RunnerLock = {
  schema: 1;
  pid: number;
  runId: string;
  startedAt: string;
  updatedAt: string;
  until: string;
  statusPath: string;
  commandLine: string;
};

const args = process.argv.slice(2);
const dryRun = hasFlag("--dry-run");
const once = hasFlag("--once");
const skipE2e = hasFlag("--skip-e2e");
const skipLive = hasFlag("--skip-live");
const fullLive = hasFlag("--full-live");
const uiMedia = optionValue("--ui-media");
const sleepMinutes = parsePositiveNumber(optionValue("--sleep-minutes"), 30);
const until = parseUntil(optionValue("--until") ?? optionValue("--until-local"));
const runId = compactDate(new Date());
const root = process.cwd();
const runsRoot = join(root, "docs", "eval", "halo-runs");
const outDir = join(runsRoot, runId);
const logsDir = join(outDir, "logs");
const summaryPath = join(outDir, "summary.jsonl");
const manifestPath = join(outDir, "manifest.json");
const statusPath = join(outDir, "status.json");
const lockPath = join(runsRoot, ".active-run.json");
const startedAt = new Date().toISOString();
const git = readGitIdentity();
let ownsRunnerLock = false;

const steps: StepSpec[] = [
  {
    id: "typecheck",
    label: "TypeScript no-emit typecheck",
    lane: "deterministic",
    command: "npm",
    args: ["run", "typecheck"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "unit-tests",
    label: "Vitest unit/integration suite",
    lane: "deterministic",
    command: "npm",
    args: ["run", "test"],
    timeoutMs: 20 * 60_000,
  },
  {
    id: "e2e-tests",
    label: "Playwright end-to-end suite",
    lane: "deterministic",
    command: "npm",
    args: ["run", "test:e2e"],
    timeoutMs: 25 * 60_000,
    includeWhen: () => !skipE2e,
    skipReason: "disabled by --skip-e2e",
  },
  {
    id: "agent-improvement-loop",
    label: "HALO agent improvement loop",
    lane: "deterministic",
    command: "npm",
    args: ["run", "agent:improve"],
    timeoutMs: 25 * 60_000,
  },
  {
    id: "official-benchmark-promotion-gate",
    label: "Official benchmark promotion gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:official:readiness", "--", "--strict"],
    timeoutMs: 10 * 60_000,
    blockedExitCodes: [1],
    blockedReason: "official BankerToolBench/SpreadsheetBench readiness remains blocked by external benchmark prerequisites",
  },
  {
    id: "eval-diff",
    label: "Cross-commit eval regression diff",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:diff"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "qa-matrix",
    label: "QA matrix coverage check",
    lane: "deterministic",
    command: "npm",
    args: ["run", "qa:matrix:check"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "convex-boundaries",
    label: "Convex boundary check",
    lane: "deterministic",
    command: "npm",
    args: ["run", "convex:boundaries"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "architecture-budget",
    label: "Architecture budget check",
    lane: "deterministic",
    command: "npm",
    args: ["run", "architecture:budget"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "openrouter-free",
    label: "OpenRouter free-model discovery",
    lane: "live",
    command: "npm",
    args: ["run", "openrouter:free", "--", "--limit=5", "--smoke", "--agent-smoke"],
    timeoutMs: 10 * 60_000,
    requiresAllEnv: ["OPENROUTER_API_KEY"],
    skipReason: "missing OPENROUTER_API_KEY",
  },
  {
    id: "provider-parser-smoke",
    label: "Provider parser live smoke",
    lane: "live",
    command: "npm",
    args: ["run", "provider-parser:smoke"],
    timeoutMs: 10 * 60_000,
    requiresAnyEnv: ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
    skipReason: "missing provider parser API keys",
  },
  {
    id: "free-job-smoke",
    label: "Convex /free job smoke",
    lane: "live",
    command: "npm",
    args: ["run", "free-job:smoke"],
    timeoutMs: 20 * 60_000,
    requiresAnyEnv: ["CONVEX_URL", "VITE_CONVEX_URL"],
    skipReason: "missing CONVEX_URL or VITE_CONVEX_URL",
  },
  {
    id: "benchmark-v2",
    label: "Full live multi-model benchmark",
    lane: "full-live",
    command: "npm",
    args: ["run", "benchmark", "--", "--model-timeout-ms=180000", "--model-reserve-ms=15000", "--row-hard-timeout-ms=210000"],
    timeoutMs: 60 * 60_000,
    includeWhen: () => fullLive,
    requiresAnyEnv: ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
    skipReason: "pass --full-live and set at least one provider API key",
  },
  {
    id: "free-auto-ladder",
    label: "OpenRouter free-auto ladder",
    lane: "full-live",
    command: "npm",
    args: ["run", "ladder:free"],
    timeoutMs: 3 * 60 * 60_000,
    includeWhen: () => fullLive,
    requiresAllEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --full-live and set OPENROUTER_API_KEY",
  },
  {
    id: "gemini-ui-review",
    label: "Gemini UI media review",
    lane: "ui",
    command: "npm",
    args: ["run", "ui:gemini-review", "--", ...(uiMedia ? [`--media=${uiMedia}`] : [])],
    timeoutMs: 10 * 60_000,
    includeWhen: () => !!uiMedia,
    requiresAllEnv: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    skipReason: "pass --ui-media=<path> and set GOOGLE_GENERATIVE_AI_API_KEY",
  },
];

mkdirSync(runsRoot, { recursive: true });
let status: RunnerStatus = {
  schema: 1,
  runId,
  startedAt,
  updatedAt: startedAt,
  until: until.toISOString(),
  sleepMinutes,
  dryRun,
  once,
  cycle: 0,
  state: "started",
  summaryPath,
  lockPath,
};

acquireRunnerLock();
process.once("exit", () => releaseRunnerLock());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    releaseRunnerLock();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

mkdirSync(logsDir, { recursive: true });
writeJson(manifestPath, {
  schema: 1,
  runId,
  startedAt,
  until: until.toISOString(),
  sleepMinutes,
  once,
  dryRun,
  skipE2e,
  skipLive,
  fullLive,
  uiMedia,
  git,
  env: summarizeEnv(),
  steps: steps.map((step) => ({
    id: step.id,
    lane: step.lane,
    command: commandLine(step),
    timeoutMs: step.timeoutMs,
    eligible: eligibility(step).eligible,
    skipReason: eligibility(step).reason,
  })),
  summaryPath,
});

writeStatus(status);

if (dryRun) {
  for (const step of steps) {
    const eligible = eligibility(step);
    console.log(`${eligible.eligible ? "RUN " : "SKIP"} ${step.id} :: ${eligible.reason ?? commandLine(step)}`);
  }
  console.log(`manifest ${manifestPath}`);
  process.exit(0);
}

let sawFailure = false;
while (Date.now() < until.getTime()) {
  status = { ...status, cycle: status.cycle + 1, state: "running", updatedAt: new Date().toISOString() };
  writeStatus(status);
  console.log(`HALO cycle ${status.cycle} started; logs=${logsDir}`);

  for (const step of steps) {
    if (Date.now() >= until.getTime()) break;
    const event = await runStep(step, status.cycle);
    appendJson(summaryPath, event);
    status = {
      ...status,
      state: "running",
      updatedAt: new Date().toISOString(),
      currentStep: undefined,
      currentStepStartedAt: undefined,
      currentStepLogPath: undefined,
      currentStepLastHeartbeatAt: undefined,
      lastEvent: {
        stepId: event.stepId,
        status: event.status,
        completedAt: event.completedAt,
        logPath: event.logPath,
        reason: event.reason,
      },
    };
    writeStatus(status);
    if (event.status === "fail") sawFailure = true;
  }

  if (once) break;
  const remainingMs = until.getTime() - Date.now();
  if (remainingMs <= 0) break;
  const sleepMs = Math.min(sleepMinutes * 60_000, remainingMs);
  status = {
    ...status,
    state: "sleeping",
    updatedAt: new Date().toISOString(),
    currentStep: undefined,
    sleepUntil: new Date(Date.now() + sleepMs).toISOString(),
  };
  writeStatus(status);
  console.log(`HALO sleeping ${Math.round(sleepMs / 1000)}s until next cycle`);
  await sleep(sleepMs);
}

status = { ...status, state: "completed", updatedAt: new Date().toISOString(), currentStep: undefined, sleepUntil: undefined };
writeStatus(status);
console.log(`HALO overnight runner completed; summary=${summaryPath}`);
releaseRunnerLock();
if (sawFailure) process.exitCode = 1;

async function runStep(step: StepSpec, cycle: number): Promise<StepEvent> {
  const startedAt = new Date().toISOString();
  const eligible = eligibility(step);
  const logPath = join(logsDir, `cycle-${String(cycle).padStart(3, "0")}-${step.id}.log`);
  status = {
    ...status,
    state: "running",
    currentStep: step.id,
    currentStepStartedAt: startedAt,
    currentStepLogPath: logPath,
    currentStepLastHeartbeatAt: startedAt,
    updatedAt: startedAt,
  };
  writeStatus(status);

  if (!eligible.eligible) {
    const event: StepEvent = {
      schema: 1,
      runId,
      cycle,
      stepId: step.id,
      label: step.label,
      lane: step.lane,
      status: "skip",
      startedAt,
      completedAt: new Date().toISOString(),
      ms: 0,
      exitCode: null,
      reason: eligible.reason,
    };
    writeFileSync(logPath, `SKIP ${step.id}: ${eligible.reason ?? "not eligible"}\n`, "utf8");
    event.logPath = logPath;
    return event;
  }

  const startHeader = [
    `step=${step.id}`,
    `label=${step.label}`,
    `cycle=${cycle}`,
    `startedAt=${startedAt}`,
    `command=${commandLine(step)}`,
  ].filter(Boolean).join("\n");
  writeFileSync(logPath, `${startHeader}\n\n--- live output ---\n`, "utf8");

  return await new Promise<StepEvent>((resolve) => {
    let stdoutTail = "";
    let stderrTail = "";
    let errorMessage: string | undefined;
    let timedOut = false;
    const child = spawn(step.command, step.args, {
      cwd: root,
      shell: process.platform === "win32",
      env: process.env,
    });

    const heartbeat = setInterval(() => {
      const now = new Date().toISOString();
      status = {
        ...status,
        state: "running",
        currentStep: step.id,
        currentStepStartedAt: startedAt,
        currentStepLogPath: logPath,
        currentStepLastHeartbeatAt: now,
        updatedAt: now,
      };
      writeStatus(status);
      appendFileSync(logPath, `\n[heartbeat ${now}] still running\n`, "utf8");
    }, 30_000);

    const timeout = setTimeout(() => {
      timedOut = true;
      errorMessage = `timed out after ${step.timeoutMs}ms`;
      appendFileSync(logPath, `\n[timeout ${new Date().toISOString()}] ${errorMessage}; sending SIGTERM\n`, "utf8");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5_000).unref();
    }, step.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdoutTail = appendTailText(stdoutTail, text);
      appendFileSync(logPath, text, "utf8");
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrTail = appendTailText(stderrTail, text);
      appendFileSync(logPath, text, "utf8");
    });

    child.on("error", (error) => {
      errorMessage = error.message;
      appendFileSync(logPath, `\n[error ${new Date().toISOString()}] ${error.message}\n`, "utf8");
    });

    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      const completedAt = new Date().toISOString();
      const ms = Date.parse(completedAt) - Date.parse(startedAt);
      const exitCode = typeof code === "number" ? code : null;
      const blocked =
        !timedOut &&
        !errorMessage &&
        typeof exitCode === "number" &&
        exitCode !== 0 &&
        (step.blockedExitCodes ?? []).includes(exitCode);
      const failed = timedOut || Boolean(errorMessage) || (exitCode !== 0 && !blocked);
      const footer = [
        "",
        "--- result ---",
        `completedAt=${completedAt}`,
        `ms=${ms}`,
        `exitCode=${String(exitCode)}`,
        signal ? `signal=${signal}` : undefined,
        errorMessage ? `error=${errorMessage}` : undefined,
      ].filter(Boolean).join("\n");
      appendFileSync(logPath, `${footer}\n`, "utf8");
      resolve({
        schema: 1,
        runId,
        cycle,
        stepId: step.id,
        label: step.label,
        lane: step.lane,
        status: failed ? "fail" : blocked ? "blocked" : "pass",
        startedAt,
        completedAt,
        ms,
        exitCode,
        logPath,
        reason: blocked ? step.blockedReason : errorMessage,
        stdoutTail: tail(stdoutTail),
        stderrTail: tail(stderrTail),
      });
    });
  });
}

function eligibility(step: StepSpec): { eligible: boolean; reason?: string } {
  if (skipLive && (step.lane === "live" || step.lane === "full-live" || step.lane === "ui")) {
    return { eligible: false, reason: "skipped by --skip-live (deterministic-only run)" };
  }
  if (step.includeWhen && !step.includeWhen()) {
    return { eligible: false, reason: step.skipReason ?? "includeWhen returned false" };
  }
  const missingAll = step.requiresAllEnv?.filter((name) => !process.env[name]) ?? [];
  if (missingAll.length > 0) {
    return { eligible: false, reason: `missing ${missingAll.join(", ")}` };
  }
  if (step.requiresAnyEnv && !step.requiresAnyEnv.some((name) => !!process.env[name])) {
    return { eligible: false, reason: step.skipReason ?? `missing one of ${step.requiresAnyEnv.join(", ")}` };
  }
  return { eligible: true };
}

function parseUntil(raw?: string): Date {
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new Error(`invalid --until value: ${raw}`);
    return parsed;
  }
  const nextTen = new Date();
  nextTen.setHours(10, 0, 0, 0);
  if (nextTen.getTime() <= Date.now()) nextTen.setDate(nextTen.getDate() + 1);
  return nextTen;
}

function summarizeEnv() {
  const keys = [
    "CONVEX_URL",
    "VITE_CONVEX_URL",
    "OPENROUTER_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ];
  return Object.fromEntries(keys.map((key) => [key, Boolean(process.env[key])]));
}

function optionValue(name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function commandLine(step: StepSpec): string {
  return [step.command, ...step.args].join(" ");
}

function tail(text: string, max = 2_000): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : trimmed.slice(-max);
}

function appendTailText(existing: string, next: string, max = 5_000): string {
  const combined = `${existing}${next}`;
  return combined.length <= max ? combined : combined.slice(-max);
}

function appendJson(path: string, value: unknown) {
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeStatus(value: RunnerStatus) {
  writeJson(statusPath, value);
  refreshRunnerLock(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquireRunnerLock() {
  const existing = readRunnerLock();
  if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
    console.error(
      [
        "HALO runner lock is already active.",
        `pid=${existing.pid}`,
        `runId=${existing.runId}`,
        `statusPath=${existing.statusPath}`,
        "Stop that runner or wait for it to finish before starting another full loop.",
      ].join("\n"),
    );
    process.exit(2);
  }
  ownsRunnerLock = true;
  refreshRunnerLock(status);
}

function refreshRunnerLock(value: RunnerStatus) {
  if (!ownsRunnerLock) return;
  writeJson(lockPath, {
    schema: 1,
    pid: process.pid,
    runId,
    startedAt,
    updatedAt: value.updatedAt,
    until: until.toISOString(),
    statusPath,
    commandLine: ["tsx", "scripts/halo-overnight.ts", ...args].join(" "),
  } satisfies RunnerLock);
}

function releaseRunnerLock() {
  if (!ownsRunnerLock) return;
  const existing = readRunnerLock();
  if (existing?.pid === process.pid && existing.runId === runId) {
    rmSync(lockPath, { force: true });
  }
  ownsRunnerLock = false;
}

function readRunnerLock(): RunnerLock | undefined {
  if (!existsSync(lockPath)) return undefined;
  try {
    return JSON.parse(readFileSync(lockPath, "utf8").replace(/^\uFEFF/, "")) as RunnerLock;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
