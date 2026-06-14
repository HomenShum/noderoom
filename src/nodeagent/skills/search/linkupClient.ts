import type { SourceResult } from "../../core/types";

export interface LinkupLikeSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface LinkupLikeClient {
  search(query: string, limit?: number): Promise<LinkupLikeSearchResult[]>;
  fetch(url: string): Promise<SourceResult>;
}

export function sourceResultToLinkupResult(result: SourceResult): LinkupLikeSearchResult | null {
  if (!result.ok) return null;
  return { url: result.url, title: result.title, snippet: result.snippet };
}

export const LINKUP_CLIENT_BOUNDARY =
  "The current runtime uses bounded fetch_source. A real Linkup client can implement this interface without changing agent tools.";

export async function searchLinkup(args: { query: string; urls: string[]; limit?: number }): Promise<LinkupLikeSearchResult[]> {
  const limit = Math.max(1, args.limit ?? 5);
  const urls = args.urls.slice(0, limit);
  if (!urls.length) {
    // No explicit URLs to fetch. A real Linkup client would issue a query search here.
    // If a Linkup backend is configured, returning [] would be dishonest — it reads as
    // "the web found nothing" when in truth no search ran. Fail loudly instead (HONEST_STATUS).
    if (process.env.LINKUP_API_KEY) {
      throw new Error(
        "linkup_search_not_implemented: live query search is not wired; only bounded fetch_source over explicit URLs is implemented",
      );
    }
    return [];
  }
  const { fetchSourceReal } = await import("../../../nodeagent/skills/search/fetchSource");
  const results = await Promise.all(urls.map((url) => fetchSourceReal(url)));
  return results.map(sourceResultToLinkupResult).filter((result): result is LinkupLikeSearchResult => result !== null);
}

