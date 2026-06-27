'use strict';

/**
 * Money utility — rounds all monetary values to 2 decimal places
 * to prevent IEEE 754 float drift in aggregations.
 *
 * All money writes in the app should pass through these helpers.
 * Frontend displays should format with `.toFixed(2)` or `Intl.NumberFormat`.
 */

/** Round to 2 decimal places (GHS cedis) */
function toCedis(raw) {
  if (raw === null || raw === undefined) return 0;
  return Math.round(Number(raw) * 100) / 100;
}

/** Round each element in an array of money values */
function toCedisArray(arr) {
  return arr.map(toCedis);
}

module.exports = { toCedis, toCedisArray };
