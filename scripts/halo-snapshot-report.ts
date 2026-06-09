import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Snapshot = {
  schema?: number;
  generatedAt?: string;
  activeLock?: {
    pid?: number;
    pidAlive?: boolean;
    runId?: string;
    runAgeSeconds?: number;
    lockAgeSeconds?: number;
    secondsUntilDeadline?: number;
  };
  status?: {
    state?: string;
    currentStep?: string;
    sleepUntil?: string;
    sleepUntilInferred?: boolean;
    secondsUntilWake?: number;
  };
  routerLadder?: {
    exists?: boolean;
    path?: string;
    bytes?: number;
  };
  supervisor?: {
    processes?: Array<{ pid?: number }>;
  };
  activeProcessTree?: Array<{ pid?: number; name?: string; commandLine?: string }>;
  freshnessEvidence?: {
    kind?: string;
    detail?: string;
  };
};

const root = process.cwd();
const snapshotsPath = join(root, "docs", "eval", "halo-runs", "status-snapshots.jsonl");
const outPath = join(root, "docs", "eval", "halo-runs", "status-snapshots.md");
const snapshots = readSnapshots(snapshotsPath);
const latest = snapshots.at(-1);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderReport(snapshots, latest), "utf8");
console.log(`wrote ${relativePath(outPath)} (${snapshots.length} snapshots)`);

function readSnapshots(path: string): Snapshot[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Snapshot];
      } catch {
        return [];
      }
    });
}

function renderReport(snapshots: Snapshot[], latest: Snapshot | undefined): string {
  const duplicateSupervisorSnapshots = snapshots.filter((snapshot) => supervisorCount(snapshot) > 1);
  const missingSupervisorSnapshots = snapshots.filter((snapshot) => supervisorCount(snapshot) === 0);
  const rows = snapshots.slice(-20).map((snapshot) => [
    snapshot.generatedAt ?? "",
    snapshot.activeLock?.runId ?? "",
    snapshot.status?.currentStep ?? snapshot.status?.state ?? "",
    snapshot.activeLock?.pidAlive ? "yes" : "no",
    String(supervisorCount(snapshot)),
    snapshot.routerLadder?.exists ? "yes" : "no",
    snapshot.freshnessEvidence?.kind ?? "",
    formatSeconds(snapshot.status?.secondsUntilWake),
    formatSeconds(snapshot.activeLock?.lockAgeSeconds),
    formatSeconds(snapshot.activeLock?.runAgeSeconds),
    formatSeconds(snapshot.activeLock?.secondsUntilDeadline),
  ]);

  return [
    "# HALO Status Snapshots",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Snapshot source: \`${relativePath(snapshotsPath)}\``,
    `Snapshots parsed: ${snapshots.length}`,
    "",
    "## Latest",
    "",
    latest
      ? [
          `- Time: ${latest.generatedAt ?? "unknown"}`,
          `- Run: ${latest.activeLock?.runId ?? "unknown"}`,
          `- Active PID: ${latest.activeLock?.pid ?? "unknown"} alive=${String(latest.activeLock?.pidAlive)}`,
          `- Step: ${latest.status?.currentStep ?? latest.status?.state ?? "unknown"}`,
          `- Sleep until: ${latest.status?.sleepUntil ?? "n/a"}${latest.status?.sleepUntilInferred ? " (inferred)" : ""}`,
          `- Router ladder artifact: ${latest.routerLadder?.exists ? `${latest.routerLadder.path} (${latest.routerLadder.bytes ?? 0} bytes)` : "missing/in progress"}`,
          `- Supervisors: ${supervisorCount(latest)}`,
          `- Freshness evidence: ${latest.freshnessEvidence?.kind ?? "unknown"}${latest.freshnessEvidence?.detail ? ` - ${latest.freshnessEvidence.detail}` : ""}`,
          `- Active process tree: ${processTree(latest)}`,
        ].join("\n")
      : "- No snapshots recorded yet.",
    "",
    "## Anomalies",
    "",
    `- Duplicate-supervisor snapshots: ${duplicateSupervisorSnapshots.length}`,
    `- Missing-supervisor snapshots: ${missingSupervisorSnapshots.length}`,
    "",
    "## Recent Snapshots",
    "",
    table(
      [
        "generatedAt",
        "runId",
        "step",
        "pidAlive",
        "supervisors",
        "routerJson",
        "freshness",
        "wakeIn",
        "lockAge",
        "runAge",
        "deadlineIn",
      ],
      rows,
    ),
    "",
  ].join("\n");
}

function supervisorCount(snapshot: Snapshot): number {
  return snapshot.supervisor?.processes?.length ?? 0;
}

function processTree(snapshot: Snapshot): string {
  const tree = snapshot.activeProcessTree ?? [];
  if (tree.length === 0) return "unknown";
  return tree.map((process) => `${(process.name ?? "process").replace(/\.exe$/i, "")}(${process.pid ?? "?"})`).join(" -> ");
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatSeconds(value: number | undefined): string {
  if (typeof value !== "number") return "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  if (minutes > 0) return `${sign}${minutes}m ${seconds}s`;
  return `${sign}${seconds}s`;
}

function relativePath(path: string): string {
  return path.replace(root, "").replace(/^[/\\]/, "").replace(/\\/g, "/");
}
