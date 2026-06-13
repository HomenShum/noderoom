import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export type SpreadsheetBenchChartScoreOptions = {
  taskId: string;
  candidateWorkbookPath: string;
  goldWorkbookPath: string;
  generatedAt?: string;
};

export type SpreadsheetBenchChartPart = {
  path: string;
  kind: "chart" | "drawing";
  sha256: string;
  bytes: number;
};

export type SpreadsheetBenchChartMismatch = {
  kind: "missing_chart_part" | "extra_chart_part" | "chart_xml";
  path: string;
  expected?: string;
  actual?: string;
};

export type SpreadsheetBenchChartScore = {
  schema: 1;
  generatedAt?: string;
  taskId: string;
  candidateWorkbook: string;
  goldWorkbook: string;
  verifier: "xlsx_chart_package_static";
  totals: {
    goldChartParts: number;
    candidateChartParts: number;
    matchedChartParts: number;
    missingChartParts: number;
    extraChartParts: number;
    mismatchedChartParts: number;
  };
  scores: {
    package: number;
  };
  pass: boolean;
  candidateParts: SpreadsheetBenchChartPart[];
  goldParts: SpreadsheetBenchChartPart[];
  mismatches: SpreadsheetBenchChartMismatch[];
  warnings: string[];
};

type ZipEntry = {
  path: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export function scoreSpreadsheetBenchCharts(options: SpreadsheetBenchChartScoreOptions): SpreadsheetBenchChartScore {
  const candidateParts = chartParts(options.candidateWorkbookPath);
  const goldParts = chartParts(options.goldWorkbookPath);
  const candidateByPath = new Map(candidateParts.map((part) => [part.path, part]));
  const goldByPath = new Map(goldParts.map((part) => [part.path, part]));
  const mismatches: SpreadsheetBenchChartMismatch[] = [];

  for (const goldPart of goldParts) {
    const candidatePart = candidateByPath.get(goldPart.path);
    if (!candidatePart) {
      mismatches.push({ kind: "missing_chart_part", path: goldPart.path, expected: goldPart.sha256 });
    } else if (candidatePart.sha256 !== goldPart.sha256) {
      mismatches.push({ kind: "chart_xml", path: goldPart.path, expected: goldPart.sha256, actual: candidatePart.sha256 });
    }
  }
  for (const candidatePart of candidateParts) {
    if (!goldByPath.has(candidatePart.path)) {
      mismatches.push({ kind: "extra_chart_part", path: candidatePart.path, actual: candidatePart.sha256 });
    }
  }

  const missingChartParts = mismatches.filter((item) => item.kind === "missing_chart_part").length;
  const extraChartParts = mismatches.filter((item) => item.kind === "extra_chart_part").length;
  const mismatchedChartParts = mismatches.filter((item) => item.kind === "chart_xml").length;
  const matchedChartParts = goldParts.length - missingChartParts - mismatchedChartParts;
  const comparedDenominator = Math.max(goldParts.length, candidateParts.length, 1);
  const packageScore = Number((matchedChartParts / comparedDenominator).toFixed(6));

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    taskId: options.taskId,
    candidateWorkbook: basename(options.candidateWorkbookPath),
    goldWorkbook: basename(options.goldWorkbookPath),
    verifier: "xlsx_chart_package_static",
    totals: {
      goldChartParts: goldParts.length,
      candidateChartParts: candidateParts.length,
      matchedChartParts,
      missingChartParts,
      extraChartParts,
      mismatchedChartParts,
    },
    scores: {
      package: packageScore,
    },
    pass: goldParts.length > 0 && mismatches.length === 0,
    candidateParts,
    goldParts,
    mismatches,
    warnings: [
      "xlsx_chart_package_static compares chart/drawing XML package parts only; it is not a rendered visual or VLM chart-quality grade.",
      ...(goldParts.length === 0 ? ["gold workbook has no chart or drawing XML parts"] : []),
    ],
  };
}

function chartParts(path: string): SpreadsheetBenchChartPart[] {
  const entries = readZipEntries(readFileSync(path));
  return entries
    .filter((entry) => isChartPart(entry.path))
    .map((entry) => {
      const content = readZipEntryContent(entries.buffer, entry);
      const normalized = normalizeXml(content.toString("utf8"));
      const kind: SpreadsheetBenchChartPart["kind"] = entry.path.startsWith("xl/charts/") ? "chart" : "drawing";
      return {
        path: entry.path,
        kind,
        sha256: createHash("sha256").update(normalized).digest("hex"),
        bytes: Buffer.byteLength(normalized),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function isChartPart(path: string): boolean {
  return /^xl\/charts\/chart[^/]+\.xml$/i.test(path) || /^xl\/drawings\/drawing[^/]+\.xml$/i.test(path);
}

function normalizeXml(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function readZipEntries(buffer: Buffer): ZipEntry[] & { buffer: Buffer } {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid ZIP central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const path = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replace(/\\/g, "/");
    entries.push({ path, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return Object.assign(entries, { buffer });
}

function readZipEntryContent(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`invalid ZIP local header for ${entry.path}`);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    const inflated = inflateRawSync(compressed);
    if (entry.uncompressedSize !== 0 && inflated.length !== entry.uncompressedSize) {
      throw new Error(`ZIP size mismatch for ${entry.path}`);
    }
    return inflated;
  }
  throw new Error(`unsupported ZIP compression method ${entry.method} for ${entry.path}`);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end of central directory not found");
}
