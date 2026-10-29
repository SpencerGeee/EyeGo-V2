/**
 * ── SEATS ARE SOLD BY STRETCH, NOT BY TRIP ──────────────────────────────────
 *
 * A trotro leaves Kasoa full and is half empty by Kaneshie. Counting bookings
 * per trip calls that bus full all the way to Shiashie; the most people aboard
 * at any single point of the rider's OWN stretch is the truth (client meeting
 * 2026-10-29, item 1).
 *
 * A span is [from, to) as a fraction of the route: 0 = origin, 1 = destination.
 * Half-open on purpose — someone alighting at x frees the seat for someone
 * boarding at x. Callers pass only seat-occupying bookings
 * (`seatOccupyingWhere()`); this file decides nothing about statuses.
 *
 * Pure: no DB, no clock. The ONLY place capacity on a bus trip is decided —
 * see the invariant in scripts/invariants.test.mjs.
 */
const EPS = 1e-6;

/** A booking's span. No ratio = the trip's own end (whole route), which is
 *  also the safe reading of every row written before spans existed. */
function spanOf(b) {
  const from = Number.isFinite(b?.boardRatio) ? b.boardRatio : 0;
  const to = Number.isFinite(b?.alightRatio) ? b.alightRatio : 1;
  return [from, to];
}

/** Most seats held at any single point inside [from, to). */
function peakOccupancy(bookings, from = 0, to = 1) {
  const events = [];
  for (const bk of bookings ?? []) {
    const [s, e] = spanOf(bk);
    const lo = Math.max(s, from);
    const hi = Math.min(e, to);
    if (hi - lo <= EPS) continue;
    const n = Math.max(1, bk?.seats ?? 1);
    events.push([lo, n], [hi, -n]);
  }
  // At the same point ends (-n) sort before starts (+n): the half-open rule.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

function freeSeatsOnSpan(bookings, maxSeats, from = 0, to = 1) {
  return Math.max(0, (maxSeats ?? 0) - peakOccupancy(bookings, from, to));
}

/** The rider's stretch must point forward and start ahead of the bus. */
function isJoinableSpan({ busRatio = 0, from, to, aheadMargin = 0 }) {
  return Number.isFinite(from) && Number.isFinite(to) && to - from > EPS && from >= busRatio + aheadMargin;
}

module.exports = { spanOf, peakOccupancy, freeSeatsOnSpan, isJoinableSpan };
