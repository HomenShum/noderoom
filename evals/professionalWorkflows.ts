export type ProfessionalWorkflowCategory =
  | "gtm_company_research"
  | "finance_ops"
  | "eval_harness"
  | "analytics_optimization"
  | "legacy_agent_outputs";

export type ProfessionalHarnessRequirement =
  | "artifact_refs"
  | "cell_payload_evidence"
  | "schema_detection"
  | "spreadsheet_semantic_index"
  | "formula_dependency_locks"
  | "cross_file_context"
  | "privacy_redaction"
  | "provider_parser_adapter"
  | "liteparse_layout_fallback"
  | "long_running_free_auto"
  | "workflow_checkpoint_resume"
  | "resolved_model_audit"
  | "private_gold_pack"
  | "answer_key_formula_oracle"
  | "formula_structure_equivalence"
  | "guide_mode_no_write"
  | "section_collaboration_locks"
  | "wiki_grounded_update"
  | "human_review";

export interface ProfessionalFileProfileSummary {
  manifestFiles: number;
  csvFiles: number;
  xlsxFiles: number;
  categoryCounts: Record<ProfessionalWorkflowCategory | "mixed", number>;
  piiHeaderSignals: number;
  formulaSampleFiles: number;
  mergedCellFiles: number;
  notes: string[];
}

export interface ProfessionalEvalCase {
  id: string;
  category: ProfessionalWorkflowCategory;
  persona: string;
  workflow: string;
  sourcePatterns: string[];
  agentGoal: string;
  fixtureStrategy: string;
  evalSteps: string[];
  assertions: string[];
  requiredHarness: ProfessionalHarnessRequirement[];
  productionNotes: string[];
}

export const PROFESSIONAL_FILE_PROFILE_SUMMARY: ProfessionalFileProfileSummary = {
  manifestFiles: 70,
  csvFiles: 23,
  xlsxFiles: 47,
  categoryCounts: {
    gtm_company_research: 46,
    finance_ops: 11,
    eval_harness: 2,
    analytics_optimization: 3,
    legacy_agent_outputs: 3,
    mixed: 5,
  },
  piiHeaderSignals: 47,
  formulaSampleFiles: 16,
  mergedCellFiles: 18,
  notes: [
    "The profile stores only workbook shapes, categories, and header-level signals; raw private rows are not a repo artifact.",
    "Most files are company research, classification, PitchBook, ParselyFi, or healthtech/JPM workflows.",
    "Finance and ops files include timecards, timesheets, expense sheets, cost exports, and transaction exports with formula and layout concerns.",
  ],
};

export const PROFESSIONAL_WORKFLOW_CASES: ProfessionalEvalCase[] = [
  {
    id: "gtm-pitchbook-company-match-enrich",
    category: "gtm_company_research",
    persona: "Sales operations analyst preparing a PitchBook upload and match review",
    workflow: "Match uploaded company rows against a PitchBook-style result sheet, preserve original CRM columns, and write sourced match confidence.",
    sourcePatterns: [
      "PitchBook_Upload_Template*.csv",
      "PitchBook_Upload_List_Results_*.csv",
      "companies*.csv",
    ],
    agentGoal:
      "For each uploaded company, compare firm name, website, HQ location, and ticker against the matched result row; write match status, confidence, and short evidence without overwriting source CRM fields.",
    fixtureStrategy:
      "Use a redacted 12-row fixture with exact, fuzzy, missing-domain, duplicate-name, and wrong-location matches.",
    evalSteps: [
      "Upload the template and result files as separate artifacts.",
      "Drag both artifacts into chat as references.",
      "Run the agent against the company-match goal.",
      "Inspect changed cells, trace, and generated review note.",
    ],
    assertions: [
      "Every new match/status cell is a CellPayload with at least one evidence item pointing to a source artifact and row.",
      "Original firm name, website, HQ, country, and ticker cells are unchanged.",
      "Ambiguous duplicate-name rows are marked needs_review instead of guessed.",
      "The trace contains cross-file reads before writes and no stale baseVersion write succeeds.",
    ],
    requiredHarness: [
      "artifact_refs",
      "cell_payload_evidence",
      "schema_detection",
      "cross_file_context",
      "spreadsheet_semantic_index",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is the strongest GTM demo because it proves file references, cross-file context, evidence, and no-clobber on a familiar sales-ops list.",
      "For live data, provider research may enrich blanks, but source-list reconciliation should stay deterministic and auditable.",
    ],
  },
  {
    id: "gtm-healthtech-sector-classification",
    category: "gtm_company_research",
    persona: "Healthcare investor classifying a large conference or PitchBook export",
    workflow: "Classify healthtech companies by sector/tag using descriptions, industry codes, websites, and prior classification outputs.",
    sourcePatterns: [
      "Eva List*.xlsx",
      "Eva list*.csv",
      "FDAC_Cleaned*.xlsx",
      "Jason_Sector_Tag*.xlsx",
      "*parsely_classification_output.xlsx",
      "JPM 2025 Health Conference.xlsx",
    ],
    agentGoal:
      "Classify or validate sector tags for each company; write the tag, confidence, and reason with evidence from company description and any provided prior output.",
    fixtureStrategy:
      "Create a 30-row redacted even-split sector fixture with expected labels from the existing ParselyFi output files.",
    evalSteps: [
      "Parse the source sheet and expected-output sheet.",
      "Run classification on a bounded row subset first, then on a long-running /free bulk path.",
      "Compare final labels and reasons against the expected fixture.",
      "Open the wiki update and verify the stable table of contents includes the classification summary.",
    ],
    assertions: [
      "Accuracy and macro-F1 meet the fixture threshold, with per-row reasons present.",
      "Each written classification is a CellPayload with source artifact, row, and column evidence.",
      "Rows with insufficient description are marked needs_review and do not receive fabricated detail.",
      "Bulk mode checkpoints between slices, records resolvedModel per attempt, and avoids duplicate final writes.",
    ],
    requiredHarness: [
      "cell_payload_evidence",
      "schema_detection",
      "spreadsheet_semantic_index",
      "long_running_free_auto",
      "workflow_checkpoint_resume",
      "resolved_model_audit",
      "wiki_grounded_update",
      "human_review",
    ],
    productionNotes: [
      "The 9,000+ row CSV is a natural stress test for context compaction, chunking, and long-running free-auto.",
      "The expected-output files should become redacted goldens rather than live private fixtures.",
    ],
  },
  {
    id: "gtm-intent-classifier-golden",
    category: "gtm_company_research",
    persona: "Harness engineer validating a query-to-classification model before production routing",
    workflow: "Predict labels from query/classification CSV fixtures and score exact label and macro-F1 performance.",
    sourcePatterns: [
      "ClassificationDataset - EvenSplit-300_NoLLM.csv",
      "Barbara_list_classification_reasoning.csv",
    ],
    agentGoal:
      "Classify each query or company-description row against the allowed taxonomy, normalize whitespace/case, and write label, confidence, and reason with source evidence.",
    fixtureStrategy:
      "Use a redacted balanced classification fixture with allowed labels, noisy whitespace, short ambiguous queries, and reason columns.",
    evalSteps: [
      "Parse the query/classification fixture.",
      "Run deterministic scripted labels and optional live-provider classification.",
      "Compute exact label accuracy and macro-F1.",
      "Store disagreements as needs_review rows for taxonomy review.",
    ],
    assertions: [
      "Predicted labels match the allowed taxonomy and never introduce a new label string.",
      "Exact label accuracy and macro-F1 meet the configured threshold.",
      "Reasons include evidence from source query or description fields and avoid name-only guessing.",
      "Ambiguous or taxonomy-missing rows are marked needs_review instead of forced into a label.",
    ],
    requiredHarness: [
      "schema_detection",
      "cell_payload_evidence",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is the most direct way to convert existing classification data into a measurable eval.",
      "Small or noisy gold labels should be treated as review data, not unquestioned truth.",
    ],
  },
  {
    id: "gtm-amo-signal-scorer",
    category: "gtm_company_research",
    persona: "GTM analyst scoring target accounts against a reusable AMO rubric",
    workflow: "Apply AMO seller-insight signals to company rows as tier/evidence pairs plus total score, coverage, and confidence.",
    sourcePatterns: [
      "AMO_Seller_Insights___Scoring_Framework.csv",
      "companies_modified_*.csv",
    ],
    agentGoal:
      "For each company, evaluate the AMO scoring framework, write signal tier and evidence pairs, compute total score/coverage/confidence, and leave unknown signals explicitly unknown.",
    fixtureStrategy:
      "Use a synthetic company list with 14 signal columns, evidence columns, one no-domain row, one conflicting evidence row, and one missing-description row.",
    evalSteps: [
      "Load the scoring framework and target company sheet.",
      "Search only the relevant company/context rows for each score.",
      "Write tier/evidence CellPayloads and aggregate score fields.",
      "Review rows with missing or conflicting evidence before finalizing.",
    ],
    assertions: [
      "All tier values are in the allowed rubric bands.",
      "Every non-unknown tier includes source evidence and confidence.",
      "TotalScore, Coverage, and Confidence are consistent with the populated signal cells.",
      "Bulk /free route records checkpoints, resolvedModel, and no duplicate final writes.",
      "Missing-domain or weak-evidence rows are not over-scored.",
    ],
    requiredHarness: [
      "spreadsheet_semantic_index",
      "cell_payload_evidence",
      "long_running_free_auto",
      "workflow_checkpoint_resume",
      "resolved_model_audit",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is a strong featured `/free` case: free-auto can work slowly through many independent company/signal cells while preserving provenance.",
      "A paid model should remain the interactive default for live collaboration edits.",
    ],
  },
  {
    id: "gtm-jpm-market-map-joins",
    category: "gtm_company_research",
    persona: "Investor building a JPM health market map from multiple workbook tabs",
    workflow: "Join company, product/service, partnership, and segment tabs into a cited watchlist.",
    sourcePatterns: [
      "JPM 2025 Health Conference.xlsx",
      "jpmhealth_2025_dummy.xlsx",
    ],
    agentGoal:
      "Join company rows to product/service and partnership context, summarize relevant segments, and write a watchlist with URLs or source-field evidence.",
    fixtureStrategy:
      "Use a synthetic three-sheet JPM fixture with duplicate company names, missing product rows, and one conflicting partnership field.",
    evalSteps: [
      "Parse all workbook sheets and identify join keys.",
      "Search company/product/partnership chunks for each watchlist candidate.",
      "Write a cited market-map row and note for each company.",
      "Flag missing or conflicting joins for review.",
    ],
    assertions: [
      "Companies are not conflated with similarly named products or partners.",
      "Missing product or partnership fields are marked unknown instead of invented.",
      "Each watchlist row cites source artifact, sheet, row, and URL field where available.",
      "Duplicate-name joins require disambiguating evidence before a write is marked complete.",
    ],
    requiredHarness: [
      "cross_file_context",
      "spreadsheet_semantic_index",
      "cell_payload_evidence",
      "artifact_refs",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This case exercises multi-sheet context retrieval and entity resolution beyond simple row classification.",
      "Time-sensitive public claims should use frozen evidence snapshots in evals.",
    ],
  },
  {
    id: "gtm-sbb-one-column-extraction",
    category: "gtm_company_research",
    persona: "Analyst turning one-column extracted content into structured entities",
    workflow: "Segment a one-column extracted-content sheet into company/entity rows with field provenance.",
    sourcePatterns: [
      "SBB List  (2).xlsx",
      "Find_SFSUBLS_Info.xlsx",
    ],
    agentGoal:
      "Segment extracted text lines into structured entity rows, populate known fields, leave unknown fields blank, and cite line or row spans for every extracted claim.",
    fixtureStrategy:
      "Use a synthetic one-column extracted-content sheet with separators, repeated company names, missing fields, and one malformed block.",
    evalSteps: [
      "Parse the one-column content artifact.",
      "Detect entity boundaries and candidate fields.",
      "Write normalized structured rows with provenance line references.",
      "Generate an exception note for malformed or incomplete blocks.",
    ],
    assertions: [
      "Entity boundaries match the expected fixture blocks.",
      "No fields are invented when a block lacks evidence.",
      "Every extracted field cites source row or line-span evidence.",
      "Malformed blocks are retained as needs_review rather than dropped.",
    ],
    requiredHarness: [
      "schema_detection",
      "cell_payload_evidence",
      "spreadsheet_semantic_index",
      "artifact_refs",
      "human_review",
    ],
    productionNotes: [
      "This protects against overtrusting row 1 as a header and against losing unstructured extraction provenance.",
    ],
  },
  {
    id: "gtm-company-deep-report",
    category: "gtm_company_research",
    persona: "Account executive or analyst building a company brief for outreach",
    workflow: "Turn one company name or report workbook into a multi-sheet, source-linked company overview and next-action note.",
    sourcePatterns: [
      "parselyfi_*_Report_*.xlsx",
      "company_analysis_report.xlsx",
      "company_pitchbook_info_*.xlsx",
    ],
    agentGoal:
      "Summarize company overview, funding, traction, customers, risks, and recommended outreach angle into a wiki/note while keeping each claim linked to its source sheet.",
    fixtureStrategy:
      "Use a redacted two-company workbook with expected cited claims and one deliberately conflicting source value.",
    evalSteps: [
      "Upload a multi-sheet company report.",
      "Ask the agent to produce a brief and update the room wiki.",
      "Click every cited artifact reference from the generated note.",
      "Run a contradiction check between sheets before the final summary.",
    ],
    assertions: [
      "The summary includes only claims grounded in room-visible artifacts.",
      "Conflicting values are called out as conflicts instead of silently resolved.",
      "Every cited file reference is clickable and resolves to an artifact.",
      "No private-channel context appears in the public wiki update.",
    ],
    requiredHarness: [
      "artifact_refs",
      "cross_file_context",
      "provider_parser_adapter",
      "wiki_grounded_update",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This evaluates the interview story that the wiki is an agent-managed memory surface, not uncited chat memory.",
      "Provider file ids can be cached for extraction, but evidence must point to durable NodeRoom artifact ids.",
    ],
  },
  {
    id: "gtm-pii-masking-and-public-private-boundary",
    category: "gtm_company_research",
    persona: "Founder sharing a diligence room with collaborators",
    workflow: "Upload contact-heavy event or business-card files and generate a public summary without leaking sensitive fields.",
    sourcePatterns: [
      "2024.01 - Healthtech Talent Mixer*.xlsx",
      "Pitchbook Test PII Masking.xlsx",
      "Cafe_Corner_-_Business Card_*.xlsx",
    ],
    agentGoal:
      "Create a public-facing summary of companies and attendance signals while masking direct email, phone, address, and contact details unless explicitly requested in private.",
    fixtureStrategy:
      "Use a redacted event fixture retaining PII-like column names and fake values.",
    evalSteps: [
      "Upload a contact-rich workbook.",
      "Ask the public agent for a summary.",
      "Ask the private agent for the same artifact and compare allowed detail.",
      "Verify public artifact references remain clickable without exposing raw private values inline.",
    ],
    assertions: [
      "Public response masks or omits email, phone, address, contact names, account identifiers, and raw messages.",
      "The private response can reference sensitive columns only when the actor has room access.",
      "The audit trace records the artifact id and redaction decision.",
      "The agent never copies sensitive cell values into the wiki by default.",
    ],
    requiredHarness: [
      "artifact_refs",
      "privacy_redaction",
      "cross_file_context",
      "wiki_grounded_update",
      "human_review",
    ],
    productionNotes: [
      "Forty-seven profiled files had header-level PII signals, so privacy is a first-class eval dimension.",
      "Use fake fixture values for CI; never commit real local contact rows.",
    ],
  },
  {
    id: "finance-cost-reconciliation",
    category: "finance_ops",
    persona: "Finance analyst reconciling model/vendor spend",
    workflow: "Reconcile exported AI costs against a parsed/output workbook and write variance notes only where needed.",
    sourcePatterns: [
      "openai_cost-*.csv",
      "openai_cost-*_parsely_output.xlsx",
      "business income & expense sheet.xlsx",
    ],
    agentGoal:
      "Aggregate spend by date and model/vendor, compare against expected totals, write variance and note cells with evidence, and skip already-correct cells.",
    fixtureStrategy:
      "Use a 10-day redacted spend fixture with one already-correct value, one wrong value, one missing category, and one currency mismatch.",
    evalSteps: [
      "Upload source and expected/reconciled files.",
      "Run reconcile_cell or agent-mediated reconciliation.",
      "Inspect formula-dependent locks and skipped/corrected cells.",
      "Export a review note summarizing unresolved exceptions.",
    ],
    assertions: [
      "Already-correct cells are skipped without version bumps.",
      "Incorrect cells are corrected only after a current read and CAS-protected write.",
      "Formula children are locked or flagged when parent input cells are edited.",
      "Each variance note cites the source artifact, row, and model/vendor column.",
    ],
    requiredHarness: [
      "cell_payload_evidence",
      "formula_dependency_locks",
      "spreadsheet_semantic_index",
      "cross_file_context",
      "artifact_refs",
      "human_review",
    ],
    productionNotes: [
      "This maps directly to finance close/reconciliation interviews: source data, derived outputs, explainable differences, and no blind overwrites.",
      "The current reconcile_cell tool covers the deterministic core; broader financial math fixtures should expand next.",
    ],
  },
  {
    id: "finance-three-statement-modeling-private-gold",
    category: "finance_ops",
    persona: "Investment-banking candidate or finance team completing a 3-statement modeling test",
    workflow: "Upload a private three-statement modeling-test workbook with a hidden answer key, then ask NodeAgent to solve it, guide the user through it, or collaborate with teammates by section.",
    sourcePatterns: [
      "[rareliquid] 3 Statement Modeling Test.xlsx",
      "Ben Chon / RareLiquid-style 3-statement modeling test",
      "private local gold pack with Test Prompt, Historical Data, Your Model, Answer Key",
    ],
    agentGoal:
      "Use the uploaded workbook as a private gold pack: in solve mode, fill FY2025E/FY2026E formulas in the user's model; in guide mode, coach without writing answer cells; in collaborate mode, edit only leased statement sections while preserving teammate changes and cross-statement checks.",
    fixtureStrategy:
      "Keep the copyrighted workbook and answer key outside the public repo. The public eval stores only the contract; the private runner validates the local workbook by content hash and skips honestly when the file is absent.",
    evalSteps: [
      "Validate the private workbook has Test Prompt, Historical Data, Your Model, and Answer Key sheets.",
      "Solve mode: run NodeAgent against a fresh copy of the user model and compare forecast formulas and values against the Answer Key tolerance.",
      "Guide mode: inject a scripted student mistake, require a targeted hint, and assert no forecast answer cells are written.",
      "Collaborate mode: assign income statement, cash flow, and balance sheet ranges to teammates and NodeAgent; require section locks, drafts when blocked, CAS on linkage rows, and final balance checks.",
    ],
    assertions: [
      "Forecast cells are formulas and mention the correct driver/assumption references; pasted answer-key values fail.",
      "Historical Data, Test Prompt, assumptions, and non-target sections remain unchanged.",
      "Cash flow ending cash ties to balance sheet cash, retained earnings rolls forward, debt/revolver links hold, and balance checks equal zero.",
      "Guide mode writes no answer cells and produces the next useful hint instead of dumping the answer key.",
      "Collaborate mode touches only the leased section, drafts when blocked, and preserves human edits to shared linkage rows.",
      "Private workbook contents and answer-key values are never copied into public repo artifacts or public room summaries.",
    ],
    requiredHarness: [
      "private_gold_pack",
      "answer_key_formula_oracle",
      "formula_structure_equivalence",
      "formula_dependency_locks",
      "privacy_redaction",
      "guide_mode_no_write",
      "section_collaboration_locks",
      "workflow_checkpoint_resume",
      "human_review",
    ],
    productionNotes: [
      "This is the first finance-modeling gold pack: deterministic enough to grade without an LLM judge, but private because the educational workbook is not ours to commit.",
      "It should run before the SEC flagship because it validates spreadsheet mechanics before adding XBRL extraction and filing citation complexity.",
      "The prompt ambiguity must be explicit in the eval: interest uses beginning debt balances per the workbook note to avoid circularity.",
    ],
  },
  {
    id: "finance-accountant-template-population",
    category: "finance_ops",
    persona: "Small-business operator preparing accountant-ready income and expense support",
    workflow: "Fill a fixed business income/expense template from categorized source transactions while preserving the template layout.",
    sourcePatterns: [
      "business income & expense sheet.xlsx",
      "XXXX-X020.CSV",
      "*income*expense*.xlsx",
    ],
    agentGoal:
      "Map source transaction categories into the accountant template rows, write totals and notes with evidence, preserve the bilingual fixed layout, and mark unmapped categories for review.",
    fixtureStrategy:
      "Use a synthetic A1:I80 accountant-template fixture plus fake categorized transactions with one unmapped category and one correction.",
    evalSteps: [
      "Parse the fixed template and source transaction file.",
      "Detect the template data-entry cells without shifting merged or label cells.",
      "Populate totals through CellPayload writes with source row evidence.",
      "Generate a correction note for unmapped or changed categories.",
    ],
    assertions: [
      "Template dimensions and labels remain stable; the agent does not rewrite the form structure.",
      "Every populated amount cites source rows and category-mapping evidence.",
      "Unmapped categories are marked needs_review instead of invented.",
      "Public notes mask raw transaction-level amounts unless the user requests a private detail view.",
    ],
    requiredHarness: [
      "schema_detection",
      "cell_payload_evidence",
      "artifact_refs",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is a form-fill workflow rather than a pure spreadsheet calculation workflow.",
      "Production needs a durable category-mapping artifact so corrections are explainable and reusable.",
    ],
  },
  {
    id: "finance-timesheet-invoice-review",
    category: "finance_ops",
    persona: "Ops or finance reviewer approving contractor time",
    workflow: "Review merged-layout timesheets and CSV timecards, compute totals, detect gaps/duplicates, and produce an approval note.",
    sourcePatterns: [
      "*Timecard.csv",
      "Ideaflow Timesheet*.xlsx",
    ],
    agentGoal:
      "Validate clock-in/out rows, regular/overtime totals, submitted metadata, and formula totals; write exceptions with evidence and leave formulas intact.",
    fixtureStrategy:
      "Use a fake two-week timesheet fixture with merged headers, formulas, one duplicate shift, one missing clock-out, and one overtime threshold.",
    evalSteps: [
      "Parse both CSV and XLSX layouts.",
      "Ask the agent to produce an approval recommendation.",
      "Attempt a correction while another actor edits a notes cell.",
      "Verify no formula cells are overwritten by scalar text.",
    ],
    assertions: [
      "Merged header/layout parsing identifies the real data region.",
      "Formula cells remain formulas unless the user explicitly asks for a formula edit.",
      "Exceptions cite row-level evidence and use needs_review status.",
      "Public review notes do not expose raw worker identity, clock, or payroll-like values unless explicitly authorized.",
      "Concurrent notes edits are protected by CAS or drafted.",
    ],
    requiredHarness: [
      "schema_detection",
      "formula_dependency_locks",
      "cell_payload_evidence",
      "provider_parser_adapter",
      "liteparse_layout_fallback",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is the practical bridge from spreadsheets to ERP approvals.",
      "LLM vision can help explain weird layouts, while deterministic parsing should preserve formulas and coordinates.",
    ],
  },
  {
    id: "finance-transaction-activity-summary",
    category: "finance_ops",
    persona: "Finance user summarizing account or brokerage activity",
    workflow: "Summarize transaction CSV activity by action/type without exposing individual sensitive line items.",
    sourcePatterns: [
      "Roth_Contributory_IRA_*_Transactions_*.csv",
      "XXXX-X020.CSV",
    ],
    agentGoal:
      "Classify transaction rows by action, symbol presence, amount, quantity, and fee fields; produce an aggregate activity summary with row-range evidence and privacy masking.",
    fixtureStrategy:
      "Use a fake transaction CSV with buy/sell/dividend/cash rows, blank symbols, blank prices, fees, and mixed signs.",
    evalSteps: [
      "Parse the transaction CSV and identify the action/date/amount schema.",
      "Aggregate by action and symbol availability.",
      "Write a summary note and exception table for ambiguous rows.",
      "Compare public and private response modes for raw line-item disclosure.",
    ],
    assertions: [
      "Blank symbol, price, quantity, and fee cells are handled without false assumptions.",
      "Signs are preserved from source values and not blindly inferred from action labels.",
      "The public summary masks raw account identifiers and individual transaction details.",
      "Aggregate claims cite row ranges or filtered source evidence.",
    ],
    requiredHarness: [
      "schema_detection",
      "cell_payload_evidence",
      "artifact_refs",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This case separates useful finance aggregation from unsafe line-item disclosure.",
      "It should use synthetic values in CI while keeping the real schema and sparsity pattern.",
    ],
  },
  {
    id: "eval-template-to-harness-run",
    category: "eval_harness",
    persona: "Harness engineer converting real workflows into regression tests",
    workflow: "Turn NodeBench fast/slow templates and UI mapping rows into executable, scored NodeRoom evals.",
    sourcePatterns: [
      "nodebench_fast_slow_*.csv",
      "ui_ux_mapping.csv",
    ],
    agentGoal:
      "Read the eval template rows, generate NodeRoom run cases with persona, preconditions, expected artifact state, trace assertions, and cost/runtime budgets.",
    fixtureStrategy:
      "Use the provided template structure with synthetic task rows so the suite can run in CI.",
    evalSteps: [
      "Parse case rows into typed eval definitions.",
      "Validate every case has outcome assertions and trajectory assertions.",
      "Run deterministic cases locally and mark live-provider cases as optional.",
      "Generate a leaderboard entry only from completed runs.",
    ],
    assertions: [
      "Every eval has a starting state, task, allowed tools, expected state, expected trace, and budget.",
      "Slow/free-auto cases are routed to /free and include checkpoint assertions.",
      "Interactive cases stay on the ladder-proven fast model.",
      "Results are stored without private source rows.",
    ],
    requiredHarness: [
      "long_running_free_auto",
      "workflow_checkpoint_resume",
      "resolved_model_audit",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is context-engineering work: convert messy human workflow evidence into stable harness cases.",
      "The eval catalog should grow from anonymized traces and synthetic adversarial rows, not from committed private spreadsheets.",
    ],
  },
  {
    id: "eval-ui-action-execution-map",
    category: "eval_harness",
    persona: "QA engineer mapping product actions to expected runtime behavior",
    workflow: "Convert UI action mapping rows into browser/API/data-flow eval steps with observable checkpoints.",
    sourcePatterns: [
      "ui_ux_mapping.csv",
      "nodebench_fast_slow_real_world_test_cases.csv",
    ],
    agentGoal:
      "Read each UI action mapping, identify the expected files/classes/data-flow sequence/execution layer, and produce runnable verification steps with expected artifact and trace state.",
    fixtureStrategy:
      "Use synthetic UI mapping rows that cover upload, drag reference, run collaboration, open artifact, cancel job, and retry job.",
    evalSteps: [
      "Parse the mapping CSV into action definitions.",
      "Generate a browser-visible step and backend assertion for each action.",
      "Run deterministic local checks for actions that do not need external providers.",
      "Store live-provider and long-running cases as optional eval lanes.",
    ],
    assertions: [
      "Every generated action has a UI selector or user action, expected tool/data layer, expected artifact state, and failure signal.",
      "Long-running UI actions include checkpoint, status-chip, resolvedModel, cancel, and retry assertions.",
      "Artifact-reference actions verify clickability and canonical artifact ids.",
      "No eval result includes raw private source rows.",
    ],
    requiredHarness: [
      "artifact_refs",
      "workflow_checkpoint_resume",
      "long_running_free_auto",
      "resolved_model_audit",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This turns UX mapping into a bridge between browser verification and agent trace verification.",
    ],
  },
  {
    id: "analytics-weighted-ranking",
    category: "analytics_optimization",
    persona: "Business user comparing options with adjustable criteria",
    workflow: "Rank options with weighted criteria and allow the user to adjust tradeoffs without losing provenance.",
    sourcePatterns: [
      "disneyland_hotel_optimization.csv",
      "Project 3 2026 Ideas*.xlsx",
    ],
    agentGoal:
      "Build a weighted score, explain the top options, and update ranking/notes when the user changes weights.",
    fixtureStrategy:
      "Use a small fake options table with cost, distance, quality, difficulty, and revenue-potential columns.",
    evalSteps: [
      "Parse the option table.",
      "Ask for a weighted recommendation.",
      "Change one weight and rerun.",
      "Check that dependent score/rank cells update and prior notes remain versioned.",
    ],
    assertions: [
      "Score and rank CellPayloads include evidence from visible source columns and the weight set used.",
      "Changing weights updates only dependent score/rank cells.",
      "The agent reports sensitivity where top choices flip.",
      "No unrelated option rows are edited.",
    ],
    requiredHarness: [
      "spreadsheet_semantic_index",
      "formula_dependency_locks",
      "cell_payload_evidence",
      "artifact_refs",
    ],
    productionNotes: [
      "Although less finance-specific, this tests a common spreadsheet-agent interaction: user-controlled assumptions plus reproducible outputs.",
    ],
  },
  {
    id: "analytics-workout-progress-dashboard",
    category: "analytics_optimization",
    persona: "User summarizing personal workout progress without dumping raw logs",
    workflow: "Join workout logs to exercise metadata, aggregate progress, and preserve unit semantics.",
    sourcePatterns: [
      "workout_data.csv",
      "Gym Exercises Dataset.xlsx",
    ],
    agentGoal:
      "Group workout sets by session and exercise, compute volume or duration summaries where appropriate, join exercise metadata, and write a privacy-safe progress dashboard.",
    fixtureStrategy:
      "Use synthetic workout rows with strength, cardio, superset, blank RPE, and missing exercise metadata cases.",
    evalSteps: [
      "Parse the workout log and exercise reference sheet.",
      "Join exercises by title/name where possible.",
      "Compute separate strength volume and cardio duration/distance summaries.",
      "Produce a public-safe dashboard note and a private detailed artifact.",
    ],
    assertions: [
      "Dashboard CellPayloads include evidence from workout log rows and exercise metadata rows where joined.",
      "Strength, cardio, duration, distance, and bodyweight units are not mixed into one score.",
      "Blank RPE, notes, and descriptions remain empty or unknown rather than invented.",
      "Superset identifiers are preserved in the grouped output.",
      "Public summaries mask raw timestamps and do not dump complete workout rows.",
    ],
    requiredHarness: [
      "schema_detection",
      "cell_payload_evidence",
      "cross_file_context",
      "artifact_refs",
      "privacy_redaction",
      "human_review",
    ],
    productionNotes: [
      "This is a personal analytics case that stresses grouping, joins, sparse optional fields, and privacy defaults.",
    ],
  },
  {
    id: "legacy-output-migration",
    category: "legacy_agent_outputs",
    persona: "Founder migrating old Cafe Corner outputs into a durable room wiki",
    workflow: "Import old generated business-card, chat, chart, and summary files into structured artifacts with clickable source references.",
    sourcePatterns: [
      "Cafe_Corner_*.xlsx",
    ],
    agentGoal:
      "Normalize legacy agent output files into current NodeRoom artifacts, deduplicate contacts/summaries, and update a cited wiki table of contents.",
    fixtureStrategy:
      "Use fake legacy output files with one duplicate contact and one chat summary that references a file.",
    evalSteps: [
      "Upload the legacy files.",
      "Ask the agent to build a migration summary and wiki update.",
      "Click source references from the wiki.",
      "Re-run the migration and assert idempotency.",
    ],
    assertions: [
      "Repeated migration does not duplicate wiki sections or contact rows.",
      "Every imported section cites the source artifact id.",
      "PII-like fields are masked in public summaries.",
      "The table of contents remains stable after the second run.",
    ],
    requiredHarness: [
      "artifact_refs",
      "wiki_grounded_update",
      "privacy_redaction",
      "cross_file_context",
      "human_review",
    ],
    productionNotes: [
      "This keeps the self-updating wiki story concrete: it can ingest prior artifacts, but only through stable citation and idempotency rules.",
    ],
  },
];
