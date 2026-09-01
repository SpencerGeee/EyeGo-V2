/**
 * PARSE, DON'T CAST — the named primitives.
 *
 * ── WHAT THIS FILE IS NOW ───────────────────────────────────────────────────
 *
 * A façade. The checking lives in `schemas.ts`, which is zod, and this file is
 * the small vocabulary the call sites already speak: `pesewas(x, 'fare')` reads
 * better inline than a schema parse, and dozens of places say it.
 *
 * It was originally hand-rolled predicates, for a reason that no longer holds:
 * `packages/api` did not depend on zod, and adding a dependency that could not
 * be installed would have broken Metro on a clean checkout — a build failure
 * traded for a type hole. zod is now a declared dependency of this package and
 * resolves from the workspace root, so §3b item 24 is done and these functions
 * delegate rather than duplicate. The assertions they make are unchanged; the
 * error type, the field names and the messages are unchanged. Nothing that
 * imported this file has to move.
 *
 * ── WHY IT STILL EXISTS ─────────────────────────────────────────────────────
 *
 * Because a schema is the right shape for a payload and the wrong shape for a
 * single number. `pesewas(offer.farePesewas, 'offer.farePesewas')` at the point
 * of use is clearer than hoisting a one-field schema, and it keeps the check
 * next to the arithmetic it protects.
 */

import {
  MoneyShapeError,
  Pesewas,
  SignedPesewas,
  Multiplier,
  DistanceKm,
  SeatCount as SeatCountSchema,
  FareQuoteSchema,
  parseOrThrow,
} from './schemas';

export { MoneyShapeError };

/**
 * An integer count of pesewas.
 *
 * Rejects strings — including numeric ones. A server that starts sending
 * `"2500"` is a server whose contract changed, and silently coercing it hides
 * that until something downstream concatenates instead of adding. Rejects
 * fractional values for the same reason the schema stores integers: a third of
 * a pesewa is not money.
 */
export function pesewas(value: unknown, field: string): number {
  return parseOrThrow(Pesewas, value, field);
}

/** Optional pesewas. Absent is fine; present-but-wrong is not. */
export function optionalPesewas(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return pesewas(value, field);
}

/**
 * Pesewas that may legitimately be negative.
 *
 * A driver's wallet goes below zero the moment they owe commission on a cash
 * fare, and every ledger row for a withdrawal or deduction is written as a
 * negative. Using `pesewas` for those would reject the true state of the
 * account, so they get their own guard rather than a looser one everywhere.
 */
export function signedPesewas(value: unknown, field: string): number {
  return parseOrThrow(SignedPesewas, value, field);
}

/**
 * A multiplier such as surge. Finite, positive, and sane.
 *
 * The upper bound is not arithmetic pedantry: a multiplier arriving as 1000
 * through a config mistake would price a ride at a thousand times its fare, and
 * the app would render it without hesitation.
 */
export function multiplier(value: unknown, field: string, max = 10): number {
  // The default ceiling lives in the schema; a caller asking for a different
  // one gets a schema built for it rather than a second code path.
  const schema = max === 10 ? Multiplier : Multiplier.max(max);
  return parseOrThrow(schema, value, field);
}

/** A non-negative distance in kilometres. Fractional is expected here. */
export function distanceKm(value: unknown, field: string): number {
  return parseOrThrow(DistanceKm, value, field);
}

/**
 * How many people are travelling.
 *
 * Guarded because seats MULTIPLY money in every group path: a cover-all host's
 * total is `perSeat × seatCount`, and a count that arrives as `"4"` makes that
 * repeat a string rather than multiply a number.
 */
export function seatCount(value: unknown, field: string): number {
  return parseOrThrow(SeatCountSchema, value, field);
}

/**
 * Validate a fare quote before anything shows it or books against it.
 *
 * Returns the SAME object rather than a copy: this is a check, not a
 * transformation, and returning a rebuilt object would quietly drop any field
 * added to the payload since this was written — and would break the identity
 * memoisation the ride store depends on.
 */
export function assertFareQuote<T extends Record<string, unknown>>(quote: T, label = 'quote'): T {
  if (!quote || typeof quote !== 'object') throw new MoneyShapeError(label, quote);
  parseOrThrow(FareQuoteSchema, quote, label);
  return quote;
}
