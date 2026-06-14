export type NodeAgentStreamStatus = "pending" | "streaming" | "done" | "error";

export interface NodeAgentStreamChunk {
  text: string;
  ts: number;
}

export function buildPrivateReplyStreamUrl(convexSiteUrl: string): string {
  return new URL("/stream-private-reply", convexSiteUrl).toString();
}

// BOUND: cap total accumulated stream text (OOM guard for a runaway reply). Cap by total
// characters and preserve the head — dropping the head would corrupt finalizeStreamText output.
const MAX_STREAM_CHARS = 200_000;

export function appendStreamChunk(chunks: NodeAgentStreamChunk[], text: string, ts = Date.now()): NodeAgentStreamChunk[] {
  if (!text) return chunks;
  const used = chunks.reduce((n, chunk) => n + chunk.text.length, 0);
  if (used >= MAX_STREAM_CHARS) return chunks;
  const remaining = MAX_STREAM_CHARS - used;
  const clipped = text.length > remaining ? text.slice(0, remaining) : text;
  return [...chunks, { text: clipped, ts }];
}

export function finalizeStreamText(chunks: NodeAgentStreamChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

export function isTerminalStreamStatus(status: NodeAgentStreamStatus): boolean {
  return status === "done" || status === "error";
}
