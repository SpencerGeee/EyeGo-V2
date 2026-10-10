/**
 * Waiting at a hailed pickup, as the apps show it while it is happening.
 *
 * The client copy of `waitFeeFor` in eyego-api/src/modules/trips/fare.calculator.js:
 * whole minutes past the free window, at the tier's waiting rate, capped. The
 * server computes the charge itself when the ride starts — this only drives the
 * live meter, so both sides read the same three published numbers
 * (`waitFreeMinutes`, `tiers[t].waitPerMinPesewas`, `waitFeeCapPesewas`).
 */
export interface WaitingState {
  /** Seconds of free waiting left; 0 once the fee is running. */
  freeSecondsLeft: number;
  minutesBilled: number;
  feePesewas: number;
}

export function waitingState(
  arrivedAt: string | number | Date | null | undefined,
  nowMs: number,
  freeMinutes: number,
  perMinPesewas: number,
  capPesewas: number,
): WaitingState | null {
  if (arrivedAt == null || !(perMinPesewas > 0)) return null;
  const startMs = new Date(arrivedAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const waitedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const freeSec = Math.max(0, freeMinutes) * 60;
  const minutesBilled = Math.max(0, Math.floor(waitedSec / 60) - Math.max(0, freeMinutes));
  const fee = minutesBilled * perMinPesewas;
  return {
    freeSecondsLeft: Math.max(0, freeSec - waitedSec),
    minutesBilled,
    feePesewas: capPesewas > 0 ? Math.min(capPesewas, fee) : fee,
  };
}
