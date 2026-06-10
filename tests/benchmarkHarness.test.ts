import { describe, expect, it } from "vitest";
import {
  fetchEvidenceFromTrace,
  isSourceUrlCoveredByFetch,
  matchedEvidenceForSources,
  parseJudgeCompanyResult,
  judgeCompanyWith,
} from "../scripts/benchmark/harness";

describe("benchmark harness source coverage", () => {
  it("counts both the requested source URL and the final redirected URL as fetched", () => {
    const fetched = fetchEvidenceFromTrace([{
      tool: "fetch_source",
      args: { url: "https://example.com" },
      result: { ok: true, url: "https://www.example.com/", title: "Example", snippet: "official homepage" },
    }]);

    expect(isSourceUrlCoveredByFetch("https://example.com/", fetched)).toBe(true);
    expect(isSourceUrlCoveredByFetch("https://www.example.com", fetched)).toBe(true);
    expect(matchedEvidenceForSources(["https://example.com"], fetched)).toHaveLength(1);
  });

  it("does not let an unfetched same-host page satisfy SOURCES_FETCHED", () => {
    const fetched = fetchEvidenceFromTrace([{
      tool: "fetch_source",
      args: { url: "https://example.com/news" },
      result: { ok: true, url: "https://example.com/news?utm_source=agent", title: "News", snippet: "company update" },
    }]);

    expect(isSourceUrlCoveredByFetch("https://example.com/news", fetched)).toBe(true);
    expect(isSourceUrlCoveredByFetch("https://example.com/about", fetched)).toBe(false);
    expect(isSourceUrlCoveredByFetch("https://example.com", fetched)).toBe(false);
  });
});

describe("benchmark harness judge parsing", () => {
  it("parses fenced or prefixed JSON without inverting the grounded verdict", () => {
    expect(parseJudgeCompanyResult('```json\n{"grounded": "true", "rightEntity": "false"}\n```')).toEqual({
      grounded: true,
      rightEntity: false,
    });
    expect(parseJudgeCompanyResult('judge result: {"grounded": false, "rightEntity": true}')).toEqual({
      grounded: false,
      rightEntity: true,
    });
  });

  it("reports judge infrastructure failure separately from a fabrication verdict", async () => {
    const result = await judgeCompanyWith(
      async () => "not json",
      "judge-model",
      "Acme",
      "Acme sells industrial software.",
      "Acme homepage: Acme sells industrial software.",
    );

    expect(result.judgeOk).toBe(false);
    if (!result.judgeOk) expect(result.error).toMatch(/JSON object|Unexpected token/);
  });
});
