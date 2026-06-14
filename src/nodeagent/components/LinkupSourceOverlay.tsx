import type { SourceEvidence } from "../skills/search/linkupTools";

export interface LinkupSourceOverlayProps {
  sources: SourceEvidence[];
}

export function LinkupSourceOverlay({ sources }: LinkupSourceOverlayProps) {
  return (
    <section style={{ border: "1px solid rgba(148,163,184,.28)", borderRadius: 12, padding: 12 }}>
      <strong>Sources</strong>
      <ul style={{ marginBottom: 0 }}>
        {sources.map((source) => <li key={source.url}><a href={source.url}>{source.label}</a> — {source.snippet}</li>)}
      </ul>
    </section>
  );
}

