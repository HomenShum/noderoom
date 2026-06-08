import type { DocumentParseMeta, DocumentParseOutput, DocumentParseRuntime } from "../engine/types";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const OFFICE_MIME = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroEnabled.12",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  "application/vnd.oasis.opendocument.presentation",
]);

const PDF_OUTPUTS: DocumentParseOutput[] = ["text", "pages", "bounding_boxes", "screenshots", "ocr"];
const OFFICE_OUTPUTS: DocumentParseOutput[] = ["text", "pages", "bounding_boxes", "screenshots", "ocr"];
const IMAGE_OUTPUTS: DocumentParseOutput[] = ["text", "pages", "bounding_boxes", "ocr"];

export function guessDocumentMimeType(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  const ext = Object.keys(MIME_BY_EXTENSION).find((suffix) => lower.endsWith(suffix));
  return ext ? MIME_BY_EXTENSION[ext] : undefined;
}

export function documentParsePlan(fileName: string, mimeType = ""): DocumentParseMeta | undefined {
  const normalizedMime = mimeType || guessDocumentMimeType(fileName) || "";
  if (normalizedMime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    return plan(PDF_OUTPUTS, ["node", "ocr"], "PDF layout, screenshots, OCR, and line-level bounding boxes.");
  }
  if (normalizedMime.startsWith("image/") || /\.(png|jpe?g|gif|bmp|tiff?|webp|svg)$/i.test(fileName)) {
    return plan(IMAGE_OUTPUTS, ["node", "imagemagick", "ocr"], "Image or screenshot OCR with bounding boxes.");
  }
  if (OFFICE_MIME.has(normalizedMime) || /\.(docx?|docm|odt|rtf|pptx?|pptm|odp)$/i.test(fileName)) {
    return plan(OFFICE_OUTPUTS, ["node", "libreoffice", "ocr"], "Office document conversion plus layout extraction.");
  }
  return undefined;
}

function plan(outputs: DocumentParseOutput[], requiredRuntime: DocumentParseRuntime[], note: string): DocumentParseMeta {
  return {
    parser: "provider",
    fallbackParser: "liteparse",
    lane: "document_layout",
    status: "server_parser_required",
    outputs,
    requiredRuntime,
    note: `Provider multimodal extraction is primary; LiteParse is the deterministic fallback/conversion lane. ${note}`,
  };
}
