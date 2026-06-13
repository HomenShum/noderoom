/**
 * stageFocus - a tiny ephemeral event bus that lets navigational surfaces (the Room Binder, the
 * Signal Tape) point the center Work Surface at a specific cell WITHOUT prop-drilling through the
 * whole shell or persisting anything to the ledger. This is "operation-like" state (TARGET_2026_06
 * L79/L103): selection/viewport is ephemeral, never a durable mutation.
 *
 * Binder click semantics (L46): clicking an agent highlights its claimed range; clicking a Signal
 * Tape / proof item opens the referenced artifact. Both call focusStage(); the ArtifactSurface that
 * is showing that artifact scrolls to + pulses the cell.
 */
export type StageFocusTarget = { artifactId: string; elementId?: string };

const listeners = new Set<(target: StageFocusTarget) => void>();

/** Ask whatever surface is showing `artifactId` to reveal and highlight `elementId`. */
export function focusStage(target: StageFocusTarget): void {
  for (const listener of listeners) listener(target);
}

/** Subscribe a surface to focus requests. Returns an unsubscribe fn. */
export function onStageFocus(cb: (target: StageFocusTarget) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
