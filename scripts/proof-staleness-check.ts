/**
 * `npm run proofs:staleness` — Harness Hardening #7 CLI. Exit 1 when any marketed proof summary
 * has outlived its re-verification window (see evals/proofStaleness.ts for the registry).
 */
import { checkMarketedProofs } from "../evals/proofStaleness";

const results = checkMarketedProofs();
for (const r of results) {
  console.log(`${r.ok ? "ok   " : "STALE"} ${r.path} — ${r.claim}\n      ${r.reason}`);
}
if (results.some((r) => !r.ok)) process.exitCode = 1;
