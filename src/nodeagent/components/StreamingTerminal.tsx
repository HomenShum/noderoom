import type { CSSProperties } from "react";

export interface StreamingTerminalState {
  streamId: string;
  status: "idle" | "streaming" | "complete" | "error";
  text: string;
  title?: string;
  style?: CSSProperties;
}

export function StreamingTerminal({ title = "Streaming output", streamId, status, text, style }: StreamingTerminalState) {
  return (
    <section style={{ border: "1px solid rgba(148,163,184,.28)", borderRadius: 12, padding: 12, background: "rgba(15,23,42,.04)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <strong>{title}</strong>
        <span>{streamId} · {status}</span>
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12 }}>{text}</pre>
    </section>
  );
}

