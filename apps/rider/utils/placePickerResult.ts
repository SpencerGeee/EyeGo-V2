import type { GeocodeResult } from './geocoding';

/**
 * One-shot handoff from the map place-picker screen back to whichever screen
 * opened it. The picker writes the confirmed location, navigates back, and
 * the opener consumes it on focus. Consuming clears it so a stale pick never
 * leaks into a later visit.
 */
let pending: GeocodeResult | null = null;

export function setPickedPlace(place: GeocodeResult) {
  pending = place;
}

export function consumePickedPlace(): GeocodeResult | null {
  const result = pending;
  pending = null;
  return result;
}
