/**
 * LLM gateway (review domain 3: privacy/runtime) — the layer between the agent and the model.
 * Two pure, testable primitives: a PRE-CALL spend ceiling (per-run token/cost cap) and an
 * OUTBOUND PII/secret firewall (redact before a prompt leaves for the model). Wire both into the
 * per-step model call: check the ceiling before model.next; redact the system+messages going out.
 *
 * Prior art: LangChain Interrupt 26 — "LLM Gateways: per-user spend ceilings + real-time PII firewall".
 */

export type SpendLimits = { maxTokens?: number; maxCostUsd?: number };
export type SpendState = { inputTokens: number; outputTokens: number; costUsd: number };

/** Pre-call gate: may the run make another model call, or is it capped? Deterministic. */
export function checkSpendCeiling(state: SpendState, limits: SpendLimits): { ok: true } | { ok: false; reason: string } {
  const total = state.inputTokens + state.outputTokens;
  if (limits.maxTokens !== undefined && total >= limits.maxTokens) {
    return { ok: false, reason: `token ceiling reached (${total}/${limits.maxTokens})` };
  }
  if (limits.maxCostUsd !== undefined && state.costUsd >= limits.maxCostUsd) {
    return { ok: false, reason: `cost ceiling reached ($${state.costUsd.toFixed(4)}/$${limits.maxCostUsd.toFixed(4)})` };
  }
  return { ok: true };
}

// Heuristic PII/secret patterns. Order matters: more-specific shapes first so they win the redaction.
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[redacted-secret]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]"],
  [/\b(?:\d[ -]?){15,16}\b/g, "[redacted-card]"],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[redacted-phone]"],
];

/** Outbound PII/secret firewall — redact before a prompt leaves for the model. Returns redacted text + count. */
export function redactPII(text: string): { text: string; redactions: number } {
  let out = text;
  let redactions = 0;
  for (const [re, repl] of PII_PATTERNS) {
    out = out.replace(re, () => { redactions++; return repl; });
  }
  return { text: out, redactions };
}
