import type { CanonicalFileRef, ProviderExtraction } from "./providerParserAdapter";

export interface LiteParseAdapterResult {
  extraction: ProviderExtraction;
  pages: Array<{
    pageNum: number;
    width: number;
    height: number;
    text: string;
    textItems: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      confidence?: number;
    }>;
  }>;
}

export async function parseWithLiteParse(args: {
  file: CanonicalFileRef;
  bytes: Uint8Array;
  maxPages?: number;
  ocrEnabled?: boolean;
}): Promise<LiteParseAdapterResult> {
  const { LiteParse } = await import("@llamaindex/liteparse");
  const parser = new LiteParse({
    maxPages: args.maxPages ?? 20,
    ocrEnabled: args.ocrEnabled ?? true,
    quiet: true,
  });
  const parsed = await parser.parse(Buffer.from(args.bytes));
  const pages = parsed.pages.map((page) => ({
    pageNum: page.pageNum,
    width: page.width,
    height: page.height,
    text: page.text,
    textItems: page.textItems.map((item) => ({
      text: item.text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      confidence: item.confidence,
    })),
  }));
  const snippets = pages.flatMap((page) => page.textItems.slice(0, 20).map((item) => item.text)).filter(Boolean);
  return {
    pages,
    extraction: {
      summary: parsed.text.slice(0, 4_000),
      evidence: pages.slice(0, 8).map((page) => ({
        label: `${args.file.fileName} page ${page.pageNum}`,
        snippet: page.text.slice(0, 500),
        page: page.pageNum,
        confidence: page.textItems.some((item) => typeof item.confidence === "number") ? averageConfidence(page.textItems) : undefined,
      })),
      tables: snippets.length ? [{
        title: "LiteParse spatial text",
        columns: ["Page", "Text"],
        rows: pages.flatMap((page) => page.textItems.slice(0, 80).map((item) => [page.pageNum, item.text])),
        confidence: 0.8,
      }] : [],
      warnings: ["LiteParse fallback extraction records text and bounding boxes; provider extraction remains primary for semantic table interpretation."],
    },
  };
}

function averageConfidence(items: Array<{ confidence?: number }>): number | undefined {
  const values = items.map((item) => item.confidence).filter((n): n is number => typeof n === "number");
  if (!values.length) return undefined;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
