import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export type BankerToolBenchManifestLockFile = {
  path: string;
  section: "tasks_jsonl" | "task_data" | "golden_outputs" | "other";
  sha256: string;
  bytes: number;
};

export type BankerToolBenchManifestLock = {
  schema: 1;
  generatedAt?: string;
  verifier: "bankertoolbench_manifest_lock";
  sourceRoot: string;
  datasetRevision?: string;
  fileCount: number;
  sectionCounts: Record<BankerToolBenchManifestLockFile["section"], number>;
  aggregateSha256: string;
  files: BankerToolBenchManifestLockFile[];
  warnings: string[];
};

export type BankerToolBenchManifestLockOptions = {
  generatedAt?: string;
  datasetRevision?: string;
};

export function buildBankerToolBenchManifestLock(
  rootDir: string,
  options: BankerToolBenchManifestLockOptions = {},
): BankerToolBenchManifestLock {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`BankerToolBench root does not exist: ${rootDir}`);
  if (!statSync(root).isDirectory()) throw new Error(`BankerToolBench root is not a directory: ${rootDir}`);

  const files = walkFiles(root).map((file) => fileLock(root, file));
  const sectionCounts: BankerToolBenchManifestLock["sectionCounts"] = {
    tasks_jsonl: files.filter((file) => file.section === "tasks_jsonl").length,
    task_data: files.filter((file) => file.section === "task_data").length,
    golden_outputs: files.filter((file) => file.section === "golden_outputs").length,
    other: files.filter((file) => file.section === "other").length,
  };
  const warnings = [
    ...(sectionCounts.tasks_jsonl === 1 ? [] : [`expected exactly one tasks.jsonl, found ${sectionCounts.tasks_jsonl}`]),
    ...(sectionCounts.task_data > 0 ? [] : ["no task-data files found"]),
    ...(sectionCounts.golden_outputs > 0 ? [] : ["no golden-outputs files found"]),
    ...(options.datasetRevision ? [] : ["dataset revision is not recorded; this lock is a local fixture/provenance smoke, not an official bundle claim"]),
  ];

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    verifier: "bankertoolbench_manifest_lock",
    sourceRoot: basename(root),
    ...(options.datasetRevision ? { datasetRevision: options.datasetRevision } : {}),
    fileCount: files.length,
    sectionCounts,
    aggregateSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    files,
    warnings,
  };
}

function fileLock(root: string, file: string): BankerToolBenchManifestLockFile {
  const content = readFileSync(file);
  const relPath = relative(root, file).replace(/\\/g, "/");
  return {
    path: relPath,
    section: sectionFor(relPath),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.length,
  };
}

function sectionFor(path: string): BankerToolBenchManifestLockFile["section"] {
  if (path === "tasks.jsonl") return "tasks_jsonl";
  if (path.startsWith("task-data/")) return "task_data";
  if (path.startsWith("golden-outputs/")) return "golden_outputs";
  return "other";
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walkFiles(full));
    else if (item.isFile()) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
