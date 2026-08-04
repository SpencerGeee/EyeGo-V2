'use strict';

/**
 * Money. One choke point, the way `applyTransition` is the one choke point for
 * trip status.
 *
 * Every monetary value written to the database must pass through `toCedis`.
 * IEEE 754 cannot represent 0.1, so `0.1 + 0.2 === 0.30000000000000004`; left
 * unrounded, a fare split across seats and re-aggregated for a receipt drifts
 * from the same fare aggregated for the driver's earnings, and the two
 * disagree by a pesewa in a way nobody can explain to a rider.
 *
 * ── ON MINOR UNITS (pesewas) ────────────────────────────────────────────────
 * The correct end state for money in a payments system is integers in the
 * smallest unit — `2550` pesewas, not `25.50` cedis — because integers have no
 * representation error at all, and every processor (Paystack included) already
 * speaks them on the wire.
 *
 * That change is NOT applied here, deliberately. It is a representation change
 * across ~263 read/write sites in four codebases (API, rider, driver, admin),
 * and the failure mode of missing ONE site is a charge wrong by a factor of
 * 100 — strictly worse than the drift it fixes, and invisible until a real
 * rider is billed. It needs a running database and an end-to-end payment test
 * to land safely, and neither exists yet.
 *
 * What this file guarantees in the meantime: nothing reaches storage with more
 * than two decimal places, so drift cannot accumulate even though the
 * representation is still floating point. `toMinor`/`fromMinor` exist so that
 * conversion, when it happens, has one defined boundary to move rather than
 * 263 scattered ones.
 */

/** Round to 2 decimal places (GHS cedis). Every money write goes through this. */
function toCedis(raw) {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // `n * 100` can itself land on 2549.9999999999995, so nudge before rounding.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Round each element in an array of money values */
function toCedisArray(arr) {
  return arr.map(toCedis);
}

/** Cedis → pesewas. The unit Paystack and every other processor speaks. */
function toMinor(cedis) {
  return Math.round(toCedis(cedis) * 100);
}

/** Pesewas → cedis, for display only. */
function fromMinor(pesewas) {
  return toCedis(Number(pesewas) / 100);
}

/**
 * Guard for money arriving from OUTSIDE the server — a client body, a webhook,
 * a CSV import. Throws rather than silently coercing, because a NaN fare that
 * quietly becomes 0 is a free ride, and a negative one is a refund nobody
 * authorised.
 */
function assertMoney(value, label = 'amount') {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} is not a finite number`);
  if (n < 0) throw new Error(`${label} may not be negative`);
  if (n > 1_000_000) throw new Error(`${label} exceeds the sanity ceiling`);
  return toCedis(n);
}

module.exports = { toCedis, toCedisArray, toMinor, fromMinor, assertMoney };
