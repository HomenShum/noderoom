import { parseWithLiteParse } from "../src/app/liteparseAdapter";

const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 36 96 Td (NodeRoom LiteParse) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000392 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
462
%%EOF`;

const file = {
  storageId: "local-liteparse-smoke",
  fileName: "liteparse-smoke.pdf",
  mimeType: "application/pdf",
  size: Buffer.byteLength(pdf),
};

const result = await parseWithLiteParse({
  file,
  bytes: Buffer.from(pdf, "utf8"),
  ocrEnabled: false,
  maxPages: 1,
});

const text = result.extraction.summary ?? "";
if (!text.includes("NodeRoom LiteParse")) throw new Error(`LiteParse smoke failed: ${text}`);

console.log(JSON.stringify({
  ok: true,
  pages: result.pages.length,
  textItems: result.pages[0]?.textItems.length ?? 0,
  summary: text,
}, null, 2));
