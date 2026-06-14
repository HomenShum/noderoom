export interface EvaluationSignal {
  evidenceCount: number;
  proposalCount: number;
  conflictCount: number;
}

export interface EvaluationScore {
  score: number;
  verdict: "pass" | "warn";
}

export function evaluateNodeAgentRun(signal: EvaluationSignal): EvaluationScore {
  const score = Math.max(0, Math.min(100, signal.evidenceCount * 20 - signal.proposalCount * 5 - signal.conflictCount * 10 + 40));
  return { score, verdict: score >= 60 ? "pass" : "warn" };
}
