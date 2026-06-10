/**
 * Background crons. P1-2: the lock-lease janitor — TTL-expired locks must be actively swept
 * (status transition + agent-session clear + smart-merge of blocked drafts), not just filtered out
 * of reads: a filtered-but-active expired lock strands its blocked drafts in "pending" forever and
 * renders locked-forever in any UI that filters on status alone.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep expired lock leases", { minutes: 1 }, internal.locks.sweepExpiredLocks, {});

export default crons;
