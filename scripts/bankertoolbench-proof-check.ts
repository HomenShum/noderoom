import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

type BankerToolBenchStageReport = {
  schema: number;
  scannedTaskCount: number;
  stagedTaskCount: number;
  skippedTaskCount: number;
  agentFileCount: number;
  evaluatorGoldenFileCount: number;
  rubricCriterionCount: number;
  weightedRubricTotal: number;
  isolation?: {
    agentDirectoryGoldenFileCount?: number;
    agentManifestGoldenPathLeaks?: number;
    agentManifestRubricLeaks?: number;
    agentManifestCanaryLeaks?: number;
    agentEvaluatorPathOverlap?: boolean;
  };
  warnings?: string[];
};

type BankerToolBenchRunReport = {
  schema: number;
  mode: string;
  taskCount: number;
  passCount: number;
  passRate: number;
  averageWeightedScore: number;
  harness?: {
    toolPolicy?: string;
    evaluatorAccess?: string;
    verifier?: string;
    packagePolicy?: string;
    supportedDeliverableExtensions?: string[];
  };
  warnings?: string[];
  results?: Array<{
    taskId?: string;
    harborTaskId?: string;
    candidateManifest?: string;
    score?: {
      verifier?: string;
      totals?: {
        rubricCriteria?: number;
        weightedTotal?: number;
        awardedWeight?: number;
        acceptedGoldenFiles?: number;
        expectedDeliverables?: number;
        candidateDeliverables?: number;
        matchedExpectedDeliverables?: number;
        missingExpectedDeliverables?: number;
        extraCandidateDeliverables?: number;
        duplicateCandidateDeliverables?: number;
        unsupportedCandidateDeliverables?: number;
      };
      weightedScore?: number;
      pass?: boolean;
      rubricResults?: Array<{
        weight?: number;
        passed?: boolean;
      }>;
      warnings?: string[];
    };
    trajectory?: Array<{
      step?: string;
      detail?: string;
    }>;
    error?: {
      message?: string;
    };
  }>;
};

type ContaminationReport = {
  schema: number;
  checkedFiles: number;
  leakCount: number;
};

const args = process.argv.slice(2);
const stagePath = optionValue("--stage") ?? "docs/eval/bankertoolbench-stage-smoke.json";
const runPath = optionValue("--run") ?? "docs/eval/bankertoolbench-run-smoke.json";
const stageContaminationPath = optionValue("--stage-contamination") ?? "docs/eval/bankertoolbench-stage-contamination-smoke.json";
const runContaminationPath = optionValue("--run-contamination") ?? "docs/eval/bankertoolbench-run-contamination-smoke.json";
const minStageCheckedFiles = numberOption("--min-stage-checked-files") ?? 1;
const minRunCheckedFiles = numberOption("--min-run-checked-files") ?? 3;

const stage = readJson<BankerToolBenchStageReport>(stagePath);
const run = readJson<BankerToolBenchRunReport>(runPath);
const stageContamination = readJson<ContaminationReport>(stageContaminationPath);
const runContamination = readJson<ContaminationReport>(runContaminationPath);
const failures: string[] = [];

expect(stage.schema === 1, `stage schema must be 1, got ${stage.schema}`);
expect(stage.scannedTaskCount === 1, `stage scannedTaskCount must be 1, got ${stage.scannedTaskCount}`);
expect(stage.stagedTaskCount === 1, `stage stagedTaskCount must be 1, got ${stage.stagedTaskCount}`);
expect(stage.skippedTaskCount === 0, `stage skippedTaskCount must be 0, got ${stage.skippedTaskCount}`);
expect(stage.agentFileCount >= 2, `stage agentFileCount ${stage.agentFileCount} < 2`);
expect(stage.evaluatorGoldenFileCount === 1, `stage evaluatorGoldenFileCount must be 1, got ${stage.evaluatorGoldenFileCount}`);
expect(stage.rubricCriterionCount === 2, `stage rubricCriterionCount must be 2, got ${stage.rubricCriterionCount}`);
expect(stage.weightedRubricTotal === 6, `stage weightedRubricTotal must be 6, got ${stage.weightedRubricTotal}`);
expect((stage.warnings ?? []).length === 0, `stage warnings must be empty, got ${JSON.stringify(stage.warnings)}`);
expect(stage.isolation?.agentDirectoryGoldenFileCount === 0, `stage agentDirectoryGoldenFileCount must be 0, got ${stage.isolation?.agentDirectoryGoldenFileCount}`);
expect(stage.isolation?.agentManifestGoldenPathLeaks === 0, `stage agentManifestGoldenPathLeaks must be 0, got ${stage.isolation?.agentManifestGoldenPathLeaks}`);
expect(stage.isolation?.agentManifestRubricLeaks === 0, `stage agentManifestRubricLeaks must be 0, got ${stage.isolation?.agentManifestRubricLeaks}`);
expect(stage.isolation?.agentManifestCanaryLeaks === 0, `stage agentManifestCanaryLeaks must be 0, got ${stage.isolation?.agentManifestCanaryLeaks}`);
expect(stage.isolation?.agentEvaluatorPathOverlap === false, `stage agentEvaluatorPathOverlap must be false, got ${stage.isolation?.agentEvaluatorPathOverlap}`);

expect(run.schema === 1, `run schema must be 1, got ${run.schema}`);
expect(run.mode === "copy-input-baseline", `run mode must be copy-input-baseline, got ${run.mode}`);
expect(run.taskCount === 1, `run taskCount must be 1, got ${run.taskCount}`);
expect(run.passCount === 0, `run passCount must be 0 for copy-input baseline, got ${run.passCount}`);
expect(run.passRate === 0, `run passRate must be 0 for copy-input baseline, got ${run.passRate}`);
expect(run.averageWeightedScore === 0, `run averageWeightedScore must be 0 for copy-input baseline, got ${run.averageWeightedScore}`);
expect(run.harness?.toolPolicy === "agent_workspace_until_candidate", `run harness toolPolicy mismatch: ${run.harness?.toolPolicy}`);
expect(run.harness?.evaluatorAccess === "after_candidate_emit_only", `run harness evaluatorAccess mismatch: ${run.harness?.evaluatorAccess}`);
expect(run.harness?.verifier === "local_exact_or_workbook_semantic_smoke", `run harness verifier mismatch: ${run.harness?.verifier}`);
expect(run.harness?.packagePolicy === "exact_expected_deliverables", `run harness packagePolicy mismatch: ${run.harness?.packagePolicy}`);
for (const extension of [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf", ".csv", ".png", ".jpg", ".jpeg"]) {
  expect((run.harness?.supportedDeliverableExtensions ?? []).includes(extension), `supportedDeliverableExtensions missing ${extension}`);
}
expect((run.warnings ?? []).length === 0, `run warnings must be empty at report level, got ${JSON.stringify(run.warnings)}`);
expect(Array.isArray(run.results), "run results must be present");
expect((run.results?.length ?? 0) === 1, `run results length ${run.results?.length ?? "missing"} must be 1`);

const result = run.results?.[0];
if (result) {
  const label = result.taskId ?? "result#1";
  expect(!result.error, `${label} has error ${result.error?.message ?? "unknown"}`);
  expect(Boolean(result.harborTaskId), `${label} must record harborTaskId`);
  expect(Boolean(result.candidateManifest), `${label} must record candidateManifest`);
  expect(JSON.stringify(result.trajectory?.map((step) => step.step)) === JSON.stringify([
    "read_agent_manifest",
    "prepare_agent_workspace",
    "emit_candidate_deliverables",
    "read_evaluator_manifest",
    "score_candidate",
  ]), `${label} trajectory must emit candidate before evaluator read, got ${JSON.stringify(result.trajectory?.map((step) => step.step))}`);
  expect(result.score?.verifier === "local_exact_or_workbook_semantic_smoke", `${label} score verifier mismatch: ${result.score?.verifier}`);
  expect(result.score?.pass === false, `${label} copy-input baseline score.pass must be false`);
  expect(result.score?.weightedScore === 0, `${label} weightedScore must be 0, got ${result.score?.weightedScore}`);
  expect(result.score?.totals?.rubricCriteria === 2, `${label} rubricCriteria must be 2, got ${result.score?.totals?.rubricCriteria}`);
  expect(result.score?.totals?.weightedTotal === 6, `${label} weightedTotal must be 6, got ${result.score?.totals?.weightedTotal}`);
  expect(result.score?.totals?.awardedWeight === 0, `${label} awardedWeight must be 0, got ${result.score?.totals?.awardedWeight}`);
  expect(result.score?.totals?.acceptedGoldenFiles === 0, `${label} acceptedGoldenFiles must be 0, got ${result.score?.totals?.acceptedGoldenFiles}`);
  expect(result.score?.totals?.expectedDeliverables === 1, `${label} expectedDeliverables must be 1, got ${result.score?.totals?.expectedDeliverables}`);
  expect(result.score?.totals?.candidateDeliverables === 2, `${label} candidateDeliverables must be 2, got ${result.score?.totals?.candidateDeliverables}`);
  expect(result.score?.totals?.matchedExpectedDeliverables === 0, `${label} matchedExpectedDeliverables must be 0, got ${result.score?.totals?.matchedExpectedDeliverables}`);
  expect(result.score?.totals?.missingExpectedDeliverables === 1, `${label} missingExpectedDeliverables must be 1, got ${result.score?.totals?.missingExpectedDeliverables}`);
  expect(result.score?.totals?.extraCandidateDeliverables === 2, `${label} extraCandidateDeliverables must be 2, got ${result.score?.totals?.extraCandidateDeliverables}`);
  expect(result.score?.totals?.duplicateCandidateDeliverables === 0, `${label} duplicateCandidateDeliverables must be 0, got ${result.score?.totals?.duplicateCandidateDeliverables}`);
  expect(result.score?.totals?.unsupportedCandidateDeliverables === 0, `${label} unsupportedCandidateDeliverables must be 0, got ${result.score?.totals?.unsupportedCandidateDeliverables}`);
  const rubricWeight = (result.score?.rubricResults ?? []).reduce((sum, item) => sum + (item.weight ?? 0), 0);
  expect(rubricWeight === 6, `${label} rubricResults weight sum must be 6, got ${rubricWeight}`);
  expect((result.score?.rubricResults ?? []).every((item) => item.passed === false), `${label} copy-input baseline rubric results must all fail`);
  expect((result.score?.warnings ?? []).some((warning) => warning.includes("not the official Harbor/Gandalf verifier")), `${label} must preserve non-official verifier warning`);
}

checkContamination(stageContamination, stageContaminationPath, minStageCheckedFiles);
checkContamination(runContamination, runContaminationPath, minRunCheckedFiles);

if (failures.length > 0) {
  console.error(`BankerToolBench proof check failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log([
  "BankerToolBench proof check passed:",
  `stage=${stage.stagedTaskCount}/${stage.scannedTaskCount}`,
  `weightedRubric=${stage.weightedRubricTotal}`,
  `run=${run.passCount}/${run.taskCount} pass`,
  `candidateBeforeEvaluator=${result?.trajectory?.[2]?.step === "emit_candidate_deliverables"}`,
  `leaks=${stageContamination.leakCount}/${stageContamination.checkedFiles}+${runContamination.leakCount}/${runContamination.checkedFiles}`,
].join(" "));

function checkContamination(report: ContaminationReport, path: string, minCheckedFiles: number): void {
  expect(report.schema === 1, `${rel(path)} schema must be 1, got ${report.schema}`);
  expect(report.leakCount === 0, `${rel(path)} leakCount must be 0, got ${report.leakCount}`);
  expect(report.checkedFiles >= minCheckedFiles, `${rel(path)} checkedFiles ${report.checkedFiles} < ${minCheckedFiles}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}
