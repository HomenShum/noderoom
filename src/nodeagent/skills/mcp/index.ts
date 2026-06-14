export interface McpSkillCall {
  server: string;
  tool: string;
  summary: string;
}

export function summarizeMcpSkillCalls(calls: McpSkillCall[]): string[] {
  return calls.map((call) => `${call.server}:${call.tool} — ${call.summary}`);
}
