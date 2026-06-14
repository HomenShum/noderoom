export interface CircuitBreakerState {
  failures: number;
  threshold: number;
  open: boolean;
  lastFailureAt?: number;
}

export function nextCircuitBreakerState(state: CircuitBreakerState, ok: boolean, now = Date.now()): CircuitBreakerState {
  if (ok) return { ...state, failures: 0, open: false };
  const failures = state.failures + 1;
  return { ...state, failures, open: failures >= state.threshold, lastFailureAt: now };
}

// A breaker that only closes on an explicit success — while canProceed blocks the very call that
// would produce that success — dead-latches open forever. Allow a half-open probe after a cooldown.
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export function canProceed(state: CircuitBreakerState, now = Date.now()): boolean {
  if (!state.open) return true;
  return now - (state.lastFailureAt ?? 0) >= CIRCUIT_BREAKER_COOLDOWN_MS;
}
