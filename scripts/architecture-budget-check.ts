import "./benchmark/loadEnv";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkArchitectureBudget } from "../src/eval/architectureBudget";
import type { ArchitectureOwnershipManifest } from "../src/eval/architectureBudget";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const humanApproved = args.includes("--human-approved");
const changedArgs = valuesFor("--changed=");
const evidenceFiles = valuesFor("--evidence=");
const changedFiles = changedArgs.length > 0 ? changedArgs : gitChangedFiles();
const ownershipManifest = loadOwnershipManifest();

const result = checkArchitectureBudget({ changedFiles, evidenceFiles, humanApproved, ownershipManifest });

if (!result.requiresHumanApproval) {
  console.log("architecture budget: ok");
} else {
  console.log("architecture budget: review required");
  for (const file of result.changedFilesWithoutEvidence) console.log(`missing behavior evidence: ${file}`);
  for (const file of result.invalidEvidenceFiles) console.log(`invalid source-as-evidence: ${file}`);
  for (const file of result.unownedFiles) console.log(`unowned architecture surface: ${file}`);
  for (const item of result.duplicateOwnedFiles) console.log(`duplicate architecture owners: ${item.file} (${item.owners.join(", ")})`);
  for (const item of result.forbiddenFiles) console.log(`forbidden without approval: ${item.file} (${item.reason})`);
}

if (strict && result.requiresHumanApproval) process.exitCode = 1;

function valuesFor(prefix: string): string[] {
  return args.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length)).filter(Boolean);
}

function gitChangedFiles(): string[] {
  const tracked = spawnSync("git", ["diff", "--name-only"], { encoding: "utf8" });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  return [...splitLines(tracked.stdout), ...splitLines(untracked.stdout)];
}

function splitLines(value: string | null | undefined): string[] {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== "NUL");
}

function loadOwnershipManifest(): ArchitectureOwnershipManifest | undefined {
  const path = join(process.cwd(), "docs", "architecture-budget.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ArchitectureOwnershipManifest;
}
