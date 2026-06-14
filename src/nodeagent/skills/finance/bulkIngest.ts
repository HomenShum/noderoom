import { parseDelimited, isSpreadsheetFile, isExcelWorkbook } from "../../../app/spreadsheetParser";

export interface BulkCompanyRow {
  company: string;
  website?: string;
  tier?: string;
  intent?: string;
  owner?: string;
  crmStatus?: string;
}

export function parseBulkCompanyCsv(text: string): BulkCompanyRow[] {
  const rows = parseDelimited(text, ",").filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) return [];
  const [header, ...body] = rows;
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase().replace(/\s+/g, "_"), i]));
  return body.map((row) => ({
    company: value(row, index, "company") || value(row, index, "account") || row[0] || "",
    website: value(row, index, "website"),
    tier: value(row, index, "tier"),
    intent: value(row, index, "intent"),
    owner: value(row, index, "owner"),
    crmStatus: value(row, index, "crm_status") || value(row, index, "status"),
  })).filter((row) => row.company.trim());
}

export { isSpreadsheetFile, isExcelWorkbook };

export function parseBulkCompanyIngest(text: string): BulkCompanyRow[] {
  const parsed: Array<BulkCompanyRow | null> = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, lineIndex): BulkCompanyRow | null => {
      const [company, website, tier, intent, owner, crmStatus] = line.split(/[\t|,]/).map((part) => part.trim()).filter(Boolean);
      if (lineIndex === 0 && isHeaderCell(company)) return null;
      const record: BulkCompanyRow = { company: company ?? "" };
      if (website) record.website = website;
      if (tier) record.tier = tier;
      if (intent) record.intent = intent;
      if (owner) record.owner = owner;
      if (crmStatus) record.crmStatus = crmStatus;
      return record;
    });
  return parsed.filter((row): row is BulkCompanyRow => row !== null && row.company.length > 0);
}

export function splitBulkCompanyRecords(records: BulkCompanyRow[], batchSize = 5): BulkCompanyRow[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const out: BulkCompanyRow[][] = [];
  for (let i = 0; i < records.length; i += size) out.push(records.slice(i, i + size));
  return out;
}

function value(row: string[], index: Map<string, number>, key: string): string | undefined {
  const i = index.get(key);
  return i === undefined ? undefined : row[i]?.trim();
}

function isHeaderCell(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_");
  return normalized === "company" || normalized === "account" || normalized === "company_name";
}
