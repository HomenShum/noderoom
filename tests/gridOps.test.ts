/**
 * Pure-logic proof for the grid ergonomics (range select, fill-down, and copy/paste). The
 * formula-ref rewrite is the risky path: a wrong shift silently writes wrong numbers, so it gets the
 * heaviest coverage with relative shifts, absolute ($) preservation, ranges, and quoted literals.
 */
import { describe, test, expect } from "vitest";
import { parseA1, toA1, rangeBox, boxSize, cellsInBox, rangeLabel, rewriteFormulaRefs, buildTSV, parseTSV } from "../src/shared/gridOps";

describe("A1 + range geometry", () => {
  test("parseA1 / toA1 round-trip incl. $ and multi-letter", () => {
    expect(parseA1("A1")).toEqual({ col: 1, row: 1 });
    expect(parseA1("$AA$12")).toEqual({ col: 27, row: 12 });
    expect(toA1(27, 12)).toBe("AA12");
    expect(parseA1("nope")).toBeNull();
  });
  test("rangeBox is order-independent", () => {
    expect(rangeBox("B3", "A1")).toEqual({ c0: 1, c1: 2, r0: 1, r1: 3 });
    expect(rangeBox("A1", "B3")).toEqual({ c0: 1, c1: 2, r0: 1, r1: 3 });
  });
  test("boxSize + cellsInBox + rangeLabel", () => {
    const box = rangeBox("A1", "B2")!;
    expect(boxSize(box)).toBe(4);
    expect(cellsInBox(box)).toEqual(["A1", "B1", "A2", "B2"]);
    expect(rangeLabel(box)).toBe("A1:B2");
    expect(rangeLabel(rangeBox("C5", "C5")!)).toBe("C5");
  });
});

describe("rewriteFormulaRefs - the fill-handle rule", () => {
  test("relative refs shift down", () => expect(rewriteFormulaRefs("=A1+B1", 1, 0)).toBe("=A2+B2"));
  test("row-absolute ($1) is preserved, column still relative", () => expect(rewriteFormulaRefs("=A$1+B1", 1, 0)).toBe("=A$1+B2"));
  test("column-absolute ($A) shifts its row only", () => expect(rewriteFormulaRefs("=$A1", 1, 0)).toBe("=$A2"));
  test("fully absolute ($A$1) never moves", () => expect(rewriteFormulaRefs("=$A$1", 5, 3)).toBe("=$A$1"));
  test("ranges shift both ends", () => expect(rewriteFormulaRefs("=SUM(A1:A3)", 2, 0)).toBe("=SUM(A3:A5)"));
  test("quoted literals are NOT mangled", () => expect(rewriteFormulaRefs('=CONCAT("A1",A1)', 1, 0)).toBe('=CONCAT("A1",A2)'));
  test("fill-right shifts columns", () => expect(rewriteFormulaRefs("=A1", 0, 1)).toBe("=B1"));
  test("mixed: =B$2*C3 down 1", () => expect(rewriteFormulaRefs("=B$2*C3", 1, 0)).toBe("=B$2*C4"));
  test("function names (SUM/VLOOKUP) survive untouched", () => expect(rewriteFormulaRefs('=VLOOKUP("x",A1:C9,2,FALSE)', 1, 0)).toBe('=VLOOKUP("x",A2:C10,2,FALSE)'));
  test("clamps below row 1 instead of going negative", () => expect(rewriteFormulaRefs("=A2", -5, 0)).toBe("=A1"));
  test("no-op when both deltas are 0", () => expect(rewriteFormulaRefs("=A1+B2", 0, 0)).toBe("=A1+B2"));
});

describe("TSV (clipboard copy/paste)", () => {
  test("buildTSV", () => expect(buildTSV([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td"));
  test("parseTSV tolerates trailing newline + CRLF", () => expect(parseTSV("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]));
  test("parseTSV empty -> []", () => expect(parseTSV("")).toEqual([]));
  test("round-trip", () => {
    const g = [["1", "2"], ["3", "4"]];
    expect(parseTSV(buildTSV(g))).toEqual(g);
  });
});
