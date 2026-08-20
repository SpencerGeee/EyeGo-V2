'use strict';

const prisma = require('../config/database');
const provider = require('../modules/payments/provider');
const riderWallet = require('./rider-wallet.service');
const { AppError, NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Refunds, issued by a human from the console.
 *
 * WHY THIS EXISTS. Support could agree a rider had been overcharged and then do
 * nothing about it: there was no admin path to move money at all. The only
 * refund logic in the codebase fired automatically when a booking failed at
 * payment time. Every ride-hailing support desk needs this on day one.
 *
 * TWO DESTINATIONS, and they behave differently on purpose:
 *
 *   WALLET  — credited to the rider's EyeGo balance. Synchronous, final the
 *             moment it returns, and the right answer for almost every case:
 *             the rider can spend it on the next trip immediately, and a cash
 *             fare has no card to send anything back to anyway.
 *
 *   GATEWAY — sent to the original card or mobile-money account through the
 *             payment seam. The provider ACCEPTS it now and settles days later
 *             on the scheme's timetable, so this lands as PENDING and is only
 *             COMPLETED when the provider says so. Requires a real gateway
 *             reference on the booking; a cash booking cannot use it.
 *
 * OVER-REFUNDING is the failure mode to design against, so the cap is computed
 * from what has already been refunded rather than trusted from the caller, and
 * the whole thing runs in one transaction.
 */

const DESTINATIONS = { WALLET: 'WALLET', GATEWAY: 'GATEWAY' };
const STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED', FAILED: 'FAILED' };

/** Booking states where a refund makes sense. */
const REFUNDABLE_BOOKING_STATUSES = ['PAID', 'BOARDED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'REFUNDED'];

/**
 * How much of this booking is still refundable.
 * Exposed so the console can show the ceiling before anyone types a number.
 */
async function refundableAmount(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, fareAmountPesewas: true, status: true, paymentStatus: true,
      paymentMethod: true, paystackRef: true, userId: true,
    },
  });
  if (!booking) throw new NotFoundError('Booking');

  const already = await prisma.refund.aggregate({
    where: { bookingId, status: { in: [STATUS.PENDING, STATUS.COMPLETED] } },
    _sum: { amountPesewas: true },
  });
  const refunded = already._sum.amountPesewas ?? 0;

  return {
    booking,
    farePesewas: booking.fareAmountPesewas,
    alreadyRefundedPesewas: refunded,
    remainingPesewas: Math.max(0, booking.fareAmountPesewas - refunded),
    // A gateway refund needs something to send the money back to.
    gatewayAvailable: Boolean(booking.paystackRef) && booking.paymentMethod !== 'CASH',
  };
}

/**
 * Issue a refund.
 *
 * @param {string} bookingId
 * @param {object} opts
 * @param {number} opts.amountPesewas  omit for the full remaining amount
 * @param {string} opts.reason         mandatory
 * @param {string} opts.destination    WALLET | GATEWAY
 * @param {object} opts.admin          { id, email }
 */
async function issueRefund(bookingId, { amountPesewas, reason, destination = DESTINATIONS.WALLET, admin } = {}) {
  if (!reason || !String(reason).trim()) {
    // Not politeness. An unexplained refund is indistinguishable from someone
    // quietly moving money out of the business.
    throw new ValidationError('A reason is required for every refund');
  }
  if (!DESTINATIONS[destination]) {
    throw new ValidationError(`destination must be WALLET or GATEWAY (received "${destination}")`);
  }

  const state = await refundableAmount(bookingId);
  const { booking } = state;

  if (!REFUNDABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError(
      `A booking in status ${booking.status} has nothing to refund — no money has been taken for it`,
      400,
      'NOT_REFUNDABLE',
    );
  }
  if (booking.paymentStatus !== 'PAID') {
    throw new AppError('This booking was never settled, so there is nothing to refund', 400, 'NOT_REFUNDABLE');
  }
  if (state.remainingPesewas <= 0) {
    throw new AppError('This booking has already been refunded in full', 409, 'ALREADY_REFUNDED');
  }

  const requested = amountPesewas == null ? state.remainingPesewas : parseInt(amountPesewas, 10);
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new ValidationError('amountPesewas must be a whole number of pesewas greater than zero');
  }
  if (requested > state.remainingPesewas) {
    throw new AppError(
      `Cannot refund ${requested} pesewas: only ${state.remainingPesewas} of this fare remains unrefunded` +
        (state.alreadyRefundedPesewas ? ` (${state.alreadyRefundedPesewas} already returned)` : ''),
      400,
      'REFUND_EXCEEDS_REMAINING',
    );
  }

  if (destination === DESTINATIONS.GATEWAY && !state.gatewayAvailable) {
    throw new AppError(
      booking.paymentMethod === 'CASH'
        ? 'This fare was paid in cash — there is no card to send it back to. Refund to the wallet instead.'
        : 'This booking has no gateway reference to refund against. Refund to the wallet instead.',
      400,
      'GATEWAY_REFUND_UNAVAILABLE',
    );
  }
  if (!booking.userId) {
    throw new AppError(
      'This booking has no rider account attached (guest or offline booking) — refund it in cash at the kerb.',
      400,
      'NO_RIDER_ACCOUNT',
    );
  }

  // ── WALLET: money moves now, inside one transaction with its ledger row ────
  if (destination === DESTINATIONS.WALLET) {
    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          bookingId,
          userId: booking.userId,
          amountPesewas: requested,
          reason: String(reason).trim(),
          destination,
          status: STATUS.COMPLETED,
          adminId: admin?.id ?? null,
          adminEmail: admin?.email ?? 'system',
        },
      });

      await riderWallet.record({
        userId: booking.userId,
        type: riderWallet.TYPES.REFUND,
        amountPesewas: requested,
        description: `Refund — ${String(reason).trim()}`,
        bookingId,
        refundId: created.id,
        adminId: admin?.id ?? null,
        tx,
      });

      // Only mark the booking REFUNDED once nothing is left. A partial refund
      // must not make the booking look fully reversed on every other screen.
      if (requested >= state.remainingPesewas) {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
        });
      }
      return created;
    });

    logger.info('[refund] wallet refund issued', {
      refundId: refund.id, bookingId, amountPesewas: requested, by: admin?.email,
    });
    return refund;
  }

  // ── GATEWAY: accepted now, settled by the provider later ──────────────────
  const refund = await prisma.refund.create({
    data: {
      bookingId,
      userId: booking.userId,
      amountPesewas: requested,
      reason: String(reason).trim(),
      destination,
      status: STATUS.PENDING,
      adminId: admin?.id ?? null,
      adminEmail: admin?.email ?? 'system',
    },
  });

  try {
    const res = await provider.refundTransaction({
      reference: booking.paystackRef,
      amountPesewas: requested,
      reason: String(reason).trim(),
    });
    const providerRef = res?.data?.id ? String(res.data.id) : null;
    return await prisma.refund.update({
      where: { id: refund.id },
      data: { providerRef },
    });
  } catch (err) {
    // The row stays, marked FAILED with the reason. A refund that vanished
    // because the gateway was briefly down is a refund nobody chases.
    logger.error('[refund] gateway refund failed', { refundId: refund.id, bookingId, error: err.message });
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: STATUS.FAILED, failureReason: err.message?.slice(0, 500) ?? 'Unknown gateway error' },
    });
    throw new AppError(
      `The payment provider refused the refund: ${err.message}. It is recorded as failed and can be retried, or refunded to the wallet instead.`,
      502,
      'GATEWAY_REFUND_FAILED',
    );
  }
}

/** Paged refund ledger for the finance view. */
async function listRefunds({ page = 1, limit = 25, status, from, to } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(Math.max(1, parseInt(limit, 10) || 25), 200);
  const where = {};
  if (status) where.status = String(status);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [refunds, total, totals] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (p - 1) * l,
      take: l,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        booking: { select: { id: true, tripId: true, fareAmountPesewas: true, paymentMethod: true } },
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.refund.count({ where }),
    prisma.refund.aggregate({ where, _sum: { amountPesewas: true } }),
  ]);

  return {
    refunds,
    total,
    page: p,
    totalPages: Math.ceil(total / l),
    totalRefundedPesewas: totals._sum.amountPesewas ?? 0,
  };
}

module.exports = {
  DESTINATIONS,
  STATUS,
  refundableAmount,
  issueRefund,
  listRefunds,
};
