'use strict';

const prisma = require('../config/database');
const { AppError } = require('../utils/errors');
const { seatOccupyingWhere } = require('../utils/booking-status');

/**
 * CSV exports for the console.
 *
 * WHY. Nothing in the console could export anything. Finance had no way to
 * reconcile against the payment provider except by reading numbers off a screen
 * and retyping them, and a regulator or insurer asking "give us every trip in
 * March" could not be answered at all.
 *
 * TWO RULES that shape everything here:
 *
 *  1. AN EXPORT IS A FILTERED QUERY, NOT A TABLE DUMP. Each dataset takes the
 *     same filters as the list page it sits on, so the button means "give me
 *     what I am looking at" — which is what an operator expects and what stops
 *     them exporting 400,000 rows to find twelve.
 *
 *  2. EXPORTS ARE CAPPED. `MAX_ROWS` exists because this runs in-process: an
 *     uncapped export of a year of bookings would build the whole string in
 *     memory and take the API down for everyone. Hitting the cap is reported in
 *     the response headers rather than silently truncating.
 *
 * Money is emitted BOTH ways — integer pesewas for arithmetic and a decimal
 * cedis column for humans — because a spreadsheet that silently reads pesewas
 * as cedis is off by a factor of a hundred, and that error is invisible.
 */

const MAX_ROWS = 50_000;

const ghs = (pesewas) => (typeof pesewas === 'number' ? (pesewas / 100).toFixed(2) : '');

/** Parse a date filter, tolerating both `2026-08-01` and a full ISO string. */
function dateRange(from, to) {
  const range = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      // A bare date means the whole of that day, not midnight at its start —
      // otherwise "to: today" returns nothing, which reads as a broken filter.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
  }
  return Object.keys(range).length ? range : undefined;
}

// ── datasets ─────────────────────────────────────────────────────────────────

const DATASETS = {
  trips: {
    label: 'Trips',
    roles: null, // any console role
    columns: [
      { key: 'shortId', label: 'Trip code' },
      { key: 'id', label: 'Trip ID' },
      { key: 'status', label: 'Status' },
      { key: 'tier', label: 'Tier' },
      { label: 'Route', value: (t) => t.route?.name ?? '' },
      { label: 'From', value: (t) => t.pickupAddress ?? t.route?.originName ?? '' },
      { label: 'To', value: (t) => t.dropoffAddress ?? t.route?.destinationName ?? '' },
      { label: 'Driver', value: (t) => t.driver?.name ?? '' },
      { label: 'Driver phone', value: (t) => t.driver?.phone ?? '' },
      { label: 'Vehicle', value: (t) => t.vehicle?.plateNumber ?? '' },
      { key: 'confirmedSeats', label: 'Seats taken' },
      { key: 'maxSeats', label: 'Seats total' },
      { label: 'Base fare (pesewas)', value: (t) => t.baseFarePesewas },
      { label: 'Base fare (GHS)', value: (t) => ghs(t.baseFarePesewas) },
      { key: 'surgeMultiplier', label: 'Surge' },
      { label: 'Departure', value: (t) => t.departureTime },
      { label: 'Completed', value: (t) => t.completedAt },
      { label: 'Cancelled', value: (t) => t.cancelledAt },
      { key: 'cancellationReason', label: 'Cancellation reason' },
      { label: 'Created', value: (t) => t.createdAt },
    ],
    async fetch({ status, from, to, take }) {
      const where = {};
      if (status) where.status = String(status);
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.trip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          route: { select: { name: true, originName: true, destinationName: true } },
          driver: { select: { name: true, phone: true } },
          vehicle: { select: { plateNumber: true } },
        },
      });
    },
  },

  bookings: {
    label: 'Bookings',
    roles: null,
    columns: [
      { key: 'id', label: 'Booking ID' },
      { label: 'Trip code', value: (b) => b.trip?.shortId ?? '' },
      { key: 'tripId', label: 'Trip ID' },
      { key: 'status', label: 'Status' },
      { key: 'paymentStatus', label: 'Payment status' },
      { key: 'paymentMethod', label: 'Payment method' },
      { label: 'Rider', value: (b) => b.user?.name ?? b.guestName ?? '' },
      { label: 'Rider phone', value: (b) => b.user?.phone ?? b.guestPhone ?? b.offlinePhone ?? '' },
      { key: 'seatNumber', label: 'Seat' },
      { label: 'Fare (pesewas)', value: (b) => b.fareAmountPesewas },
      { label: 'Fare (GHS)', value: (b) => ghs(b.fareAmountPesewas) },
      { label: 'Commission (pesewas)', value: (b) => b.commissionAmountPesewas },
      { label: 'Commission (GHS)', value: (b) => ghs(b.commissionAmountPesewas) },
      { key: 'paystackRef', label: 'Gateway ref' },
      { label: 'Cancelled', value: (b) => b.cancelledAt },
      { key: 'cancellationReason', label: 'Cancellation reason' },
      { label: 'Created', value: (b) => b.createdAt },
    ],
    async fetch({ status, from, to, take }) {
      const where = {};
      if (status) where.status = String(status);
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          user: { select: { name: true, phone: true } },
          trip: { select: { shortId: true } },
        },
      });
    },
  },

  drivers: {
    label: 'Drivers',
    roles: null,
    columns: [
      { key: 'id', label: 'Driver ID' },
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'isOnline', label: 'Toggled online' },
      { key: 'ghanaCardNumber', label: 'Ghana Card' },
      { label: 'Vehicle', value: (d) => (d.vehicles?.[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model}` : '') },
      { label: 'Plate', value: (d) => d.vehicles?.[0]?.plateNumber ?? '' },
      { label: 'Seats', value: (d) => d.vehicles?.[0]?.seaterCount ?? '' },
      { label: 'Tier', value: (d) => d.vehicles?.[0]?.tier ?? '' },
      { label: 'Completed trips', value: (d) => d._count?.trips ?? 0 },
      { label: 'Wallet (pesewas)', value: (d) => d.walletBalancePesewas },
      { label: 'Wallet (GHS)', value: (d) => ghs(d.walletBalancePesewas) },
      { key: 'rejectionReason', label: 'Rejection reason' },
      { label: 'Joined', value: (d) => d.createdAt },
    ],
    async fetch({ status, from, to, take }) {
      const where = {};
      if (status) where.status = String(status);
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.driver.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          vehicles: { where: { isActive: true }, take: 1 },
          _count: { select: { trips: true } },
        },
      });
    },
  },

  users: {
    label: 'Riders',
    roles: null,
    columns: [
      { key: 'id', label: 'Rider ID' },
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'isBanned', label: 'Banned' },
      { key: 'isActive', label: 'Active' },
      { key: 'businessMode', label: 'Business account' },
      { key: 'businessCompanyName', label: 'Company' },
      { label: 'Rides', value: (u) => u._count?.bookings ?? 0 },
      { label: 'Wallet (pesewas)', value: (u) => u.walletBalancePesewas },
      { label: 'Wallet (GHS)', value: (u) => ghs(u.walletBalancePesewas) },
      { label: 'Joined', value: (u) => u.createdAt },
    ],
    async fetch({ from, to, take }) {
      const where = {};
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: { _count: { select: { bookings: { where: seatOccupyingWhere() } } } },
      });
    },
  },

  revenue: {
    label: 'Settled fares',
    roles: ['FINANCE'],
    columns: [
      { key: 'id', label: 'Booking ID' },
      { label: 'Trip code', value: (b) => b.trip?.shortId ?? '' },
      { label: 'Settled at', value: (b) => b.createdAt },
      { key: 'paymentMethod', label: 'Method' },
      { label: 'Rider', value: (b) => b.user?.name ?? b.guestName ?? '' },
      { label: 'Driver', value: (b) => b.trip?.driver?.name ?? '' },
      { label: 'Fare (pesewas)', value: (b) => b.fareAmountPesewas },
      { label: 'Fare (GHS)', value: (b) => ghs(b.fareAmountPesewas) },
      { label: 'Commission (pesewas)', value: (b) => b.commissionAmountPesewas },
      { label: 'Commission (GHS)', value: (b) => ghs(b.commissionAmountPesewas) },
      { label: 'Net to driver (GHS)', value: (b) => ghs(b.fareAmountPesewas - b.commissionAmountPesewas) },
      { key: 'paystackRef', label: 'Gateway ref' },
    ],
    async fetch({ from, to, take }) {
      // Same definition of settled revenue the dashboard and Revenue page use.
      const where = { paymentStatus: 'PAID' };
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          user: { select: { name: true } },
          trip: { select: { shortId: true, driver: { select: { name: true } } } },
        },
      });
    },
  },

  refunds: {
    label: 'Refunds',
    roles: ['FINANCE'],
    columns: [
      { key: 'id', label: 'Refund ID' },
      { label: 'Issued', value: (r) => r.createdAt },
      { key: 'status', label: 'Status' },
      { key: 'destination', label: 'Destination' },
      { label: 'Amount (pesewas)', value: (r) => r.amountPesewas },
      { label: 'Amount (GHS)', value: (r) => ghs(r.amountPesewas) },
      { key: 'reason', label: 'Reason' },
      { label: 'Rider', value: (r) => r.user?.name ?? '' },
      { label: 'Rider phone', value: (r) => r.user?.phone ?? '' },
      { key: 'bookingId', label: 'Booking ID' },
      { key: 'adminEmail', label: 'Authorised by' },
      { key: 'providerRef', label: 'Provider ref' },
      { key: 'failureReason', label: 'Failure reason' },
    ],
    async fetch({ status, from, to, take }) {
      const where = {};
      if (status) where.status = String(status);
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: { user: { select: { name: true, phone: true } } },
      });
    },
  },

  'audit-logs': {
    label: 'Audit log',
    // The audit log names who did what. Reading it is a superadmin/viewer
    // concern, and taking a copy of it away even more so.
    roles: ['VIEWER'],
    columns: [
      { label: 'When', value: (a) => a.createdAt },
      { key: 'adminEmail', label: 'Admin' },
      { key: 'adminRole', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'targetType', label: 'Target type' },
      { key: 'targetId', label: 'Target ID' },
      { key: 'method', label: 'Method' },
      { key: 'path', label: 'Path' },
      { key: 'statusCode', label: 'Status' },
      { key: 'ip', label: 'IP' },
    ],
    async fetch({ action, from, to, take }) {
      const where = {};
      if (action) where.action = String(action);
      const created = dateRange(from, to);
      if (created) where.createdAt = created;
      return prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    },
  },
};

/** Names the console can ask for, with the role each needs. */
function listDatasets() {
  return Object.entries(DATASETS).map(([name, d]) => ({ name, label: d.label, roles: d.roles }));
}

/**
 * Build one export.
 * Returns the rows and the column spec; the controller renders and names the file.
 */
async function buildExport(name, filters = {}) {
  const dataset = DATASETS[name];
  if (!dataset) {
    throw new AppError(
      `Unknown export "${name}". Available: ${Object.keys(DATASETS).join(', ')}`,
      404,
      'UNKNOWN_DATASET',
    );
  }

  const requested = parseInt(filters.limit, 10);
  const take = Math.min(Number.isInteger(requested) && requested > 0 ? requested : MAX_ROWS, MAX_ROWS);

  const rows = await dataset.fetch({ ...filters, take });

  return {
    dataset,
    rows,
    columns: dataset.columns,
    truncated: rows.length >= take && take === MAX_ROWS,
    maxRows: MAX_ROWS,
  };
}

module.exports = { DATASETS, MAX_ROWS, listDatasets, buildExport };
