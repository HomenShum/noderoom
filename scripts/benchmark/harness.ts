import type { AgentTraceEvent } from "../../src/agent/types";

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

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$)/i;

export function extractUrl(value: string): string {
  return value.match(/https?:\/\/[^\s),\]]+/i)?.[0] ?? "";
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

function extractFirstJsonObject(text: string): string {
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
