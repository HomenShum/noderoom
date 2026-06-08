import { describe, expect, it } from "vitest";
import { documentParsePlan, guessDocumentMimeType } from "../src/app/documentParserPlan";

describe("document parser plan", () => {
  it("routes PDFs to provider-first document parsing with LiteParse fallback", () => {
    const plan = documentParsePlan("close-package.pdf", "application/pdf");

    expect(plan?.parser).toBe("provider");
    expect(plan?.fallbackParser).toBe("liteparse");
    expect(plan?.lane).toBe("document_layout");
    expect(plan?.outputs).toContain("bounding_boxes");
    expect(plan?.outputs).toContain("screenshots");
  });

  it("routes Office decks through LibreOffice-backed document parsing", () => {
    const plan = documentParsePlan("sales-deck.pptx", "");

    expect(guessDocumentMimeType("sales-deck.pptx")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(plan?.requiredRuntime).toContain("libreoffice");
    expect(plan?.outputs).toContain("ocr");
  });

  it("routes screenshots through ImageMagick/OCR document parsing", () => {
    const plan = documentParsePlan("screen.png", "image/png");

    expect(plan?.requiredRuntime).toContain("imagemagick");
    expect(plan?.outputs).toContain("ocr");
  });
});
