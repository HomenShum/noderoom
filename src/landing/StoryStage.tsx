/**
 * StoryStage — the scroll-driven core. A sticky spreadsheet "stage" stays fixed
 * in the center while the seven layer cards scroll past on the side. As each
 * layer crosses the viewport's middle, the same spreadsheet scene gains one more
 * layer of behaviour (presence → stream → branch → CAS → rebase → lease).
 *
 * The whole thing is data-driven from LAYERS in storyTape.ts; this file only
 * wires scroll position → active layer and renders the active scene.
 */
import { useEffect, useRef, useState } from "react";
import { LAYERS } from "./storyTape";
import { SpreadsheetScene } from "./SpreadsheetScene";
import { LayerVisual } from "./LayerVisual";
import { LayerCard } from "./LayerCard";

export function StoryStage() {
  const [active, setActive] = useState(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const els = sectionRefs.current.filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        // The section whose middle is closest to the viewport center wins.
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const best = visible.reduce((a, b) => (a.intersectionRatio >= b.intersectionRatio ? a : b));
        const idx = Number((best.target as HTMLElement).dataset.idx);
        if (!Number.isNaN(idx)) setActive(idx);
      },
      // Active when a section sits across the vertical middle band of the viewport.
      { rootMargin: "-42% 0px -42% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const layer = LAYERS[active];

  return (
    <div className="rs-stage">
      {/* Sticky canvas: the live workbook scene for the active layer */}
      <div className="rs-canvas">
        <div className="rs-canvas-inner">
          <div className="rs-mockchrome">
            <span className="rs-mock-mark">N</span>
            <span className="rs-mock-title">Q3 Model.xlsx</span>
            <span className="rs-mock-sync">Synced</span>
            <span className="rs-mock-spacer" />
            <span className="rs-mock-avatars">
              <i style={{ background: "#d97757" }}>H</i>
              <i style={{ background: "#5b9bf5" }}>P</i>
              <i className="rs-mock-agent" style={{ background: "#8C92E0" }}>◆</i>
            </span>
          </div>

          <div className="rs-scene-host">
            <SpreadsheetScene cells={layer.cells} />
            <LayerVisual key={layer.id} kind={layer.id} />
          </div>

          {/* Real shell language: Signal Tape + Status Strip */}
          <div className="rs-tape-row">
            <div className="rs-signal-tape">
              <span className="rs-tape-k">Signal</span>
              <span className="rs-tape-v">{layer.tape}</span>
            </div>
            <div className={"rs-status-strip rs-" + layer.status_strip.kind}>
              <span className="rs-status-dot2" />
              {layer.status_strip.text}
            </div>
          </div>

          {/* Layer progress timeline */}
          <ol className="rs-timeline" aria-label="Story progress">
            {LAYERS.map((l, i) => (
              <li key={l.id} className={"rs-tl-step" + (i === active ? " is-on" : i < active ? " is-done" : "")}>
                <span className="rs-tl-dot">{l.index}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Scrolling layer cards */}
      <div className="rs-rail">
        {LAYERS.map((l, i) => (
          <section
            key={l.id}
            className="rs-layer-section"
            data-idx={i}
            ref={(el) => { sectionRefs.current[i] = el; }}
          >
            <LayerCard layer={l} active={i === active} />
          </section>
        ))}
      </div>
    </div>
  );
}
