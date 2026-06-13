import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { SpreadsheetBenchStageReport } from "./spreadsheetBenchStage";

export type SpreadsheetBenchStageProofOptions = {
  reportPath: string;
  stageRoot?: string;
  track?: SpreadsheetBenchTrack;
  minTasks?: number;
};

export type SpreadsheetBenchStageProof = {
  ok: boolean;
  reportPath: string;
  stageRoot?: string;
  track?: SpreadsheetBenchTrack;
  stagedTaskCount: number;
  scannedTaskCount: number;
  agentFileCount: number;
  evaluatorGoldFileCount: number;
  checkedTaskDirectories: number;
  failures: string[];
};

export function verifySpreadsheetBenchStageProof(options: SpreadsheetBenchStageProofOptions): SpreadsheetBenchStageProof {
  const reportPath = resolve(options.reportPath);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Partial<SpreadsheetBenchStageReport>;
  const failures: string[] = [];
  const minTasks = options.minTasks ?? 1;

  if (report.schema !== 1) failures.push("report schema must be 1");
  if (options.track && report.track !== options.track) failures.push(`report track must be ${options.track}`);
  if ((report.stagedTaskCount ?? 0) < minTasks) failures.push(`stagedTaskCount must be at least ${minTasks}`);
  if ((report.scannedTaskCount ?? 0) < minTasks) failures.push(`scannedTaskCount must be at least ${minTasks}`);
  if ((report.agentFileCount ?? 0) < minTasks) failures.push(`agentFileCount must be at least ${minTasks}`);
  if ((report.evaluatorGoldFileCount ?? 0) < minTasks) failures.push(`evaluatorGoldFileCount must be at least ${minTasks}`);

  if ((report.isolation?.agentDirectoryGoldFileCount ?? 0) !== 0) failures.push("agent directory must not contain gold files");
  if ((report.isolation?.agentManifestGoldPathLeaks ?? 0) !== 0) failures.push("agent manifests must not leak gold paths");
  if ((report.isolation?.agentManifestScorerMetadataLeaks ?? 0) !== 0) failures.push("agent manifests must not leak scorer metadata");
  if (report.isolation?.agentEvaluatorPathOverlap !== false) failures.push("agent and evaluator paths must not overlap");

  let checkedTaskDirectories = 0;
  const stageRoot = options.stageRoot ? resolve(options.stageRoot) : undefined;
  if (stageRoot) {
    if (!existsSync(stageRoot)) {
      failures.push(`stageRoot does not exist: ${stageRoot}`);
    } else {
      const tasksRoot = join(stageRoot, "tasks");
      const taskDirs = existsSync(tasksRoot)
        ? readdirSync(tasksRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        : [];
      checkedTaskDirectories = taskDirs.length;
      if (taskDirs.length !== report.stagedTaskCount) {
        failures.push(`stageRoot task directory count ${taskDirs.length} must equal stagedTaskCount ${report.stagedTaskCount ?? "missing"}`);
      }
      for (const task of report.tasks ?? []) {
        const agentManifest = join(stageRoot, task.agentManifest);
        const evaluatorManifest = join(stageRoot, task.evaluatorManifest);
        if (!existsSync(agentManifest)) failures.push(`missing agent manifest: ${task.agentManifest}`);
        if (!existsSync(evaluatorManifest)) failures.push(`missing evaluator manifest: ${task.evaluatorManifest}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    reportPath,
    stageRoot,
    track: report.track,
    stagedTaskCount: report.stagedTaskCount ?? 0,
    scannedTaskCount: report.scannedTaskCount ?? 0,
    agentFileCount: report.agentFileCount ?? 0,
    evaluatorGoldFileCount: report.evaluatorGoldFileCount ?? 0,
    checkedTaskDirectories,
    failures,
  };
}
