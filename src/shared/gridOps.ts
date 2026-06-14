/**
 * gridOps.ts - pure helpers for Excel-grid range selection, fill-down, and copy/paste.
 * No DOM, no deps beyond the A1 helpers in formulaEngine. Unit-tested in tests/gridOps.test.ts.
 */
import { colToIndex, indexToCol } from "../nodeagent/core/formulaEngine";

export interface Box { c0: number; c1: number; r0: number; r1: number } // 1-based, inclusive

const A1 = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/;
export function parseA1(id: string): { col: number; row: number } | null {
  const m = id.replace(/\$/g, "").toUpperCase().match(A1);
  return m ? { col: colToIndex(m[1]), row: Number(m[2]) } : null;
}
export function toA1(col: number, row: number): string {
  return indexToCol(col) + row;
}
/** The bounding box of two A1 corners (order-independent), or null if either is malformed. */
export function rangeBox(a: string, b: string): Box | null {
  const pa = parseA1(a), pb = parseA1(b);
  if (!pa || !pb) return null;
  return { c0: Math.min(pa.col, pb.col), c1: Math.max(pa.col, pb.col), r0: Math.min(pa.row, pb.row), r1: Math.max(pa.row, pb.row) };
}
/** Number of cells a box covers (for bound checks before committing). */
export function boxSize(box: Box): number {
  return (box.c1 - box.c0 + 1) * (box.r1 - box.r0 + 1);
}
/** Every A1 id inside a box, row-major. */
export function cellsInBox(box: Box): string[] {
  const out: string[] = [];
  for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) out.push(toA1(c, r));
  return out;
}
/** "A1" for a single cell, "A1:B3" for a range. */
export function rangeLabel(box: Box): string {
  const a = toA1(box.c0, box.r0);
  return box.c0 === box.c1 && box.r0 === box.r1 ? a : `${a}:${toA1(box.c1, box.r1)}`;
}

/**
 * Shift the RELATIVE cell references in a formula by (rowDelta, colDelta) - the fill-handle rule.
 * Absolute markers ($) are preserved and NOT shifted (A$1 keeps its row, $A1 keeps its column).
 * References inside double-quoted string literals are left untouched (so ="A1" is never mangled).
 * Negative results clamp to 1 (can't reference row/col < 1).
 */
export function rewriteFormulaRefs(formula: string, rowDelta: number, colDelta: number): string {
  if (!rowDelta && !colDelta) return formula;
  const parts = formula.split('"'); // even indices are outside quotes
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (full, cAbs: string, col: string, rAbs: string, row: string, offset: number, str: string) => {
      // Skip function-call tokens (a ref is never immediately followed by "(").
      if (str[offset + full.length] === "(") return full;
      const newCol = cAbs ? col : indexToCol(Math.max(1, colToIndex(col) + colDelta));
      const newRow = rAbs ? row : String(Math.max(1, Number(row) + rowDelta));
      return `${cAbs}${newCol}${rAbs}${newRow}`;
    });
  }
  return parts.join('"');
}

/** Build a TSV block from a 2D array of display strings (for clipboard copy). */
export function buildTSV(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}
/** Parse a clipboard TSV/CSV-ish block into a 2D array of strings (trailing newline tolerated). */
export function parseTSV(text: string): string[][] {
  const t = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (t === "") return [];
  return t.split("\n").map((line) => line.split("\t"));
}
