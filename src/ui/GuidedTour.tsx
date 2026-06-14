/**
 * GuidedTour — a dependency-free spotlight walkthrough.
 *
 * A first-run/"Take the tour" overlay that highlights real UI regions one step at a time. It does NOT
 * trap interaction: the dimmer is visual-only (pointer-events:none), so a user can actually try a step
 * (type /ask, edit a cell) while the card stays on screen. Each step may carry a `before` side-effect
 * (reveal a panel, switch artifact) so the target exists before we measure it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

export type TourStep = {
  /** CSS selector of the element to spotlight. Omit for a centered (welcome/finish) step. */
  selector?: string;
  title: string;
  body: string;
  /** Preferred card side relative to the target; auto-picks if omitted. */
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /** Run before measuring — reveal a panel, switch artifact, etc. */
  before?: () => void;
};

const CARD_W = 320;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function placeCard(rect: DOMRect | null, placement: TourStep["placement"]): { top: number; left: number; centered: boolean } {
  const vw = window.innerWidth, vh = window.innerHeight, m = 14, ch = 190;
  if (!rect || placement === "center") {
    return { top: Math.max(m, vh / 2 - ch / 2), left: Math.max(m, vw / 2 - CARD_W / 2), centered: true };
  }
  const side = placement ?? (rect.left > CARD_W + 2 * m ? "left" : rect.right + CARD_W + 2 * m < vw ? "right" : rect.bottom + ch + 2 * m < vh ? "bottom" : "top");
  let top = rect.top, left = rect.left;
  if (side === "right") { left = rect.right + m; top = rect.top; }
  else if (side === "left") { left = rect.left - CARD_W - m; top = rect.top; }
  else if (side === "bottom") { top = rect.bottom + m; left = rect.left + rect.width / 2 - CARD_W / 2; }
  else { top = rect.top - ch - m; left = rect.left + rect.width / 2 - CARD_W / 2; }
  top = Math.min(Math.max(m, top), vh - ch - m);
  left = Math.min(Math.max(m, left), vw - CARD_W - m);
  return { top, left, centered: false };
}

export function GuidedTour({ steps, open, onClose, storageKey }: { steps: TourStep[]; open: boolean; onClose: () => void; storageKey?: string }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const reduced = prefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const lastRectRef = useRef<DOMRect | null>(null);

  const isLast = i >= steps.length - 1;
  // Persist on ANY close (Done, Skip, Esc) so a returning visitor is never nagged; the "?" button replays.
  const finish = () => {
    if (storageKey) { try { localStorage.setItem(storageKey, "done"); } catch { /* ignore */ } }
    onClose();
  };
  const next = () => { if (isLast) finish(); else setI((n) => Math.min(n + 1, steps.length - 1)); };
  const prev = () => setI((n) => Math.max(0, n - 1));

  useEffect(() => { if (open) setI(0); }, [open]);
  // Move focus into the card on open (accessible dialog), without trapping — the user can still
  // interact with the spotlighted element mid-step.
  useEffect(() => { if (!open) return; const r = requestAnimationFrame(() => cardRef.current?.focus()); return () => cancelAnimationFrame(r); }, [open]);

  // Measure the target (after the step's reveal side-effect + a couple frames for layout).
  useLayoutEffect(() => {
    if (!open) return;
    const step = steps[i];
    step?.before?.();
    lastRectRef.current = null; // force the first measure of this step to apply
    const measure = () => {
      const el = step?.selector ? (document.querySelector(step.selector) as HTMLElement | null) : null;
      const r = el?.getBoundingClientRect();
      // A missing or display:none target (e.g. a panel hidden on mobile) reports null / zero area —
      // fall back to a centered card. NB: never scrollIntoView here; the capturing scroll listener calls
      // measure(), so scrolling would re-enter measure→scroll in a tight loop.
      const next = el && r && (r.width > 0 || r.height > 0) ? r : null;
      const prev = lastRectRef.current;
      const same = (!next && !prev) || (!!next && !!prev && Math.abs(next.left - prev.left) < 1 && Math.abs(next.top - prev.top) < 1 && Math.abs(next.width - prev.width) < 1 && Math.abs(next.height - prev.height) < 1);
      if (!same) { lastRectRef.current = next; setRect(next); }
    };
    // Poll (not requestAnimationFrame — rAF is throttled/skipped in background tabs) so the spotlight
    // self-heals against panel mount/animation, late layout, and reveals. The change-guard above means
    // no wasted re-renders once the target settles.
    measure();
    const poll = setInterval(measure, 200);
    const onWin = () => measure();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => { clearInterval(poll); window.removeEventListener("resize", onWin); window.removeEventListener("scroll", onWin, true); };
    // Intentionally keyed on [open, i] only: `steps` is rebuilt each parent render, so depending on it
    // would re-run this layout effect every render → an infinite pre-paint loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  // Keyboard: Esc skips, →/Enter next, ← back.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack Enter/Arrows while the user is typing in a field (composer, join code, cell
      // edit) — only Escape stays global. Otherwise the tour eats every keystroke.
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (typing) return;
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, isLast]);

  if (!open || steps.length === 0) return null;
  // B2: i can exceed a freshly-shrunk steps array (e.g. mobile-gated steps) before the open-effect
  // resets it — clamp so the render never dereferences an undefined step (was a TypeError crash).
  const safeI = Math.min(i, steps.length - 1);
  const step = steps[safeI];
  const pad = 6;
  const { top, left, centered } = placeCard(rect, step.placement);

  return (
    <div className="r-tour" data-testid="guided-tour" data-reduced={String(reduced)} aria-live="polite">
      {rect && !centered ? (
        <div
          className="r-tour-spot"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      ) : (
        <div className="r-tour-dim" />
      )}
      <div ref={cardRef} tabIndex={-1} className="r-tour-card" role="dialog" aria-modal="false" aria-label={`Tour step ${safeI + 1} of ${steps.length}: ${step.title}`} style={{ top, left, width: CARD_W }}>
        <button className="r-iconbtn r-tour-x" aria-label="End tour" onClick={() => finish()}><X size={14} /></button>
        <div className="r-tour-step">{safeI + 1} / {steps.length}</div>
        <h3 className="r-tour-title">{step.title}</h3>
        <p className="r-tour-body">{step.body}</p>
        <div className="r-tour-dots" aria-hidden="true">
          {steps.map((_, n) => <span key={n} className={"r-tour-dot" + (n === i ? " on" : "")} />)}
        </div>
        <div className="r-tour-actions">
          <button className="r-btn ghost" onClick={() => finish()} data-testid="tour-skip">Skip</button>
          <span className="grow" />
          {i > 0 && <button className="r-btn ghost" onClick={prev} data-testid="tour-back"><ArrowLeft size={14} /> Back</button>}
          <button className="r-btn primary" onClick={next} data-testid="tour-next">
            {isLast ? "Done" : <>Next <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
