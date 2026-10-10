'use strict';

const prisma = require('../config/database');

/**
 * ── WHAT HAPPENED WHILE YOU WERE AWAY ───────────────────────────────────────
 *
 * BUGFIX ("if the driver marks a no-show and the rider app is closed, when it
 * opens it should bring a screen to account for that so it doesn't look like it
 * never existed — think about all the other flows that would go silent on app
 * restart").
 *
 * Every ending, refusal and money movement was announced on exactly one
 * channel — a socket frame or a push — and an app that was killed received
 * neither. On reopen the ride had simply vanished. This is the reconciliation
 * channel: one read of the last 48 h of facts about this person, each with a
 * stable `key` the app remembers once it has shown it. The server never
 * decides what was "seen" — that is per device, and showing a ride's ending on
 * a second phone is correct, not a duplicate.
 *
 * Read-only and cheap: a handful of indexed `findMany`s, no writes, safe to
 * call on every foreground.
 *
 * ── AND THE INBOX ───────────────────────────────────────────────────────────
 * Both apps' notification inboxes used to be derived feeds of their own
 * (bookings → "Seat booked!", trips → "Trip completed") with mark-read routes
 * that did nothing and an unread count that counted PAID bookings forever. The
 * inbox is now this same list over `days` (≤ 30), worded by the same client
 * presenters as the away sheets — one source of "what happened to me".
 */

const WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_DAYS = 30;
const TAKE = 20;

/** `days` widens the window for the inbox; the away sheet keeps 48 h. */
function sinceDate(sinceMs, days) {
  const d = Number(days);
  const windowMs = Number.isFinite(d) && d > 0 ? Math.min(d, MAX_DAYS) * 86_400_000 : WINDOW_MS;
  const floor = Date.now() - windowMs;
  const s = Number(sinceMs);
  return new Date(Number.isFinite(s) && s > floor ? s : floor);
}

/**
 * Someone else wrote on one of this person's tickets — support, or (lost item)
 * the driver. `ownRoles` are the roles this person writes under themselves.
 */
async function supportReplies(ticketWhere, ownRoles, since) {
  const replies = await prisma.ticketMessage.findMany({
    where: { createdAt: { gte: since }, senderRole: { notIn: ownRoles }, ticket: ticketWhere },
    select: { id: true, ticketId: true, text: true, senderRole: true, createdAt: true, ticket: { select: { subject: true, category: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return replies.map((m) => ({
    key: `SUPPORT_REPLY:${m.id}`, kind: 'SUPPORT_REPLY', at: m.createdAt, ticketId: m.ticketId,
    subject: m.ticket?.subject ?? null, category: m.ticket?.category ?? null, from: m.senderRole,
    preview: m.text.length > 140 ? `${m.text.slice(0, 137)}…` : m.text,
  }));
}

const dest = (b) => b.dropoffAddress ?? b.trip?.dropoffAddress ?? b.trip?.route?.destinationName ?? null;

/** What happened to the money, from the booking's own fields — never guessed. */
function moneyOf(b) {
  if (b.status === 'REFUNDED' || b.paymentStatus === 'REFUNDED') return 'REFUNDED';
  if (b.paymentStatus === 'PAID') return 'KEPT';
  return 'NOT_CHARGED';
}

/** The rider's side of one booking, or null when there is nothing to tell them. */
function riderBookingOutcome(b, ratedTripIds) {
  const t = b.trip;
  const base = { tripId: b.tripId, bookingId: b.id, money: moneyOf(b), destination: dest(b) };
  // The passenger themselves was marked absent (riderNoShow) — not refunded.
  if (b.status === 'NO_SHOW') return { kind: 'RIDER_NO_SHOW', at: b.updatedAt, ...base };
  if (b.cancellationReason === 'HOLD_EXPIRED' || b.status === 'EXPIRED') {
    return { kind: 'SEAT_RELEASED', at: b.updatedAt, ...base };
  }
  if (b.cancellationReason === 'DRIVER_DECLINED') return { kind: 'DRIVER_CANCELLED', at: b.updatedAt, ...base };
  switch (t?.status) {
    case 'COMPLETED':
      // Only a ride they actually took. `rated` lets the away sheet skip a ride
      // they already rated while the inbox still lists it.
      if (!['COMPLETED', 'BOARDED', 'PAID', 'CONFIRMED'].includes(b.status)) return null;
      return { kind: 'COMPLETED', at: t.updatedAt, rated: ratedTripIds.has(b.tripId), ...base };
    case 'NO_SHOW':
      return { kind: 'DRIVER_NO_SHOW', at: t.updatedAt, ...base };
    case 'NO_DRIVERS_FOUND':
      return { kind: 'NO_DRIVERS', at: t.updatedAt, ...base };
    case 'EXPIRED':
      return { kind: 'EXPIRED', at: t.updatedAt, ...base };
    case 'CANCELLED':
      if (t.cancelledBy === 'RIDER') return null; // they know
      return {
        kind: t.cancelledBy === 'DRIVER' ? 'DRIVER_CANCELLED' : 'CANCELLED_BY_EYEGO',
        at: t.cancelledAt ?? t.updatedAt,
        ...base,
      };
    default:
      return null;
  }
}

async function forRider(userId, sinceMs, { days } = {}) {
  const since = sinceDate(sinceMs, days);
  const [bookings, requests, intents, refunds, ratings, replies, received] = await Promise.all([
    prisma.booking.findMany({
      where: {
        userId,
        updatedAt: { gte: since },
        OR: [
          { status: { in: ['NO_SHOW', 'EXPIRED'] } },
          { cancellationReason: { in: ['HOLD_EXPIRED', 'DRIVER_DECLINED'] } },
          { trip: { status: { in: ['COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW'] } } },
        ],
      },
      select: {
        id: true, tripId: true, status: true, paymentStatus: true, cancellationReason: true,
        dropoffAddress: true, updatedAt: true,
        trip: {
          select: {
            status: true, cancelledBy: true, cancelledAt: true, updatedAt: true, dropoffAddress: true,
            route: { select: { destinationName: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: days ? 50 : TAKE,
    }),
    // An on-demand request that ended before any booking existed.
    prisma.trip.findMany({
      where: {
        requesterId: userId,
        updatedAt: { gte: since },
        status: { in: ['NO_DRIVERS_FOUND', 'EXPIRED'] },
        bookings: { none: { userId } },
      },
      select: { id: true, status: true, updatedAt: true, dropoffAddress: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.scheduledRideIntent.findMany({
      where: { userId, updatedAt: { gte: since }, status: { in: ['MATCHED', 'EXPIRED'] } },
      select: { id: true, status: true, matchedTripId: true, scheduledAt: true, updatedAt: true, route: { select: { destinationName: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.refund.findMany({
      where: { userId, status: 'COMPLETED', updatedAt: { gte: since } },
      select: { id: true, bookingId: true, amountPesewas: true, updatedAt: true, booking: { select: { tripId: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    // Not windowed: a ride rated before the window opened is still rated.
    prisma.driverRating.findMany({ where: { userId, createdAt: { gte: new Date(since.getTime() - 7 * 86_400_000) } }, select: { tripId: true } }),
    // A driver's own tickets also carry a shadow userId — those are not the rider's.
    supportReplies({ userId, driverId: null }, ['USER'], since),
    // Ride credits sent by another rider (send-money). The push is pref-gated.
    prisma.paymentTransaction.findMany({
      where: { userId, status: 'SUCCESS', createdAt: { gte: since }, gatewayResponse: { startsWith: 'P2P_RECEIVE' } },
      select: { id: true, amountPesewas: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const rated = new Set(ratings.map((r) => r.tripId));
  const items = [];
  for (const b of bookings) {
    const o = riderBookingOutcome(b, rated);
    if (o) items.push({ key: `${o.kind}:${b.id}`, ...o });
  }
  for (const t of requests) {
    const kind = t.status === 'NO_DRIVERS_FOUND' ? 'NO_DRIVERS' : 'EXPIRED';
    items.push({ key: `${kind}:${t.id}`, kind, at: t.updatedAt, tripId: t.id, money: 'NOT_CHARGED', destination: t.dropoffAddress });
  }
  for (const i of intents) {
    const kind = i.status === 'MATCHED' ? 'SCHEDULED_MATCHED' : 'SCHEDULED_EXPIRED';
    items.push({
      key: `${kind}:${i.id}`, kind, at: i.updatedAt, tripId: i.matchedTripId ?? null, intentId: i.id,
      scheduledAt: i.scheduledAt, destination: i.route?.destinationName ?? null,
    });
  }
  for (const r of refunds) {
    items.push({
      key: `REFUND_ISSUED:${r.id}`, kind: 'REFUND_ISSUED', at: r.updatedAt, tripId: r.booking?.tripId ?? null,
      bookingId: r.bookingId, amountPesewas: r.amountPesewas,
    });
  }
  items.push(...replies);
  for (const p of received) {
    items.push({ key: `MONEY_RECEIVED:${p.id}`, kind: 'MONEY_RECEIVED', at: p.createdAt, amountPesewas: p.amountPesewas });
  }
  return sortNewestFirst(items);
}

/** The driver's side: their trips ending, their passengers moving, their money. */
async function forDriver(driverId, sinceMs, { days } = {}) {
  const since = sinceDate(sinceMs, days);
  const [ended, seatChanges, wallet, documents, replies, reports] = await Promise.all([
    prisma.trip.findMany({
      where: {
        driverId,
        updatedAt: { gte: since },
        // `cancelledBy: null` spelled out: SQL `<> 'DRIVER'` drops NULL rows.
        OR: [
          { status: 'CANCELLED', cancelledBy: { in: ['RIDER', 'SYSTEM', 'ADMIN'] } },
          { status: 'CANCELLED', cancelledBy: null },
          { status: 'EXPIRED' },
          // The driver ended these themselves — the inbox lists them, the sheet doesn't.
          { status: 'COMPLETED' },
        ],
      },
      select: {
        id: true, status: true, cancelledBy: true, cancelledAt: true, completedAt: true, updatedAt: true, departureTime: true,
        dropoffAddress: true, route: { select: { destinationName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: days ? 40 : 10,
    }),
    // Seats taken and given back on trips that are still ahead of them.
    prisma.booking.findMany({
      where: {
        updatedAt: { gte: since },
        trip: { driverId, status: { in: ['SCHEDULED', 'FILLING', 'CONFIRMED'] } },
        status: { in: ['CONFIRMED', 'PAID', 'CANCELLED'] },
      },
      select: { tripId: true, status: true, seats: true, createdAt: true, updatedAt: true, cancellationReason: true },
      take: 200,
    }),
    prisma.walletTransaction.findMany({
      where: {
        driverId,
        createdAt: { gte: since },
        OR: [
          { type: { in: ['TIP', 'WITHDRAWAL_REVERSAL', 'QUEST_BONUS', 'CANCELLATION_FEE'] } },
          // payouts.service rewrites the description on `transfer.success`.
          { type: 'WITHDRAWAL', description: 'Withdrawal completed' },
        ],
      },
      select: { id: true, type: true, amountPesewas: true, tripId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.driverDocument.findMany({
      where: { driverId, reviewedAt: { gte: since }, status: { in: ['APPROVED', 'REJECTED'] } },
      select: { id: true, type: true, status: true, rejectionReason: true, reviewedAt: true },
      take: 10,
    }),
    supportReplies({ driverId }, ['USER', 'DRIVER'], since),
    // A report the driver filed (unruly passenger, damage…) that support closed.
    prisma.tripReport.findMany({
      where: { driverId, resolvedAt: { gte: since } },
      select: { id: true, tripId: true, type: true, resolvedAt: true },
      take: 5,
    }),
  ]);

  const WALLET_KIND = { TIP: 'TIP_RECEIVED', QUEST_BONUS: 'BONUS_RECEIVED', WITHDRAWAL_REVERSAL: 'PAYOUT_FAILED', WITHDRAWAL: 'PAYOUT_COMPLETED', CANCELLATION_FEE: 'CANCELLATION_FEE_EARNED' };
  const items = [];
  for (const t of ended) {
    const kind =
      t.status === 'COMPLETED' ? 'TRIP_COMPLETED'
      : t.status === 'EXPIRED' ? 'TRIP_EXPIRED'
      : t.cancelledBy === 'RIDER' ? 'RIDER_CANCELLED'
      : 'TRIP_CANCELLED_BY_EYEGO';
    items.push({
      key: `${kind}:${t.id}`, kind, at: t.completedAt ?? t.cancelledAt ?? t.updatedAt, tripId: t.id,
      destination: t.route?.destinationName ?? t.dropoffAddress ?? null, departureTime: t.departureTime,
    });
  }

  // One line per trip, not one per seat: "3 seats booked, 1 cancelled".
  const perTrip = new Map();
  for (const b of seatChanges) {
    const e = perTrip.get(b.tripId) ?? { booked: 0, cancelled: 0, at: new Date(0) };
    const seats = Math.max(1, b.seats ?? 1);
    if (b.status === 'CANCELLED') {
      if (b.cancellationReason === 'HOLD_EXPIRED') continue; // never theirs to lose
      e.cancelled += seats;
    } else if (b.createdAt >= since) {
      e.booked += seats;
    } else {
      continue;
    }
    if (b.updatedAt > e.at) e.at = b.updatedAt;
    perTrip.set(b.tripId, e);
  }
  for (const [tripId, e] of perTrip) {
    // Keyed on the counts, so a later change on the same trip is news again.
    items.push({ key: `SEATS_CHANGED:${tripId}:${e.booked}:${e.cancelled}`, kind: 'SEATS_CHANGED', at: e.at, tripId, booked: e.booked, cancelled: e.cancelled });
  }

  for (const w of wallet) {
    const kind = WALLET_KIND[w.type];
    items.push({ key: `${kind}:${w.id}`, kind, at: w.createdAt, tripId: w.tripId ?? null, amountPesewas: Math.abs(w.amountPesewas) });
  }
  for (const d of documents) {
    const kind = d.status === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED';
    items.push({ key: `${kind}:${d.id}`, kind, at: d.reviewedAt, documentType: d.type, reason: d.rejectionReason ?? null });
  }
  items.push(...replies);
  for (const r of reports) {
    items.push({ key: `REPORT_RESOLVED:${r.id}`, kind: 'REPORT_RESOLVED', at: r.resolvedAt, tripId: r.tripId, reason: r.type });
  }
  return sortNewestFirst(items);
}

function sortNewestFirst(items) {
  return items
    .map((i) => ({ ...i, at: new Date(i.at).toISOString() }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

module.exports = { forRider, forDriver, riderBookingOutcome, WINDOW_MS };
