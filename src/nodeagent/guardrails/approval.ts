export interface ApprovalSignal {
  pendingApprovals: number;
  destructive?: boolean;
  highRisk?: boolean;
}

export function requiresHumanApproval(signal: ApprovalSignal): boolean {
  return signal.pendingApprovals > 0 || signal.destructive === true || signal.highRisk === true;
}

export function approvalReason(signal: ApprovalSignal): string {
  if (signal.pendingApprovals > 0) return `${signal.pendingApprovals} proposal(s) awaiting review`;
  if (signal.destructive) return "destructive change requested";
  if (signal.highRisk) return "high-risk change requested";
  return "auto-approvable";
}
