/**
 * Git identity for eval records — shared by every producer that records to the eval store, so a
 * ladder row and a credit row recorded in the same run share one runKey (commit + worktreeHash) and
 * `eval:diff` groups them as the same code version. Mirrors the ladder's inline identity (kept inline
 * there to avoid churning a hot file); this is the canonical copy new producers import.
 */
import { execSync } from "node:child_process";
import { stableJournalHash } from "../src/nodeagent/core/journal";

export type GitIdentity = { commitSha: string; gitDirty: boolean; worktreeHash?: string };

export function readGitIdentity(): GitIdentity {
  let commitSha = "nocommit";
  let status = "";
  let diff = "";
  try { commitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a git repo */ }
  try { status = execSync("git status --porcelain=v1", { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { /* not a git repo */ }
  try { diff = execSync("git diff --no-ext-diff --binary HEAD --", { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).toString(); } catch { /* large/unavailable */ }
  const gitDirty = status.trim().length > 0;
  return { commitSha, gitDirty, worktreeHash: gitDirty ? stableJournalHash({ status, diff }) : undefined };
}
