import { afterEach, describe, expect, it } from "vitest";
import { chooseModelRoute } from "../src/nodeagent/core/adaptiveRouter";
import { parseBulkCompanyIngest, splitBulkCompanyRecords } from "../src/nodeagent/skills/finance/bulkIngest";
import { prepareDownstreamDrafts } from "../src/nodeagent/skills/integration/downstreamPublish";

const originalResearchModel = process.env.AGENT_RESEARCH_MODEL;

afterEach(() => {
  if (originalResearchModel === undefined) delete process.env.AGENT_RESEARCH_MODEL;
  else process.env.AGENT_RESEARCH_MODEL = originalResearchModel;
});

describe("nodeagent compatibility tree", () => {
  it("routes the research lane through AGENT_RESEARCH_MODEL", () => {
    process.env.AGENT_RESEARCH_MODEL = "gemini-2.5-flash";
    expect(chooseModelRoute({ taskType: "research" }).model).toBe("gemini-2.5-flash");
  });

  it("parses and batches bulk company ingest rows", () => {
    const companies = parseBulkCompanyIngest([
      "Acme, https://acme.test, T1, outbound",
      "Beta | https://beta.test | T2 | inbound",
      "Gamma\thttps://gamma.test\tT3\twatch",
    ].join("\n"));
    expect(companies).toHaveLength(3);
    expect(companies[0]?.company).toBe("Acme");
    expect(splitBulkCompanyRecords(companies, 2)).toHaveLength(2);
  });

  it("prepares downstream drafts without external side effects", () => {
    const drafts = prepareDownstreamDrafts({
      title: "Series B diligence",
      summary: "The room prepared an IC-ready draft.",
      bullets: ["2 sourced risks", "1 pending review proposal"],
      artifactUrl: "https://noderoom.test/artifacts/123",
    });
    expect(drafts.map((draft) => draft.target)).toEqual(["gmail", "notion", "slack", "linear", "linkedin"]);
    expect(drafts.every((draft) => draft.status === "prepared")).toBe(true);
    expect(drafts[0]?.body).toContain("Artifact: https://noderoom.test/artifacts/123");
  });
});
