import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PublicGoldManifest = {
  schema: string;
  cases: Array<{
    caseId: string;
    source: { sourceRecordFingerprint: string };
    expected: Record<string, unknown>;
    validators: string[];
  }>;
};

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(join(ROOT, "docs", "demo", "public-gold-demo-manifest.json"), "utf8")) as PublicGoldManifest;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

const expectedFingerprints = new Map([
  ["tat-dqa-impairment-change", sha256("tat-dqa-impairment-change|200657|50565|150092|thousand")],
  ["financebench_id_03029", sha256("financebench_id_03029|3M_2018_10K|page59|$1577.00|Purchases of property, plant and equipment (PP&E)")],
  ["sec-aapl-fy2023-xbrl", sha256("sec-aapl-fy2023-xbrl|0000320193-23-000106|RevenueFromContractWithCustomerExcludingAssessedTax=383285000000|NetIncomeLoss=96995000000|NetCashProvidedByUsedInOperatingActivities=110543000000")],
  ["noderoom-no-clobber-overlay", sha256("noderoom-no-clobber-overlay|stale write rejected|human edit preserved|review chip filed")],
]);

assert(manifest.schema === "noderoom.publicGoldDemo.v1", "unexpected manifest schema");
assert(manifest.cases.length === 4, "public-gold demo must contain exactly four proof rows");

for (const c of manifest.cases) {
  const expected = expectedFingerprints.get(c.caseId);
  assert(expected, `unknown public-gold case ${c.caseId}`);
  assert(c.source.sourceRecordFingerprint === expected, `fingerprint mismatch for ${c.caseId}`);
  assert(c.validators.length >= 3, `${c.caseId} needs at least three validators`);
}

const tat = manifest.cases.find((c) => c.caseId === "tat-dqa-impairment-change")!;
assert(tat.expected.formula === "=200657-50565", "TAT-DQA formula drifted");
assert(tat.expected.value === 150092, "TAT-DQA answer drifted");
assert(tat.expected.scale === "thousand", "TAT-DQA scale drifted");
assert(tat.validators.includes("formula_ast_match"), "TAT-DQA must validate formula AST");
assert(tat.validators.includes("bbox_or_page_match"), "TAT-DQA must validate page or bbox evidence");

const financeBench = manifest.cases.find((c) => c.caseId === "financebench_id_03029")!;
assert(financeBench.expected.answer === "$1577.00", "FinanceBench gold answer drifted");
assert(financeBench.expected.evidencePage === 59, "FinanceBench evidence page drifted");
assert(financeBench.validators.includes("answer_exact_or_normalized_match"), "FinanceBench must validate answer match");

const sec = manifest.cases.find((c) => c.caseId === "sec-aapl-fy2023-xbrl")!;
const facts = sec.expected.facts as Array<{ concept: string; value: number; unit: string }>;
assert(facts.some((f) => f.concept.endsWith("RevenueFromContractWithCustomerExcludingAssessedTax") && f.value === 383285000000), "SEC revenue fact drifted");
assert(facts.some((f) => f.concept.endsWith("NetIncomeLoss") && f.value === 96995000000), "SEC net income fact drifted");
assert(facts.some((f) => f.concept.endsWith("NetCashProvidedByUsedInOperatingActivities") && f.value === 110543000000), "SEC operating cash flow fact drifted");
assert(facts.every((f) => f.unit === "USD"), "SEC facts must be USD");

const noClobber = manifest.cases.find((c) => c.caseId === "noderoom-no-clobber-overlay")!;
assert(noClobber.expected.outcome === "human edit preserved", "no-clobber outcome drifted");
assert(noClobber.validators.includes("no_clobber"), "collaboration overlay must validate no-clobber");

console.log(`public-gold demo manifest PASS (${manifest.cases.length} cases)`);
