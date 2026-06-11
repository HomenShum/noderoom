/**
 * Excel-paper rendering of uploaded workbooks — the "it looks like the actual file" contract.
 *
 * Persona: a finance analyst uploads a styled model and must see Excel, not a themed table:
 * light paper, A1 headers, the FILE's number formats (33.7%, not 0.3374), bold/filled section
 * rows, a formula bar — while every edit still travels the lock/CAS path (the version bump in
 * the formula bar after an inline edit is the CAS receipt made visible).
 */
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterDemoRoom } from "./fixtures";

async function styledWorkbookFile(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Model");
  ws.getColumn(2).width = 26;
  ws.getCell("B2").value = "INCOME STATEMENT";
  ws.getCell("B2").font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  ws.mergeCells("B2:D2");
  ws.getCell("B4").value = "Gross margin %";
  ws.getCell("D4").value = 0.3374;
  ws.getCell("D4").numFmt = "0.0%";
  ws.getCell("B5").value = "EBIT";
  ws.getCell("D5").value = 65.8;
  ws.getCell("D5").numFmt = "#,##0.0";
  const buffer = await workbook.xlsx.writeBuffer();
  const dir = mkdtempSync(join(tmpdir(), "noderoom-xl-"));
  const path = join(dir, "model.xlsx");
  writeFileSync(path, Buffer.from(buffer as ArrayBuffer));
  return path;
}

test("uploaded workbook renders as Excel paper with file formats, formula bar, and CAS edits", async ({ page }) => {
  await enterDemoRoom(page);

  const path = await styledWorkbookFile();
  await page.locator(".r-file-input").setInputFiles(path);
  await page.getByRole("button", { name: /model\.xlsx/ }).click();

  // 1. The paper surface + Excel chrome render.
  const paper = page.getByTestId("excel-paper");
  await expect(paper).toBeVisible();
  await expect(paper.locator("th.xl-col").first()).toHaveText("A");

  // 2. The FILE's number formats render — the strongest "it's the real file" signal.
  await expect(paper.locator('[data-cell-key="D4"]')).toHaveText("33.7%");
  await expect(paper.locator('[data-cell-key="D5"]')).toHaveText("65.8");

  // 3. The file's styles render: bold, the FILE's white font color, and the B2:D2 merge as a
  //    real spanned cell (C2/D2 are absorbed, not rendered as empty cells).
  const header = paper.locator('[data-cell-key="B2"]');
  await expect(header).toHaveText("INCOME STATEMENT");
  await expect(header).toHaveCSS("font-weight", "700");
  await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(header).toHaveAttribute("colspan", "3");
  await expect(paper.locator('[data-cell-key="C2"]')).toHaveCount(0);
  await expect(paper.locator('[data-cell-key="D2"]')).toHaveCount(0);

  // 4. Selection drives the formula bar (Name box + value) and highlights headers.
  await paper.locator('[data-cell-key="D4"]').click();
  await expect(page.getByTestId("excel-namebox")).toHaveText("D4");
  await expect(page.getByTestId("excel-formulabar")).toContainText("0.3374");
  await expect(paper.locator("th.xl-col.hl")).toHaveText("D");

  // 5. An inline edit commits through CAS — the version visible in the bar is the receipt.
  const target = paper.locator('[data-cell-key="C5"]'); // empty in-bounds cell of the 5x4 grid
  await target.dblclick();
  await target.locator("input.xl-input").fill("123");
  await target.locator("input.xl-input").press("Enter");
  await expect(target).toHaveText("123");
  await target.click();
  await expect(page.locator(".xl-meta")).toContainText("v2"); // seeded v1 -> CAS write -> v2

  await page.screenshot({ path: "test-results/excel-paper.png", fullPage: false });
});
