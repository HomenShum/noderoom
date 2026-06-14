/**
 * LayerCard — the scrolling text beside the sticky spreadsheet stage.
 * Carries the honest Shipped/Target chip that is the spine of this page's
 * claim discipline.
 */
import type { LayerSpec } from "./storyTape";

export function StatusChip({ status }: { status: LayerSpec["status"] }) {
  return (
    <span className={"rs-status-chip rs-" + status} title={status === "shipped" ? "Production code behind this today" : "June-2026 target architecture, not yet production"}>
      <span className="rs-status-dot" />
      {status === "shipped" ? "Shipped today" : "Target architecture"}
    </span>
  );
}

export function LayerCard({ layer, active }: { layer: LayerSpec; active: boolean }) {
  return (
    <div className={"rs-layer-card" + (active ? " is-active" : "")}>
      <div className="rs-layer-top">
        <span className="rs-layer-kicker">{layer.kicker}</span>
        <StatusChip status={layer.status} />
      </div>
      <h3 className="rs-layer-title">{layer.title}</h3>
      <p className="rs-layer-copy">{layer.copy}</p>
      <div className="rs-layer-diagram" aria-hidden>
        {layer.diagram.map((line, i) => (
          <div key={i} className="rs-diagram-line">{line}</div>
        ))}
      </div>
      <p className="rs-layer-truth">{layer.truth}</p>
    </div>
  );
}
