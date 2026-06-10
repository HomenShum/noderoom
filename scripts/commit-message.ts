import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type GitChange = {
  status: string;
  path: string;
  oldPath?: string;
};

export function parseNameStatus(input: string): GitChange[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
        return { status, oldPath: parts[1], path: parts[2] };
      }
      return { status, path: parts[1] ?? "" };
    })
    .filter((change) => change.path.length > 0);
}

export function renderChangeList(changes: GitChange[]): string {
  if (changes.length === 0) return "Change list:\n- No staged changes.";
  const lines = ["Change list:"];
  for (const change of changes) {
    const prefix = change.oldPath ? `${change.status} ${change.oldPath} -> ${change.path}` : `${change.status} ${change.path}`;
    lines.push(`- ${prefix} — `);
  }
  return lines.join("\n");
}

export function missingMentionedPaths(message: string, changes: GitChange[]): GitChange[] {
  return changes.filter((change) => {
    if (message.includes(change.path)) return false;
    if (change.oldPath && message.includes(change.oldPath)) return false;
    return true;
  });
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function stagedChanges(): GitChange[] {
  return parseNameStatus(git(["diff", "--cached", "--name-status"]));
}

function commitChanges(ref: string): GitChange[] {
  return parseNameStatus(git(["show", "--format=", "--name-status", ref]));
}

function commitMessage(ref: string): string {
  return git(["show", "-s", "--format=%B", ref]);
}

function isMergeCommit(ref: string): boolean {
  const parents = git(["show", "-s", "--format=%P", ref]).trim().split(/\s+/).filter(Boolean);
  return parents.length > 1;
}

function printSummary(): void {
  const changes = stagedChanges();
  console.log(renderChangeList(changes));
  console.log("");
  console.log("Verification:");
  console.log("- ");
  console.log("");
  console.log("Known limits:");
  console.log("- ");
}

function checkCommit(ref: string): boolean {
  if (isMergeCommit(ref)) {
    console.log(`${ref}: merge commit detected; skipping file-list commit message check`);
    return true;
  }
  const changes = commitChanges(ref);
  const message = commitMessage(ref);
  const missing = missingMentionedPaths(message, changes);
  if (missing.length === 0) {
    console.log(`${ref}: commit message covers ${changes.length} changed file path(s)`);
    return true;
  }
  console.error(`${ref}: commit message is missing changed file path(s):`);
  for (const change of missing) {
    console.error(`- ${change.path}`);
  }
  return false;
}

function checkLast(): void {
  if (!checkCommit("HEAD")) process.exit(1);
}

function checkRange(range: string): void {
  const refs = git(["rev-list", "--reverse", range]).trim().split(/\s+/).filter(Boolean);
  if (refs.length === 0) {
    console.log(`${range}: no commits to check`);
    return;
  }
  const ok = refs.map((ref) => checkCommit(ref)).every(Boolean);
  if (!ok) process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  if (flags.has("--check-last")) {
    checkLast();
    return;
  }
  const rangeIndex = args.indexOf("--check-range");
  if (rangeIndex >= 0) {
    checkRange(args[rangeIndex + 1] ?? "HEAD");
    return;
  }
  printSummary();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
