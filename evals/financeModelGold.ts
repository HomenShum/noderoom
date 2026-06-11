export const PRIVATE_FINANCE_MODEL_GOLD_ENV = "NODEAGENT_FINANCE_MODEL_GOLD_XLSX";

export type FinanceModelMode = "solve" | "guide" | "collaborate";

export type FinanceModelCriticalFormula = {
  cell: string;
  period: "FY2025E" | "FY2026E";
  section: "income_statement" | "cash_flow" | "balance_sheet";
  label: string;
  requiredRefs: string[];
  requiredTokens?: string[];
  why: string;
};

export type FinanceModelModeContract = {
  mode: FinanceModelMode;
  userIntent: string;
  mutationPolicy: "write_answer_cells" | "no_answer_cell_writes" | "section_bounded_writes";
  primaryChecks: string[];
};

export const FINANCE_MODEL_REQUIRED_SHEETS = [
  "Test Prompt",
  "Historical Data",
  "Your Model",
  "Answer Key",
] as const;

export const FINANCE_MODEL_FORECAST_PERIODS = [
  { column: "F", period: "FY2025E" },
  { column: "G", period: "FY2026E" },
] as const;

export const FINANCE_MODEL_CRITICAL_FORMULAS: FinanceModelCriticalFormula[] = [
  {
    cell: "F7",
    period: "FY2025E",
    section: "income_statement",
    label: "Revenue",
    requiredRefs: ["E7", "'Historical Data'!D98"],
    why: "Revenue must be forecast from prior-year revenue and the visible growth assumption.",
  },
  {
    cell: "G7",
    period: "FY2026E",
    section: "income_statement",
    label: "Revenue",
    requiredRefs: ["F7", "'Historical Data'!E98"],
    why: "Second forecast year must roll forward from the first forecast year, not from a hardcoded answer.",
  },
  {
    cell: "F8",
    period: "FY2025E",
    section: "income_statement",
    label: "COGS",
    requiredRefs: ["F7", "'Historical Data'!D99"],
    why: "COGS must derive from forecast revenue and the COGS percentage assumption.",
  },
  {
    cell: "F12",
    period: "FY2025E",
    section: "income_statement",
    label: "Depreciation and amortization",
    requiredRefs: ["E60", "'Historical Data'!D114", "'Historical Data'!D115"],
    why: "D&A should link to beginning PP&E and separate intangible amortization assumptions.",
  },
  {
    cell: "F16",
    period: "FY2025E",
    section: "income_statement",
    label: "Interest expense",
    requiredRefs: ["E69", "E74", "E73", "'Historical Data'!D120", "'Historical Data'!D121"],
    why: "Interest expense should follow the workbook convention and use beginning debt balances to avoid circularity.",
  },
  {
    cell: "F19",
    period: "FY2025E",
    section: "income_statement",
    label: "Income tax expense",
    requiredRefs: ["F18", "'Historical Data'!D102"],
    why: "Taxes must derive from pre-tax income and the effective tax rate assumption.",
  },
  {
    cell: "F36",
    period: "FY2025E",
    section: "cash_flow",
    label: "Net cash from operations",
    requiredRefs: ["F25", "F35"],
    requiredTokens: ["SUM"],
    why: "CFO must aggregate net income, non-cash items, and working capital changes.",
  },
  {
    cell: "F44",
    period: "FY2025E",
    section: "cash_flow",
    label: "Revolver draw / paydown",
    requiredRefs: ["E54", "F36", "F40", "F43", "F45", "'Historical Data'!D123", "'Historical Data'!D122", "E73"],
    requiredTokens: ["IF", "MIN"],
    why: "Revolver logic must respect minimum cash and capacity instead of plugging the balance sheet.",
  },
  {
    cell: "F50",
    period: "FY2025E",
    section: "cash_flow",
    label: "Ending cash",
    requiredRefs: ["F49", "F48"],
    why: "Ending cash must tie to beginning cash plus net change in cash.",
  },
  {
    cell: "F54",
    period: "FY2025E",
    section: "balance_sheet",
    label: "Cash and cash equivalents",
    requiredRefs: ["F50"],
    why: "Balance sheet cash must tie directly to cash flow ending cash.",
  },
  {
    cell: "F55",
    period: "FY2025E",
    section: "balance_sheet",
    label: "Accounts receivable",
    requiredRefs: ["F7", "'Historical Data'!D105"],
    why: "A/R must be driven by DSO and revenue, not copied from history.",
  },
  {
    cell: "F60",
    period: "FY2025E",
    section: "balance_sheet",
    label: "PP&E net",
    requiredRefs: ["E60", "F39", "'Historical Data'!D114"],
    why: "PP&E should roll forward from beginning balance, capex, and PP&E D&A.",
  },
  {
    cell: "F73",
    period: "FY2025E",
    section: "balance_sheet",
    label: "Revolver",
    requiredRefs: ["E73", "F44"],
    why: "Balance sheet revolver must tie to the cash-flow financing schedule.",
  },
  {
    cell: "F80",
    period: "FY2025E",
    section: "balance_sheet",
    label: "Retained earnings",
    requiredRefs: ["E80", "F20", "'Historical Data'!D128"],
    why: "Retained earnings must roll forward from net income and dividends.",
  },
  {
    cell: "F85",
    period: "FY2025E",
    section: "balance_sheet",
    label: "Balance check",
    requiredRefs: ["F64", "F83"],
    why: "The model must surface the balance sheet check rather than hiding a plug.",
  },
  {
    cell: "G85",
    period: "FY2026E",
    section: "balance_sheet",
    label: "Balance check",
    requiredRefs: ["G64", "G83"],
    why: "The second forecast period must also balance through linked statements.",
  },
];

export const FINANCE_MODEL_MODE_CONTRACTS: FinanceModelModeContract[] = [
  {
    mode: "solve",
    userIntent: "The user uploads the workbook and asks NodeAgent to complete the model autonomously.",
    mutationPolicy: "write_answer_cells",
    primaryChecks: [
      "fills only the forecast cells in the user's model surface",
      "writes formulas, not pasted answer-key values",
      "matches answer-key outputs within tolerance",
      "keeps historical data, prompt, and assumptions unchanged",
      "leaves a trace with read-before-write and section-level receipts",
    ],
  },
  {
    mode: "guide",
    userIntent: "The user wants coaching while they solve the test themselves.",
    mutationPolicy: "no_answer_cell_writes",
    primaryChecks: [
      "does not write forecast answer cells",
      "identifies the user's incorrect or missing formula concept",
      "gives the next smallest hint instead of revealing the full answer by default",
      "can escalate to explanation when explicitly asked",
    ],
  },
  {
    mode: "collaborate",
    userIntent: "A team splits the income statement, cash flow statement, and balance sheet while NodeAgent helps.",
    mutationPolicy: "section_bounded_writes",
    primaryChecks: [
      "leases only the section or cells it is actively editing",
      "drafts when a teammate holds a relevant section",
      "survives human edits to shared linkage rows without clobbering them",
      "finishes with cross-statement checks and review notes",
    ],
  },
];

export function normalizeExcelFormula(formula: string): string {
  return formula
    .trim()
    .replace(/^=/, "")
    .replace(/\$/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function formulaMentionsAllRefs(formula: string, refs: string[]): boolean {
  const normalizedFormula = normalizeExcelFormula(formula);
  return refs.every((ref) => normalizedFormula.includes(normalizeExcelFormula(ref)));
}

export function formulaMentionsAllTokens(formula: string, tokens: string[] = []): boolean {
  const normalizedFormula = normalizeExcelFormula(formula);
  return tokens.every((token) => normalizedFormula.includes(normalizeExcelFormula(token)));
}
