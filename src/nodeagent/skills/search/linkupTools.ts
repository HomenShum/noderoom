import type { SourceResult } from "../../core/types";

export interface SourceEvidence {
  label: string;
  url: string;
  snippet: string;
  confidence: number;
}

export function sourceEvidenceFromFetch(label: string, result: SourceResult): SourceEvidence | null {
  if (!result.ok) return null;
  return { label, url: result.url, snippet: result.snippet, confidence: 0.72 };
}

export const LINKUP_TOOL_NAMES = ["fetch_source"] as const;

