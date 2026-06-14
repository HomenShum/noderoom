/**
 * LayerVisual — the bespoke floating element each layer overlays beside the grid.
 * Kept separate from SpreadsheetScene so the grid stays simple and each layer's
 * teaching flourish (stream card, branch panel, CAS check, rebase trio, lease)
 * lives in one readable switch.
 */
import { Check, GitBranch, Lock, Sparkles, X } from "lucide-react";
import type { LayerVisualKind } from "./storyTape";

export function LayerVisual({ kind }: { kind: LayerVisualKind }) {
  switch (kind) {
    case "optimistic":
      return (
        <div className="rs-float rs-float-tr">
          <div className="rs-pulse-card">
            <span className="rs-dot rs-dot-local" /> local paint · 0&nbsp;ms
            <span className="rs-arrow">→</span>
            <span className="rs-dot rs-dot-ok" /> server commit
          </div>
        </div>
      );

    case "presence":
      return (
        <div className="rs-float rs-float-br">
          <div className="rs-intent-card">
            <span className="rs-intent-title">active edit signal</span>
            <div className="rs-intent-row">avoid · wait · draft · propose</div>
          </div>
        </div>
      );

    case "stream":
      return (
        <div className="rs-float rs-float-r">
          <div className="rs-copilot-card">
            <div className="rs-copilot-head">
              <Sparkles size={13} /> Finance Agent
            </div>
            <div className="rs-stream-line">Reading Q3 source rows…</div>
            <div className="rs-stream-line rs-stream-2">Checking formula dependencies…</div>
            <div className="rs-stream-line rs-stream-3">
              Drafting variance explanation<span className="rs-caret">▍</span>
            </div>
            <div className="rs-ghost-note">↻ refresh-safe — persisted stream</div>
          </div>
        </div>
      );

    case "branch":
      return (
        <div className="rs-float rs-float-r">
          <div className="rs-branch-card">
            <div className="rs-branch-head">
              <GitBranch size={13} /> Agent draft branch
            </div>
            <div className="rs-branch-base">Base: model v43</div>
            <ul className="rs-branch-list">
              <li>D2 variance</li>
              <li>D3 note</li>
              <li>memo risk paragraph</li>
              <li>chart annotation</li>
            </ul>
          </div>
        </div>
      );

    case "cas":
      return (
        <div className="rs-float rs-float-tr">
          <div className="rs-cas-stack">
            <div className="rs-cas-card rs-cas-ok">
              <div className="rs-cas-q">D2 still v7?</div>
              <div className="rs-cas-a">
                <Check size={12} /> YES → commit v8
              </div>
            </div>
            <div className="rs-cas-card rs-cas-no">
              <div className="rs-cas-q">D2 now v8?</div>
              <div className="rs-cas-a">
                <X size={12} /> NO → conflict, no overwrite
              </div>
            </div>
          </div>
        </div>
      );

    case "rebase":
      return (
        <div className="rs-float rs-float-wide">
          <div className="rs-rebase">
            <div className="rs-rebase-cards">
              <div className="rs-rb-card">
                <div className="rs-rb-tag">Base</div>
                <div className="rs-rb-val">12%</div>
              </div>
              <div className="rs-rb-card rs-rb-human">
                <div className="rs-rb-tag">Human now</div>
                <div className="rs-rb-val">13%</div>
                <div className="rs-rb-why">VP wants a conservative base</div>
              </div>
              <div className="rs-rb-card rs-rb-agent">
                <div className="rs-rb-tag">Agent proposed</div>
                <div className="rs-rb-val">14%</div>
                <div className="rs-rb-why">source: management update</div>
              </div>
            </div>
            <div className="rs-rb-resolve">
              <span className="rs-rb-resolve-head">Resolution</span>
              Keep 13% in Base · add 14% to Upside · note the difference ·
              <span className="rs-rb-flag"> needs_review</span>
            </div>
          </div>
        </div>
      );

    case "lease":
      return (
        <div className="rs-float rs-float-tr">
          <div className="rs-lease-card">
            <div className="rs-lease-lock">
              <Lock size={12} /> commit lease
            </div>
            <div className="rs-lease-targets">D2 · E2 · Memo:Risk</div>
            <div className="rs-lease-steps">
              <span className="rs-lease-step">applied</span>
              <span className="rs-lease-step">released</span>
              <span className="rs-lease-step">trace written</span>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
