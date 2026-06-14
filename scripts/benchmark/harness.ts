import type { AgentTraceEvent } from "../../src/nodeagent/core/types";

export type FetchEvidence = {
  requestedUrl?: string;
  resultUrl?: string;
  title?: string;
  snippet?: string;
};

export type CompanyJudgeVerdict = {
  grounded: boolean;
  rightEntity: boolean;
};

export type CompanyJudgeResult =
  | (CompanyJudgeVerdict & { judgeOk: true; raw: string })
  | { judgeOk: false; raw?: string; error: string };

export type FailureOwner = "model" | "harness" | "tool_contract" | "grader" | "environment" | "provider";

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$)/i;

export function extractUrl(value: string): string {
  const candidate = value.match(/https?:\/\/[^\s\]]+/i)?.[0] ?? "";
  return trimUrlCandidate(candidate);
}

function trimUrlCandidate(candidate: string): string {
  let out = candidate.replace(/[.,;]+$/g, "");
  while (out.endsWith(")") && countChar(out, "(") < countChar(out, ")")) out = out.slice(0, -1);
  return out;
}

function countChar(value: string, ch: string): number {
  return [...value].filter((c) => c === ch).length;
}

type CanonicalUrl = {
  key: string;
  host: string;
  path: string;
  isRoot: boolean;
};

function canonicalUrl(value: string): CanonicalUrl | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = "https:";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    url.pathname = path;
    const key = url.toString().replace(/\/$/, "");
    return { key, host: url.hostname, path, isRoot: path === "/" && url.search === "" };
  } catch {
    return undefined;
  }
}

export function canonicalSourceKey(value: string): string {
  return canonicalUrl(value)?.key ?? value.trim().replace(/\/$/, "");
}

function urlsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = canonicalUrl(a);
  const right = canonicalUrl(b);
  if (!left || !right) return a.trim().replace(/\/$/, "") === b.trim().replace(/\/$/, "");
  if (left.key === right.key) return true;
  return left.host === right.host && left.isRoot && right.isRoot;
}

export function fetchEvidenceFromTrace(trace: Pick<AgentTraceEvent, "tool" | "args" | "result">[]): FetchEvidence[] {
  return trace.flatMap((event) => {
    if (event.tool === "research_company_row" || event.tool === "fetch_row_sources") {
      const result = event.result as { fetched?: Array<{ ok?: boolean; requestedUrl?: string; resultUrl?: string; url?: string; title?: string; snippet?: string }> } | undefined;
      return (result?.fetched ?? []).flatMap((item) => item.ok ? [{
        requestedUrl: item.requestedUrl,
        resultUrl: item.resultUrl ?? item.url,
        title: item.title,
        snippet: item.snippet,
      }] : []);
    }
    if (event.tool !== "fetch_source") return [];
    const result = event.result as { ok?: boolean; title?: string; snippet?: string; url?: string } | undefined;
    if (!result?.ok) return [];
    const args = event.args as { url?: string } | undefined;
    return [{
      requestedUrl: typeof args?.url === "string" ? args.url : undefined,
      resultUrl: typeof result.url === "string" ? result.url : undefined,
      title: result.title,
      snippet: result.snippet,
    }];
  });
}

export function isSourceUrlCoveredByFetch(sourceUrl: string, fetched: FetchEvidence[]): boolean {
  return fetched.some((item) => urlsMatch(sourceUrl, item.requestedUrl) || urlsMatch(sourceUrl, item.resultUrl));
}

/** Content floor for STRUCTURED_FIELDS — kills the two degenerate strategies the gate has been gamed
 *  by: (a) "assert nothing" disclaimers (v2's deterministic template passed NO_FABRICATION vacuously
 *  because content-free text can't fabricate), and (b) from-memory fabrication (text with zero
 *  derivation from what was actually fetched). A summary counts as grounded when it shares >= 2
 *  distinct substantive tokens (len >= 5, non-boilerplate) with the row's fetched evidence. Cheap,
 *  deterministic, and intentionally weak — the semantic judge (NO_FABRICATION/RIGHT_ENTITY) does the
 *  real grading; this floor only guarantees the judge has model-authored, evidence-derived text to grade. */
const FLOOR_STOPWORDS = new Set([
  "about", "their", "there", "these", "those", "which", "would", "should", "could", "while", "being",
  "based", "company", "companies", "sources", "source", "cited", "fetched", "review", "asserted",
  "snippet", "snippets", "disclosed", "figure", "untrusted",
]);
function substantiveTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? []).filter((w) => !FLOOR_STOPWORDS.has(w)));
}
export function summaryGroundedInEvidence(summary: string, evidence: FetchEvidence[]): boolean {
  const evidenceTokens = substantiveTokens(evidence.map((e) => `${e.title ?? ""} ${e.snippet ?? ""}`).join(" "));
  if (evidenceTokens.size === 0) return false; // no evidence -> nothing can be grounded
  let overlap = 0;
  for (const token of substantiveTokens(summary)) {
    if (evidenceTokens.has(token) && ++overlap >= 2) return true;
  }
  return false;
}

export function matchedEvidenceForSources(sourceUrls: string[], fetched: FetchEvidence[]): FetchEvidence[] {
  const seen = new Set<string>();
  const matched: FetchEvidence[] = [];
  for (const item of fetched) {
    if (!sourceUrls.some((url) => urlsMatch(url, item.requestedUrl) || urlsMatch(url, item.resultUrl))) continue;
    const key = `${canonicalSourceKey(item.requestedUrl ?? "")}|${canonicalSourceKey(item.resultUrl ?? "")}|${item.title ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(item);
  }
  return matched;
}

export function evidenceText(items: FetchEvidence[]): string {
  return items
    .map((item) => {
      const label = [item.title, item.resultUrl ?? item.requestedUrl].filter(Boolean).join(" ");
      return `${label}: ${item.snippet ?? ""}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

export function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("judge returned no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("judge returned unterminated JSON object");
}

function boolField(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "pass", "passed"].includes(v)) return true;
    if (["false", "no", "fail", "failed"].includes(v)) return false;
  }
  throw new Error(`judge JSON missing boolean ${field}`);
}

export function parseJudgeCompanyResult(text: string): CompanyJudgeVerdict {
  const parsed = JSON.parse(extractFirstJsonObject(text)) as Record<string, unknown>;
  return {
    grounded: boolField(parsed.grounded, "grounded"),
    rightEntity: boolField(parsed.rightEntity, "rightEntity"),
  };
}

export function buildCompanyJudgePrompt(company: string, summary: string, evidence: string): string {
  return `You are a diligence fact-checker. Flag fabrication ONLY when the summary states a specific
fact - a number, date, funding amount, headcount, or a named person/product - that is NOT present in the
evidence. General/directional/synthesis descriptions are fine and are NOT fabrication.
Company: "${company}"
Summary: "${summary}"
Evidence (fetched from real sources):
${evidence.slice(0, 3500) || "(none)"}

JSON only, no prose:
{"grounded": <false ONLY if the summary asserts a specific fact absent from the evidence; true otherwise>, "rightEntity": <true if the summary describes "${company}", not a different same-name company>}`;
}

export async function judgeCompanyWith(
  callJudge: (modelId: string, prompt: string) => Promise<string>,
  judgeModel: string,
  company: string,
  summary: string,
  evidence: string,
): Promise<CompanyJudgeResult> {
  if (!summary) return { judgeOk: true, raw: "", grounded: false, rightEntity: false };
  try {
    const raw = await callJudge(judgeModel, buildCompanyJudgePrompt(company, summary, evidence));
    return { judgeOk: true, raw, ...parseJudgeCompanyResult(raw) };
  } catch (error) {
    return {
      judgeOk: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function fetchToolFailures(trace: Pick<AgentTraceEvent, "tool" | "result">[] = []): string[] {
  return trace.flatMap((event) => {
    if (event.tool !== "fetch_source") return [];
    const result = event.result as { ok?: boolean; error?: string } | undefined;
    if (result?.ok !== false) return [];
    return [result.error ?? "fetch_source failed"];
  });
}

function fetchToolSuccesses(trace: Pick<AgentTraceEvent, "tool" | "result">[] = []): number {
  return trace.filter((event) => {
    if (event.tool !== "fetch_source") return false;
    const result = event.result as { ok?: boolean } | undefined;
    return result?.ok === true;
  }).length;
}

function providerLikeError(error: string): boolean {
  return /\b(401|403|429|5\d\d)\b|rate.?limit|quota|overloaded|provider|api key|unauthorized|forbidden|timed?.?out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|service unavailable/i.test(error);
}

export function inferFailureOwner(input: {
  error?: string;
  checks?: Record<string, boolean>;
  judgeErrors?: string[];
  trace?: Pick<AgentTraceEvent, "tool" | "result">[];
}): { failureOwner?: FailureOwner; failureReason?: string } {
  const checks = input.checks ?? {};
  const failedChecks = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
  if (!input.error && failedChecks.length === 0) return {};

  if (input.judgeErrors?.length) {
    return { failureOwner: "grader", failureReason: `judge failed: ${input.judgeErrors[0]}` };
  }

  const fetchFailures = fetchToolFailures(input.trace);
  const fetchSuccesses = fetchToolSuccesses(input.trace);
  if (failedChecks.includes("SOURCES_FETCHED") && fetchFailures.length > 0 && fetchSuccesses === 0) {
    return { failureOwner: "environment", failureReason: `fetch_source failed before evidence could be judged: ${fetchFailures[0]}` };
  }

  if (input.error) {
    if (/preflight.*fetch_source|missing OPENROUTER_API_KEY/i.test(input.error)) {
      return { failureOwner: "environment", failureReason: input.error };
    }
    if (/route smoke failed.*tool|tool.*smoke/i.test(input.error)) {
      return { failureOwner: "tool_contract", failureReason: input.error };
    }
    if (/child row missing result|child row parse failed/i.test(input.error)) {
      return { failureOwner: "harness", failureReason: input.error };
    }
    if (providerLikeError(input.error)) {
      return { failureOwner: "provider", failureReason: input.error };
    }
    return { failureOwner: "harness", failureReason: input.error };
  }

  if (failedChecks.includes("COMPLETED_IN_BUDGET")) {
    return { failureOwner: "model", failureReason: "agent did not complete within the benchmark budget" };
  }
  if (failedChecks.length > 0) {
    return { failureOwner: "model", failureReason: `failed checks: ${failedChecks.join(", ")}` };
  }
  return {};
}
