import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

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
  state: string;
  currentStep?: string;
  currentStepStartedAt?: string;
  currentStepLogPath?: string;
  currentStepLastHeartbeatAt?: string;
  sleepUntil?: string;
  lastEvent?: {
    stepId: string;
    status: string;
    completedAt: string;
    logPath?: string;
    reason?: string;
  };
  summaryPath: string;
  lockPath?: string;
};

type StepEvent = {
  stepId: string;
  label: string;
  lane: string;
  status: string;
  startedAt: string;
  completedAt: string;
  ms: number;
  exitCode: number | null;
  reason?: string;
};

type ProcessInfo = {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string;
};

type SupervisorState = {
  schema: 1;
  pid: number;
  updatedAt: string;
  until: string;
  pollSeconds: number;
  fullLive: boolean;
  skipE2e: boolean;
  state: string;
  activeRunId?: string | null;
  activePid?: number | null;
  activePidAlive?: boolean | null;
};

const root = process.cwd();
const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const requireSupervisor = args.includes("--require-supervisor");
const record = args.includes("--record");
const runsRoot = join(root, "docs", "eval", "halo-runs");
const lockPath = join(runsRoot, ".active-run.json");
const routerLadderPath = join(root, "docs", "eval", "free-auto-router-ladder.json");
const supervisorLogPath = join(runsRoot, "supervisor.log");
const supervisorStatePath = join(runsRoot, "supervisor-state.json");
const statusSnapshotsPath = join(runsRoot, "status-snapshots.jsonl");
const generatedAt = new Date();

const lock = readJson<RunnerLock>(lockPath);
const status = lock?.statusPath ? readJson<RunnerStatus>(lock.statusPath) : undefined;
const latestEvents = status?.summaryPath ? readJsonlTail<StepEvent>(status.summaryPath, 6) : [];
const activePidAlive = lock ? isProcessAlive(lock.pid) : false;
const routerLadder = fileInfo(routerLadderPath);
const supervisorLogTail = readTextTail(supervisorLogPath, 6);
const supervisorState = readJson<SupervisorState>(supervisorStatePath);
const supervisorProcesses = listSupervisorProcesses(supervisorState);
const activeProcessTree = lock ? listProcessTree(lock.pid) : [];
const sleepUntil = status?.sleepUntil ?? inferSleepUntil(status);
const freshnessEvidence = describeFreshnessEvidence(status, activePidAlive, activeProcessTree);

const report = {
  schema: 1,
  generatedAt: generatedAt.toISOString(),
  recordedPath: record ? rel(statusSnapshotsPath) : undefined,
  activeLock: lock
    ? {
        path: rel(lockPath),
        pid: lock.pid,
        pidAlive: activePidAlive,
        runId: lock.runId,
        startedAt: lock.startedAt,
        updatedAt: lock.updatedAt,
        until: lock.until,
        runAgeSeconds: secondsSince(generatedAt, lock.startedAt),
        lockAgeSeconds: secondsSince(generatedAt, lock.updatedAt),
        secondsUntilDeadline: secondsUntil(generatedAt, lock.until),
        statusPath: rel(lock.statusPath),
      }
    : undefined,
  status: status
    ? {
        path: rel(lock?.statusPath ?? ""),
        state: status.state,
        cycle: status.cycle,
        currentStep: status.currentStep,
        currentStepStartedAt: status.currentStepStartedAt,
        currentStepAgeSeconds: secondsSince(generatedAt, status.currentStepStartedAt),
        currentStepLogPath: status.currentStepLogPath ? rel(status.currentStepLogPath) : undefined,
        currentStepLastHeartbeatAt: status.currentStepLastHeartbeatAt,
        currentStepHeartbeatAgeSeconds: secondsSince(generatedAt, status.currentStepLastHeartbeatAt),
        sleepUntil,
        sleepUntilInferred: !status.sleepUntil && Boolean(sleepUntil),
        secondsUntilWake: secondsUntil(generatedAt, sleepUntil),
        lastEvent: status.lastEvent
          ? {
              ...status.lastEvent,
              ageSeconds: secondsSince(generatedAt, status.lastEvent.completedAt),
              logPath: status.lastEvent.logPath ? rel(status.lastEvent.logPath) : undefined,
            }
          : undefined,
      }
    : undefined,
  latestEvents: latestEvents.map((event) => ({
    stepId: event.stepId,
    lane: event.lane,
    status: event.status,
    completedAt: event.completedAt,
    ms: event.ms,
    exitCode: event.exitCode,
    reason: event.reason,
  })),
  routerLadder,
  supervisor: {
    logPath: rel(supervisorLogPath),
    statePath: rel(supervisorStatePath),
    state: supervisorState,
    logTail: supervisorLogTail,
    processes: supervisorProcesses,
  },
  activeProcessTree,
  freshnessEvidence,
};

if (record) appendFileSync(statusSnapshotsPath, `${JSON.stringify(report)}\n`, "utf8");

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

if (strict && lock && !activePidAlive) process.exitCode = 1;
if (requireSupervisor && supervisorProcesses.length !== 1) process.exitCode = 1;

function printHuman(value: typeof report) {
  console.log(`HALO status ${value.generatedAt}`);
  if (value.recordedPath) console.log(`recorded: ${value.recordedPath}`);
  if (!value.activeLock) {
    console.log("active lock: none");
  } else {
    console.log(`active lock: ${value.activeLock.runId} pid=${value.activeLock.pid} alive=${value.activeLock.pidAlive}`);
    console.log(`lock updated: ${value.activeLock.updatedAt}`);
    console.log(`lock age: ${formatSeconds(value.activeLock.lockAgeSeconds)}; run age: ${formatSeconds(value.activeLock.runAgeSeconds)}`);
    console.log(`target until: ${value.activeLock.until}`);
    console.log(`deadline in: ${formatSeconds(value.activeLock.secondsUntilDeadline)}`);
    console.log(`current step: ${value.status?.currentStep ?? value.status?.state ?? "unknown"}`);
    if (typeof value.status?.currentStepAgeSeconds === "number") {
      console.log(`step age: ${formatSeconds(value.status.currentStepAgeSeconds)}`);
    }
    if (value.status?.sleepUntil) {
      const suffix = value.status.sleepUntilInferred ? ", inferred" : "";
      console.log(`sleep until: ${value.status.sleepUntil} (${formatSeconds(value.status.secondsUntilWake)} from now${suffix})`);
    }
    if (value.status?.currentStepLastHeartbeatAt) {
      console.log(
        `step heartbeat: ${value.status.currentStepLastHeartbeatAt} (${formatSeconds(value.status.currentStepHeartbeatAgeSeconds)} ago)`,
      );
    }
    if (value.freshnessEvidence) {
      console.log(`freshness evidence: ${value.freshnessEvidence.kind} - ${value.freshnessEvidence.detail}`);
    }
    console.log(`status: ${value.activeLock.statusPath}`);
  }
  console.log(
    `free-auto router ladder: ${value.routerLadder.exists ? `${value.routerLadder.path} (${value.routerLadder.bytes} bytes)` : "missing/in progress"}`,
  );
  if (value.supervisor.processes.length > 0) {
    console.log(`supervisor: ${value.supervisor.processes.map((process) => `pid=${process.pid}`).join(", ")}`);
  } else {
    console.log("supervisor: no process found");
  }
  if (value.activeProcessTree.length > 0) {
    console.log(`active process tree: ${formatProcessTree(value.activeProcessTree)}`);
  }
  if (value.supervisor.logTail.length > 0) {
    console.log("supervisor latest:");
    for (const line of value.supervisor.logTail) console.log(`  ${line}`);
  }
  if (value.latestEvents.length > 0) {
    console.log("latest events:");
    for (const event of value.latestEvents) {
      console.log(`  ${event.stepId} ${event.status} ${event.ms}ms${event.reason ? ` reason=${event.reason}` : ""}`);
    }
  }
}

function secondsSince(now: Date, iso?: string): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.round((now.getTime() - then) / 1000));
}

function secondsUntil(now: Date, iso?: string): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.round((then - now.getTime()) / 1000);
}

function formatSeconds(value: number | undefined): string {
  if (typeof value !== "number") return "unknown";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  if (minutes > 0) return `${sign}${minutes}m ${seconds}s`;
  return `${sign}${seconds}s`;
}

function readTextTail(path: string, count: number): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).slice(-count);
}

function describeFreshnessEvidence(
  value: RunnerStatus | undefined,
  pidAlive: boolean,
  processTree: ProcessInfo[],
): { kind: string; detail: string } | undefined {
  if (value?.currentStepLastHeartbeatAt) {
    return {
      kind: "status-heartbeat",
      detail: `step heartbeat at ${value.currentStepLastHeartbeatAt}`,
    };
  }
  if (value?.currentStep && pidAlive && processTree.length > 1) {
    return {
      kind: "process-tree",
      detail: "runner predates heartbeat patch; attached child process tree is the freshness evidence",
    };
  }
  if (pidAlive) {
    return {
      kind: "process",
      detail: "runner process is alive",
    };
  }
  return undefined;
}

function inferSleepUntil(value: RunnerStatus | undefined): string | undefined {
  if (value?.state !== "sleeping" || !value.lastEvent?.completedAt || typeof value.sleepMinutes !== "number") {
    return undefined;
  }
  const completedAt = Date.parse(value.lastEvent.completedAt);
  if (Number.isNaN(completedAt)) return undefined;
  return new Date(completedAt + value.sleepMinutes * 60_000).toISOString();
}

function readJson<T>(path: string): T | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function readJsonlTail<T>(path: string, count: number): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).slice(-count);
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

function listSupervisorProcesses(state?: SupervisorState): ProcessInfo[] {
  if (state && isProcessAlive(state.pid)) {
    return [
      {
        pid: state.pid,
        parentPid: 0,
        name: "powershell.exe",
        commandLine: `halo-supervise-until.ps1 state=${state.state} until=${state.until}`,
      },
    ];
  }
  if (process.platform !== "win32") return [];
  try {
    const script = [
      "$rows = Get-CimInstance Win32_Process |",
      "Where-Object { $_.CommandLine -like '*-File*halo-supervise-until.ps1*' -and $_.CommandLine -notlike '*-Command*' } |",
      "Select-Object ProcessId,ParentProcessId,Name,CommandLine;",
      "$rows | ConvertTo-Json -Compress",
    ].join(" ");
    const raw = execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | { ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string }
      | Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      name: row.Name,
      commandLine: row.CommandLine ?? "",
    }));
  } catch {
    return [];
  }
}

function listProcessTree(pid: number): ProcessInfo[] {
  if (process.platform !== "win32") return [];
  try {
    const script = [
      `$rootPid = ${pid};`,
      "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine;",
      "$queue = New-Object System.Collections.Queue;",
      "$queue.Enqueue($rootPid);",
      "$out = @();",
      "while ($queue.Count -gt 0) {",
      "  $current = $queue.Dequeue();",
      "  $row = $all | Where-Object { $_.ProcessId -eq $current } | Select-Object -First 1;",
      "  if ($row) { $out += $row; }",
      "  $children = $all | Where-Object { $_.ParentProcessId -eq $current };",
      "  foreach ($child in $children) { $queue.Enqueue($child.ProcessId); }",
      "}",
      "$out | ConvertTo-Json -Compress",
    ].join(" ");
    const raw = execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | { ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string }
      | Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      name: row.Name,
      commandLine: row.CommandLine ?? "",
    }));
  } catch {
    return [];
  }
}

function formatProcessTree(processes: ProcessInfo[]): string {
  return processes.map((process) => `${process.name.replace(/\.exe$/i, "")}(${process.pid})`).join(" -> ");
}

function fileInfo(path: string) {
  if (!existsSync(path)) return { exists: false, path: rel(path) };
  const stat = statSync(path);
  return {
    exists: true,
    path: rel(path),
    bytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function rel(path: string): string {
  if (!path) return path;
  return relative(root, path).replace(/\\/g, "/");
}
