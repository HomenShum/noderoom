import { describe, expect, it } from "vitest";
import { artifactsFromProviderExtraction, providerFileCacheMeta } from "../src/app/providerParserAdapter";
import type { CellPayload } from "../src/engine/types";

describe("provider parser adapter", () => {
  it("keeps Convex storage canonical while provider file ids remain cache metadata", () => {
    const file = {
      storageId: "convex-storage-123",
      artifactId: "artifact-raw",
      fileName: "diligence.pdf",
      mimeType: "application/pdf",
      size: 42_000,
    };
    const providerFile = providerFileCacheMeta(file, {
      provider: "gemini",
      providerFileId: "gemini-file-abc",
      cachedAt: 1_717_000_000,
    });
    const [artifact] = artifactsFromProviderExtraction({
      file,
      providerFile,
      provider: "gemini",
      model: "gemini-3.5-flash",
      now: 1_717_000_100,
      extraction: {
        tables: [{ title: "Extracted KPIs", columns: ["Metric", "Value"], rows: [["ARR", "$12M"]], confidence: 0.91 }],
        evidence: [{
          label: "Page 4 KPI table",
          snippet: "ARR $12M",
          page: 4,
          bbox: { x: 0.12, y: 0.2, width: 0.4, height: 0.08, unit: "normalized" },
          confidence: 0.9,
        }],
      },
    });

    expect(artifact.title).toBe("diligence.pdf / Extracted KPIs");
    expect(artifact.meta?.providerParse?.sourceStorageId).toBe("convex-storage-123");
    expect(artifact.meta?.providerParse?.sourceArtifactId).toBe("artifact-raw");
    expect(artifact.meta?.providerParse?.providerFileId).toBe("gemini-file-abc");
    expect(artifact.meta?.dataframe?.parser).toBe("provider:gemini:gemini-3.5-flash");
    const cell = artifact.seed.find((s) => s.id === "p1__metric")?.value as CellPayload;
    expect(cell.value).toBe("ARR");
    expect(cell.evidence?.[0]?.kind).toBe("source");
    expect(cell.evidence?.[0]?.id).toContain("gemini-file-abc");
    expect(cell.evidence?.[0]).toMatchObject({
      sourceStorageId: "convex-storage-123",
      sourceArtifactId: "artifact-raw",
      providerFileId: "gemini-file-abc",
      page: 4,
      bbox: { x: 0.12, y: 0.2, width: 0.4, height: 0.08, unit: "normalized" },
    });
  });
});
