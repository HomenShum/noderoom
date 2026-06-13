import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export type BenchmarkContaminationLeakKind =
  | "forbidden_key"
  | "forbidden_path_or_metadata_value"
  | "forbidden_file_path"
  | "invalid_json";

export type BenchmarkContaminationLeak = {
  file: string;
  kind: BenchmarkContaminationLeakKind;
  location: string;
  token: string;
};

export type BenchmarkContaminationReport = {
  schema: 1;
  generatedAt?: string;
  root: string;
  checkedFiles: number;
  leakCount: number;
  leaks: BenchmarkContaminationLeak[];
};

export type BenchmarkContaminationOptions = {
  generatedAt?: string;
};

const FORBIDDEN_KEY = /(?:gold|golden|evaluator|answer_?position|answer_?sheet|data_?position|rubric|weighted_?rubric|canary|prompt_?context|formatting_?context)/i;
const FORBIDDEN_VALUE = /(?:[\\/]evaluator[\\/]|[\\/]gold[\\/]|golden-outputs|answer_position|answerPosition|answerSheet|dataPosition|rubricItems|weightedRubricTotal|CANARY-)/i;
const FORBIDDEN_AGENT_PATH = /(?:[\\/]agent[\\/].*(?:gold|golden|golden-outputs)|(?:gold|golden|golden-outputs).*[\\/]agent[\\/])/i;

export function scanBenchmarkContamination(rootDir: string, options: BenchmarkContaminationOptions = {}): BenchmarkContaminationReport {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`benchmark contamination root does not exist: ${rootDir}`);
  if (!statSync(root).isDirectory()) throw new Error(`benchmark contamination root is not a directory: ${rootDir}`);

  const leaks: BenchmarkContaminationLeak[] = [];
  const files = walkFiles(root);
  const checked = files.filter(shouldCheckFile);
  for (const file of checked) {
    const relPath = rel(root, file);
    scanFilePath(relPath, leaks);
    if (isJsonFile(file)) {
      const value = readJson(file, relPath, leaks);
      if (value === undefined) continue;
      visitJson(value, "$", (location, key, current) => {
        if (key && FORBIDDEN_KEY.test(key)) {
          leaks.push({ file: relPath, kind: "forbidden_key", location, token: key });
        }
        if (typeof current === "string" && FORBIDDEN_VALUE.test(current)) {
          leaks.push({
            file: relPath,
            kind: "forbidden_path_or_metadata_value",
            location,
            token: matched(FORBIDDEN_VALUE, current),
          });
        }
      });
    } else {
      const content = readFileSync(file, "utf8");
      if (FORBIDDEN_VALUE.test(content)) {
        leaks.push({
          file: relPath,
          kind: "forbidden_path_or_metadata_value",
          location: "$text",
          token: matched(FORBIDDEN_VALUE, content),
        });
      }
    }
  }

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    root: basename(root),
    checkedFiles: checked.length,
    leakCount: leaks.length,
    leaks,
  };
}

function shouldCheckFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  const name = basename(file);
  if (normalized.includes("/evaluator/")) return false;
  if (!isAgentFacingPath(normalized) && !isKnownAgentFacingSidecar(name)) return false;
  return isJsonFile(file) || /\.(?:txt|md|csv|xml)$/i.test(name);
}

function isAgentFacingPath(normalizedPath: string): boolean {
  return /(?:^|\/)(?:agent|agent-workspace|deliverables)(?:\/|$)/.test(normalizedPath);
}

function isKnownAgentFacingSidecar(name: string): boolean {
  return [
    "agent-workspace-manifest.json",
    "candidate-manifest.json",
    "output-manifest.json",
    "model-edit-plan.json",
    "raw-model-output.txt",
  ].includes(name);
}

function isJsonFile(file: string): boolean {
  return basename(file).toLowerCase().endsWith(".json");
}

function scanFilePath(relPath: string, leaks: BenchmarkContaminationLeak[]): void {
  if (FORBIDDEN_AGENT_PATH.test(relPath)) {
    leaks.push({ file: relPath, kind: "forbidden_file_path", location: "$path", token: matched(FORBIDDEN_AGENT_PATH, relPath) });
  }
}

function visitJson(
  value: unknown,
  location: string,
  visitor: (location: string, key: string | undefined, value: unknown) => void,
  key?: string,
) {
  visitor(location, key, value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitJson(item, `${location}[${index}]`, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    visitJson(child, `${location}.${childKey}`, visitor, childKey);
  }
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    if (item.isDirectory()) out.push(...walkFiles(full));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

function readJson(path: string, relPath: string, leaks: BenchmarkContaminationLeak[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    leaks.push({
      file: relPath,
      kind: "invalid_json",
      location: "$",
      token: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function matched(pattern: RegExp, value: string): string {
  return value.match(pattern)?.[0] ?? pattern.source;
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}
