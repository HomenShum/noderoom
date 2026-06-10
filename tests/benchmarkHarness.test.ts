import { describe, expect, it } from "vitest";
import {
  extractUrl,
  fetchEvidenceFromTrace,
  inferFailureOwner,
  isSourceUrlCoveredByFetch,
  matchedEvidenceForSources,
  parseJudgeCompanyResult,
  judgeCompanyWith,
  summaryGroundedInEvidence,
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

  it("keeps balanced parentheses inside source URLs", () => {
    const fetched = fetchEvidenceFromTrace([{
      tool: "fetch_source",
      args: { url: "https://en.wikipedia.org/wiki/Ramp_(company)" },
      result: { ok: true, url: "https://en.wikipedia.org/wiki/Ramp_(company)", title: "Ramp", snippet: "Ramp company" },
    }]);

    expect(extractUrl("[Ramp](https://en.wikipedia.org/wiki/Ramp_(company))")).toBe("https://en.wikipedia.org/wiki/Ramp_(company)");
    expect(isSourceUrlCoveredByFetch("https://en.wikipedia.org/wiki/Ramp_(company)", fetched)).toBe(true);
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

  it("counts fetched evidence returned by a composite row workflow", () => {
    const fetched = fetchEvidenceFromTrace([{
      tool: "research_company_row",
      args: { rowId: "rc_acme" },
      result: {
        ok: true,
        fetched: [
          { ok: true, requestedUrl: "https://acme.com", resultUrl: "https://www.acme.com/", title: "Acme", snippet: "Acme homepage" },
          { ok: false, requestedUrl: "https://bad.example", error: "http 404" },
        ],
      },
    }]);

    expect(fetched).toHaveLength(1);
    expect(isSourceUrlCoveredByFetch("https://acme.com/", fetched)).toBe(true);
  });

  it("counts fetched evidence from the v3 two-call shape (fetch_row_sources)", () => {
    const fetched = fetchEvidenceFromTrace([{
      tool: "fetch_row_sources",
      args: { rowId: "rc_acme" },
      result: {
        ok: true,
        fetched: [
          { ok: true, requestedUrl: "https://acme.com", resultUrl: "https://www.acme.com/", title: "Acme", snippet: "industrial anvils and rocket skates" },
          { ok: true, requestedUrl: "https://en.wikipedia.org/wiki/Acme", resultUrl: "https://en.wikipedia.org/wiki/Acme", title: "Acme - Wikipedia", snippet: "fictional manufacturer" },
        ],
      },
    }]);

    expect(fetched).toHaveLength(2);
    expect(isSourceUrlCoveredByFetch("https://acme.com", fetched)).toBe(true);
  });
});

describe("content floor — summaryGroundedInEvidence", () => {
  // The two degenerate strategies that have ACTUALLY gamed this gate, as failing cases forever.
  const evidence = [{
    requestedUrl: "https://anthropic.com", resultUrl: "https://www.anthropic.com/",
    title: "Anthropic", snippet: "Anthropic is an AI safety research company building Claude, reliable interpretable steerable systems for enterprise deployment.",
  }];

  it("rejects the v2 assert-nothing disclaimer (content-free text cannot pass a research gate)", () => {
    expect(summaryGroundedInEvidence(
      "Anthropic: cited sources fetched for this row are listed. No uncited operating, funding, or headcount claim is asserted.",
      evidence,
    )).toBe(false);
  });

  it("rejects from-memory text with no derivation from the fetched snippets", () => {
    expect(summaryGroundedInEvidence(
      "A popular consumer fintech offering credit cards and mortgage refinancing across Europe.",
      evidence,
    )).toBe(false);
  });

  it("accepts a real synthesis that derives from the evidence", () => {
    expect(summaryGroundedInEvidence(
      "Anthropic is an AI safety research lab; it builds the Claude model family with a focus on reliable, steerable systems sold to enterprise customers.",
      evidence,
    )).toBe(true);
  });

  it("fails closed when there is no evidence at all", () => {
    expect(summaryGroundedInEvidence("Anything at all.", [])).toBe(false);
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

describe("benchmark failure attribution", () => {
  it("attributes all-failed source fetches to the environment before blaming the model", () => {
    const result = inferFailureOwner({
      checks: { SOURCES_FETCHED: false, NO_FABRICATION: false },
      trace: [{
        tool: "fetch_source",
        result: { ok: false, error: "fetch failed" },
      }],
    });

    expect(result.failureOwner).toBe("environment");
    expect(result.failureReason).toContain("fetch_source failed");
  });

  it("attributes judge infrastructure failures to the grader", () => {
    const result = inferFailureOwner({
      error: "judge failed for 1 row(s)",
      judgeErrors: ["Acme: judge returned no JSON object"],
    });

    expect(result.failureOwner).toBe("grader");
  });

  it("attributes ordinary failed checks to model behavior", () => {
    const result = inferFailureOwner({
      checks: { SOURCES_FETCHED: true, NO_FABRICATION: false, RIGHT_ENTITY: true },
      trace: [{
        tool: "fetch_source",
        result: { ok: true, url: "https://example.com", title: "Example", snippet: "evidence" },
      }],
    });

    expect(result.failureOwner).toBe("model");
    expect(result.failureReason).toContain("NO_FABRICATION");
  });
});
