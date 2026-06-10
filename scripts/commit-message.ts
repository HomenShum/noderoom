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

function lastCommitChanges(): GitChange[] {
  return parseNameStatus(git(["show", "--format=", "--name-status", "HEAD"]));
}

function lastCommitMessage(): string {
  return git(["show", "-s", "--format=%B", "HEAD"]);
}

function isMergeCommit(): boolean {
  const parents = git(["show", "-s", "--format=%P", "HEAD"]).trim().split(/\s+/).filter(Boolean);
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

function checkLast(): void {
  if (isMergeCommit()) {
    console.log("merge commit detected; skipping file-list commit message check");
    return;
  }
  const changes = lastCommitChanges();
  const message = lastCommitMessage();
  const missing = missingMentionedPaths(message, changes);
  if (missing.length === 0) {
    console.log(`commit message covers ${changes.length} changed file path(s)`);
    return;
  }
  console.error("Commit message is missing changed file path(s):");
  for (const change of missing) {
    console.error(`- ${change.path}`);
  }
  process.exit(1);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.has("--check-last")) {
    checkLast();
    return;
  }
  printSummary();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
