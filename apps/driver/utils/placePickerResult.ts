import type { GeocodeResult } from './geocoding';

/**
 * One-shot handoff from the map location-picker screen back to whichever
 * screen opened it (create-trip's pickup/destination fields) — mirrors
 * apps/rider/utils/placePickerResult.ts.
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
