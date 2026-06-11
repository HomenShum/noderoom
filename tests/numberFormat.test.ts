/**
 * Excel number-format renderer — every supported token proven against the formats that occur in
 * real uploaded finance workbooks. Persona: the finance analyst who will close the tab the moment
 * 0.3374 renders where Excel shows 33.7%.
 */
import { describe, expect, it } from "vitest";
import { formatExcelNumber } from "../src/app/numberFormat";

describe("formatExcelNumber — finance workbook formats", () => {
  it("General: integers plain, floats trimmed like Excel", () => {
    expect(formatExcelNumber(468, undefined)).toBe("468");
    expect(formatExcelNumber(468, "General")).toBe("468");
    expect(formatExcelNumber(0.3374, "General")).toBe("0.3374");
    expect(formatExcelNumber(1 / 3, "General")).toBe("0.3333333333");
  });

  it("percent scales by 100 and renders the % sign", () => {
    expect(formatExcelNumber(0.3374, "0.0%")).toBe("33.7%");
    expect(formatExcelNumber(0.065, "0.0%")).toBe("6.5%");
    expect(formatExcelNumber(0.0645, "0.00%")).toBe("6.45%");
  });

  it("thousands grouping with fixed decimals", () => {
    expect(formatExcelNumber(1234.5, "#,##0")).toBe("1,235");
    expect(formatExcelNumber(1234.5, "#,##0.0")).toBe("1,234.5");
    expect(formatExcelNumber(502.5, "#,##0.0")).toBe("502.5");
  });

  it("currency from a literal $ and from [$...] tags", () => {
    expect(formatExcelNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(formatExcelNumber(1234.5, '[$$-409]#,##0')).toBe("$1,235");
  });

  it("negative section with parens — the accounting convention", () => {
    expect(formatExcelNumber(-5000, "#,##0;(#,##0)")).toBe("(5,000)");
    expect(formatExcelNumber(5000, "#,##0;(#,##0)")).toBe("5,000");
    expect(formatExcelNumber(-310.1, "#,##0.0;(#,##0.0)")).toBe("(310.1)");
  });

  it("single-section negative keeps the minus sign", () => {
    expect(formatExcelNumber(-310.1, "#,##0.0")).toBe("-310.1");
    expect(formatExcelNumber(-0.05, "0.0%")).toBe("-5.0%");
  });

  it("quoted literal suffixes survive — multiples and units", () => {
    expect(formatExcelNumber(2.5, '0.0"x"')).toBe("2.5x");
    expect(formatExcelNumber(45, '0" days"')).toBe("45 days");
  });

  it("color tags and padding tokens are stripped, not rendered", () => {
    expect(formatExcelNumber(-12, "#,##0;[Red](#,##0)")).toBe("(12)");
    expect(formatExcelNumber(1234, "_(#,##0_)")).toBe("1,234");
  });

  it("non-finite values fall back honestly", () => {
    expect(formatExcelNumber(Number.NaN, "0.0%")).toBe("NaN");
  });
});
