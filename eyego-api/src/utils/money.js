'use strict';

/**
 * Money. Integer pesewas, everywhere, with one conversion boundary.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Every monetary value inside this server is an INTEGER NUMBER OF PESEWAS.
 * 1 GH₵ = 100 pesewas, so GH₵25.50 is the integer `2550`. Cedis exist in
 * exactly two places: a human's screen, and a human's keyboard. Between those
 * two points nothing is ever a fraction.
 *
 * Every money column in the schema is `Int` and named `…Pesewas`. If you find
 * yourself writing `* 100` or `/ 100` outside this file, you are opening the
 * hole this file exists to close — call `fromCedis` / `toCedis` instead.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * IEEE 754 binary floating point cannot represent 0.1, or 0.01, or any decimal
 * fraction whose denominator has a factor other than 2. `0.1 + 0.2` is
 * `0.30000000000000004`. That is not a rounding style, it is the actual stored
 * value, and it means:
 *
 *   - A fare split across seats and re-summed for a receipt does not equal the
 *     same fare summed for the driver's earnings. The two disagree by a pesewa
 *     and no amount of staring at the code explains why.
 *   - A wallet balance built by adding and subtracting floats drifts. After a
 *     few hundred transactions the ledger and the balance no longer agree, and
 *     the only honest thing you can tell a driver is "we don't know".
 *   - `commission = fare * 0.15` produces things like `5.249999999999999`,
 *     which rounds differently depending on which line rounds it.
 *
 * Integers have no representation error at all. `2550` is 2550. Paystack —
 * like every other processor — already speaks minor units on the wire, so this
 * is also the unit that goes out over the network unconverted.
 *
 * ── THE ONE THING TO GET RIGHT: SPLITTING ───────────────────────────────────
 * Integers cannot be divided evenly. GH₵10.00 across 3 seats is 333.33…
 * pesewas each. Rounding each seat independently loses or invents money. Use
 * `split()`, which distributes the remainder deterministically so the parts
 * always sum back to exactly the total. This is the single most common way an
 * integer-money system still ends up unbalanced.
 */

const PESEWAS_PER_CEDI = 100;

/** Nothing legitimate in this product costs more than GH₵1,000,000. */
const SANITY_CEILING_PESEWAS = 1_000_000 * PESEWAS_PER_CEDI;

/**
 * Cedis → pesewas. The ONLY entry point for money arriving as a decimal:
 * a config value, an admin form, a legacy row, a hand-typed amount.
 *
 * `n * 100` can itself land on 2549.9999999999995 because the float going in
 * was never exactly 25.50, so nudge by EPSILON before rounding.
 */
function fromCedis(cedis) {
  if (cedis === null || cedis === undefined) return 0;
  const n = Number(cedis);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * PESEWAS_PER_CEDI);
}

/**
 * Pesewas → cedis, as a Number. FOR DISPLAY AND FOR GATEWAYS THAT DEMAND
 * DECIMALS ONLY. Never feed the result back into arithmetic — that is exactly
 * the round trip that reintroduces drift.
 */
function toCedis(pesewas) {
  return Math.round(Number(pesewas) || 0) / PESEWAS_PER_CEDI;
}

/** Pesewas → "GH₵25.50". The string a human reads. */
function formatGhs(pesewas) {
  const n = Math.round(Number(pesewas) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}GH₵${Math.floor(abs / PESEWAS_PER_CEDI)}.${String(abs % PESEWAS_PER_CEDI).padStart(2, '0')}`;
}

/**
 * Guard every value that is ABOUT to be stored or charged.
 *
 * Throws rather than coercing. A NaN fare that quietly becomes 0 is a free
 * ride; a negative one is a refund nobody authorised; a non-integer means
 * something upstream is still thinking in cedis and this is the last place
 * that can say so.
 *
 * @param {number}  value
 * @param {string}  label            what to name in the error
 * @param {object}  [opts]
 * @param {boolean} [opts.allowNegative]  ledger deltas and refunds are signed
 */
function assertPesewas(value, label = 'amount', { allowNegative = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} is not a finite number`);
  if (!Number.isInteger(n)) {
    throw new Error(
      `${label} must be an integer number of pesewas, got ${n} — ` +
        'a fractional value here means cedis leaked past the conversion boundary',
    );
  }
  if (!allowNegative && n < 0) throw new Error(`${label} may not be negative`);
  if (Math.abs(n) > SANITY_CEILING_PESEWAS) throw new Error(`${label} exceeds the sanity ceiling`);
  return n;
}

/**
 * Split `total` pesewas into `parts` shares that sum to EXACTLY `total`.
 *
 * Largest-remainder: everyone gets the floor, then the leftover pesewas go one
 * each to the earliest shares. GH₵10.00 over 3 → [334, 333, 333], which sums
 * to 1000. Rounding each share independently would give [333,333,333] = 999
 * and lose a pesewa on every single trip, or [334,334,334] = 1002 and invent
 * money — and the loss compounds silently across millions of rides.
 *
 * @returns {number[]} length `parts`, descending by at most 1
 */
function split(total, parts) {
  const t = assertPesewas(total, 'split total', { allowNegative: true });
  const n = Math.trunc(parts);
  if (!Number.isInteger(n) || n < 1) throw new Error(`split parts must be >= 1, got ${parts}`);

  const sign = t < 0 ? -1 : 1;
  const abs = Math.abs(t);
  const base = Math.floor(abs / n);
  const remainder = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Take `percent` (as a fraction, e.g. 0.15) of an amount, rounded to the
 * pesewa. Used for commission, discounts, cancellation fees.
 *
 * Half-away-from-zero rather than JS's `Math.round` (which is half-UP, so it
 * treats -2.5 as -2 and biases every refund in the platform's favour).
 */
function percentOf(pesewas, fraction) {
  const base = assertPesewas(pesewas, 'percent base', { allowNegative: true });
  const f = Number(fraction);
  if (!Number.isFinite(f)) throw new Error('percent fraction is not a finite number');
  const raw = base * f;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Sum, asserting each term. Guards against one `undefined` silently NaN-ing a total. */
function sum(...amounts) {
  return amounts
    .flat()
    .reduce((acc, a) => acc + assertPesewas(a, 'sum term', { allowNegative: true }), 0);
}

/**
 * Coerce a possibly-fractional aggregate to a whole pesewa.
 *
 * For database aggregates only. `AVG(fareAmountPesewas)` legitimately returns
 * 2549.6666…, and `SUM` over an empty set returns null; neither is an amount of
 * money until it is rounded. Do NOT use this to launder a value that should
 * already have been an integer — that is what `assertPesewas` is for.
 */
function wholePesewas(aggregate) {
  return Math.round(Number(aggregate) || 0);
}

/** Never let a computed fare fall below a floor (e.g. MIN_FARE). */
function atLeast(pesewas, floorPesewas) {
  return Math.max(assertPesewas(pesewas, 'amount'), assertPesewas(floorPesewas, 'floor'));
}

/**
 * Read a cedis-denominated env var as pesewas.
 *
 * Config files are written by humans, so they stay in cedis (`ECO_BASE_FARE=5.00`)
 * and are converted exactly once, here, at load.
 */
function cedisEnv(key, fallbackCedis) {
  const raw = process.env[key];
  const n = Number.parseFloat(raw);
  return fromCedis(Number.isFinite(n) ? n : fallbackCedis);
}

module.exports = {
  PESEWAS_PER_CEDI,
  fromCedis,
  toCedis,
  formatGhs,
  assertPesewas,
  split,
  percentOf,
  sum,
  wholePesewas,
  atLeast,
  cedisEnv,
};
