/**
 * PARSE, DON'T CAST — for the payloads that carry money.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * There are 356 `as any` casts across the two apps, almost all of them at the
 * API boundary, and the shared `Trip` type was once outright fiction: it
 * required fields that are absent on an unassigned trip and omitted 25 that
 * screens actually read. A cast is a promise the compiler cannot check, and the
 * server is free to break it at any deploy.
 *
 * For most fields the consequence is cosmetic — a name renders as `undefined`.
 * For money it is not. `undefined * 100` is `NaN`, `NaN` formats as "GH₵ NaN",
 * and a fare that arrives as a string rather than a number turns
 * `amount / 100` into something worse than an error: a plausible wrong number.
 * These are the fields where a silent shape change has to become a loud one.
 *
 * ── WHY NOT ZOD ─────────────────────────────────────────────────────────────
 *
 * Zod is the right long-term answer for the whole boundary and it is what §3b
 * item 24 asks for. It is not used here because `packages/api` does not depend
 * on it, and adding a dependency that cannot be installed right now would break
 * Metro on a clean checkout — a build failure traded for a type hole.
 *
 * These guards are deliberately narrow: the money fields, and nothing else.
 * When zod does arrive, this file is what it replaces, and the assertions it
 * makes are the ones the schemas should keep making.
 */

/** Thrown when a payload that decides what someone pays is not what it claims. */
export class MoneyShapeError extends Error {
  field: string;
  received: unknown;

  constructor(field: string, received: unknown) {
    super(
      `The server sent a ${field} this app cannot read (${describe(received)}). ` +
        'Refusing to show a price rather than showing a wrong one.',
    );
    this.name = 'MoneyShapeError';
    this.field = field;
    this.received = received;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'missing';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return `${typeof v}: ${String(v).slice(0, 40)}`;
}

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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyShapeError(field, value);
  }
  if (!Number.isInteger(value)) throw new MoneyShapeError(field, value);
  if (value < 0) throw new MoneyShapeError(field, value);
  return value;
}

/** Optional pesewas. Absent is fine; present-but-wrong is not. */
export function optionalPesewas(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return pesewas(value, field);
}

/**
 * A multiplier such as surge. Finite, positive, and sane.
 *
 * The upper bound is not arithmetic pedantry: a multiplier arriving as 1000
 * through a config mistake would price a ride at a thousand times its fare, and
 * the app would render it without hesitation.
 */
export function multiplier(value: unknown, field: string, max = 10): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyShapeError(field, value);
  }
  if (value <= 0 || value > max) throw new MoneyShapeError(field, value);
  return value;
}

/** A non-negative distance in kilometres. Fractional is expected here. */
export function distanceKm(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MoneyShapeError(field, value);
  }
  return value;
}

/**
 * Validate a fare quote before anything shows it or books against it.
 *
 * Returns the SAME object rather than a copy: this is a check, not a
 * transformation, and returning a rebuilt object would quietly drop any field
 * added to the payload since this was written.
 */
export function assertFareQuote<T extends Record<string, unknown>>(quote: T, label = 'quote'): T {
  if (!quote || typeof quote !== 'object') throw new MoneyShapeError(label, quote);

  pesewas(quote.amountPesewas, `${label}.amountPesewas`);
  distanceKm(quote.distanceKm, `${label}.distanceKm`);
  multiplier(quote.surgeMultiplier, `${label}.surgeMultiplier`);

  // Both are optional in the payload and both are shown to the rider as a
  // saving, so a broken one misrepresents a discount rather than a price.
  optionalPesewas(quote.listPricePesewas, `${label}.listPricePesewas`);
  optionalPesewas(quote.loyaltyDiscountPesewas, `${label}.loyaltyDiscountPesewas`);

  if (typeof quote.quoteId !== 'string' || quote.quoteId.length === 0) {
    // Without this the booking cannot reference the price it was quoted, and
    // the rider is charged whatever the server recalculates later.
    throw new MoneyShapeError(`${label}.quoteId`, quote.quoteId);
  }

  return quote;
}
