import type { FareQuote } from '@eyego/api';

/**
 * THE PRICE THE RIDER WAS SHOWN IS THE PRICE THEY REQUEST.
 *
 * Configure quotes every tier; Request used to quote AGAIN, off a GPS fix that
 * had jittered a few metres since, and the second quote priced a few pesewas
 * apart (run 45902035048 #3: shown GH₵52.44, requested and collected GH₵52.41).
 * Request now redeems the quote it showed whenever nothing that prices the ride
 * has changed and the quote still has time left.
 */
export interface QuoteInputs {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  tier: string;
  doorstepPickup?: boolean;
  heavyLoad: boolean;
  seatCount: number;
}

const held = new Map<string, { quote: FareQuote; inputs: QuoteInputs; expiresAtMs: number }>();

/** A pickup closer than this is "the same pickup" — GPS jitter, not a move. */
const SAME_PICKUP_M = 50;
/** Leave the request this long to reach the server before the quote lapses. */
const MIN_LEFT_MS = 20_000;

function metresApart(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const k = 111_320;
  const dx = (bLng - aLng) * k * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const dy = (bLat - aLat) * k;
  return Math.hypot(dx, dy);
}

export function rememberQuote(inputs: QuoteInputs, quote: FareQuote): void {
  held.set(inputs.tier, { quote, inputs, expiresAtMs: Date.now() + (quote.expiresInSeconds ?? 0) * 1000 });
}

/** The shown quote for these inputs, if it still applies. Single use: a quote redeems once. */
export function takeQuote(inputs: QuoteInputs): FareQuote | null {
  const h = held.get(inputs.tier);
  if (!h) return null;
  held.delete(inputs.tier);
  const a = h.inputs;
  const same =
    a.dropoffLat === inputs.dropoffLat &&
    a.dropoffLng === inputs.dropoffLng &&
    a.doorstepPickup === inputs.doorstepPickup &&
    a.heavyLoad === inputs.heavyLoad &&
    a.seatCount === inputs.seatCount &&
    metresApart(a.pickupLat, a.pickupLng, inputs.pickupLat, inputs.pickupLng) < SAME_PICKUP_M;
  return same && h.expiresAtMs - Date.now() > MIN_LEFT_MS ? h.quote : null;
}
