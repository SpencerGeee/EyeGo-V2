'use strict';

const { formatGhs, percentOf, assertPesewas, wholePesewas } = require('../../utils/money');

const prisma = require('../../config/database');
const pushService = require('../../services/push.service');
const mapboxService = require('../../services/mapbox.service');
const { haversineMeters } = require('../../utils/geo');
const { NotFoundError, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

async function approveDriver(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'ACTIVE' },
  });

  // Audit log
  logger.info(`[ADMIN] Driver ${driverId} approved`);

  // Notify driver
  if (driver.fcmToken) {
    await pushService.notifications.driverApproved(driver.fcmToken);
  }

  return updated;
}

async function suspendDriver(driverId, reason) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  
  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'SUSPENDED', isOnline: false },
  });
  
  // Audit log
  logger.info(`[ADMIN] Driver ${driverId} suspended. Reason: ${reason || 'none'}`);
  
  return updated;
}

// AD1: admin-gated route list. The admin console previously read the PUBLIC
// /v1/routes endpoint (no admin secret), which only returns active routes; this
// returns ALL routes (incl. inactive) with their virtual stops for management.
//
// Excludes `isAdHoc` routes by default — those are auto-generated one-off rows
// behind a driver's ad-hoc "create trip from here" pickup or a rider's on-demand
// request (added with the group/on-demand pivot), not routes an admin curated.
// Without this filter every ad-hoc trip permanently adds a throwaway row here,
// burying the actual managed routes under a growing pile of "Pickup point →
// Destination" entries sorted to the top by createdAt. Pass includeAdHoc=true
// to see them anyway (e.g. investigating a specific trip's pricing).
async function getRoutes({ includeAdHoc = false } = {}) {
  const routes = await prisma.route.findMany({
    where: includeAdHoc ? undefined : { isAdHoc: false },
    orderBy: { createdAt: 'desc' },
    include: { virtualStops: { orderBy: { sequence: 'asc' } } },
  });
  return { routes };
}

async function createRoute(data) {
  let { name, originName, destinationName, originLat, originLng, destLat, destLng, distanceKm, stops } = data;

  // Auto-geocode if coordinates not provided. Mapbox first (real address match),
  // then free Nominatim if Mapbox is unconfigured/failing — without a fallback,
  // every route silently fell through to the same fake coordinates below whenever
  // MAPBOX_SECRET_TOKEN was a placeholder, making genuinely different routes
  // price identically.
  if (!originLat || !originLng) {
    const geo = await mapboxService.forwardGeocode(originName).catch(() => null)
      ?? await mapboxService.nominatimForwardGeocode(originName).catch(() => null);
    if (geo) { originLat = geo.lat; originLng = geo.lng; }
  }
  if (!destLat || !destLng) {
    const geo = await mapboxService.forwardGeocode(destinationName).catch(() => null)
      ?? await mapboxService.nominatimForwardGeocode(destinationName).catch(() => null);
    if (geo) { destLat = geo.lat; destLng = geo.lng; }
  }

  // A route with no resolvable coordinates can't be priced correctly — surface
  // that now instead of silently collapsing it onto a shared fake point (the old
  // behavior, which made unrelated routes look "eerily similar" in fare).
  if (!originLat || !originLng || !destLat || !destLng) {
    throw new AppError(
      'Could not determine coordinates for this route. Provide originLat/originLng and destLat/destLng manually.',
      400,
      'ROUTE_GEOCODE_FAILED',
    );
  }

  // Auto-calculate distance if not provided. Straight-line haversine undershoots
  // real driving distance; apply the same 1.35x winding-road multiplier already
  // used as the ETA fallback (driver.socket.js) when Mapbox Directions isn't
  // available, so distance-based fare actually reflects the route.
  if (!distanceKm) {
    const straightKm = haversineMeters(originLat, originLng, destLat, destLng) / 1000;
    distanceKm = Math.round(straightKm * 1.35 * 10) / 10;
  }

  return prisma.route.create({
    data: {
      name, originName, destinationName,
      originLat, originLng, destLat, destLng, distanceKm,
      virtualStops: {
        create: (stops || []).map((s, i) => ({
          name: s.name, lat: s.lat || originLat, lng: s.lng || originLng, sequence: i + 1,
        })),
      },
    },
    include: { virtualStops: true },
  });
}

async function updateRoute(routeId, data) {
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw new NotFoundError('Route');

  // Preserve existing coordinates if not provided in update
  const name = data.name ?? route.name;
  const originName = data.originName ?? route.originName;
  const destinationName = data.destinationName ?? route.destinationName;
  const originLat = data.originLat ?? route.originLat;
  const originLng = data.originLng ?? route.originLng;
  const destLat = data.destLat ?? route.destLat;
  const destLng = data.destLng ?? route.destLng;
  const distanceKm = data.distanceKm ?? route.distanceKm;

  return prisma.route.update({
    where: { id: routeId },
    data: { name, originName, destinationName, originLat, originLng, destLat, destLng, distanceKm },
    include: { virtualStops: true },
  });
}

async function deleteRoute(routeId) {
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw new NotFoundError('Route');

  // Deactivate instead of hard delete to preserve referential integrity
  return prisma.route.update({
    where: { id: routeId },
    data: { isActive: false },
  });
}

async function addVirtualStops(routeId, stops) {
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw new NotFoundError('Route');

  const maxSeq = await prisma.virtualStop.aggregate({
    where: { routeId },
    _max: { sequence: true },
  });

  let nextSeq = (maxSeq._max.sequence || 0) + 1;
  return prisma.virtualStop.createMany({
    data: stops.map((s) => ({ routeId, name: s.name, lat: s.lat, lng: s.lng, sequence: nextSeq++ })),
  });
}

async function getAllPulseSchedules() {
  return prisma.pulseSchedule.findMany({
    include: { route: true },
    orderBy: { departureTime: 'asc' },
  });
}

async function createPulseSchedule(data) {
  return prisma.pulseSchedule.create({ data });
}

async function getAllTrips({ page = 1, limit = 20, status }) {
  const where = status ? { status } : {};
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const skip = (p - 1) * l;
  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: {
        route: true,
        driver: { select: { name: true, phone: true, walletBalancePesewas: true } },
        vehicle: true,
        bookings: {
          where: { status: { notIn: ['CANCELLED'] } },
          include: { user: { select: { name: true, phone: true, walletBalancePesewas: true } } },
          orderBy: { seatNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.trip.count({ where }),
  ]);
  return { trips, total, page: p, totalPages: Math.ceil(total / l) };
}

async function getAllBookings({ page = 1, limit = 20 }) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const skip = (p - 1) * l;
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      include: {
        trip: { include: { route: true } },
        user: { select: { name: true, phone: true, walletBalancePesewas: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.booking.count(),
  ]);
  return { bookings, total, page: p, totalPages: Math.ceil(total / l) };
}

async function getPendingDrivers() {
  return prisma.driver.findMany({
    where: { status: 'PENDING_REVIEW' },
    include: { vehicles: true },
    orderBy: { createdAt: 'asc' },
  });
}

// Default limit stays 20 for API callers, but the cap is 500: the admin SPA
// renders the whole fleet in one table with client-side search (no pagination
// UI), so the old 100-cap — and especially the unpassed default of 20 —
// silently hid every driver beyond the first page.
async function getAllDrivers({ page = 1, limit = 20 } = {}) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 500);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;
  const [data, total] = await Promise.all([
    prisma.driver.findMany({
      include: {
        vehicles: true,
        _count: { select: { trips: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.driver.count(),
  ]);

  // AD3: the admin drivers table reads a per-driver average rating, but the
  // Driver model has no denormalized rating column — only a DriverRating[]
  // relation that findMany can't aggregate inline. Compute the averages in one
  // groupBy and attach `rating` to each row so the table stops showing '--'.
  const ratingAggs = await prisma.driverRating.groupBy({
    by: ['driverId'],
    where: { driverId: { in: data.map((d) => d.id) } },
    _avg: { stars: true },
  });
  const ratingMap = Object.fromEntries(
    ratingAggs.map((r) => [r.driverId, r._avg.stars ? Math.round(r._avg.stars * 10) / 10 : null]),
  );
  const withRatings = data.map((d) => ({ ...d, rating: ratingMap[d.id] ?? null }));

  return { data: withRatings, total, page: Math.max(1, parseInt(page) || 1), limit: take };
}

async function getAllUsers({ page = 1, limit = 20 } = {}) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 500);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;
  const [data, total] = await Promise.all([
    prisma.user.findMany({
      include: {
        _count: { select: { bookings: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count(),
  ]);
  return { data, total, page: Math.max(1, parseInt(page) || 1), limit: take };
}

async function getDriverDetail(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: {
      vehicles: true,
      walletTxs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!driver) throw new NotFoundError('Driver');

  // Performance stats
  const [totalTrips, completedTrips, cancelledTrips, ratingAgg, earningsAgg] = await Promise.all([
    prisma.trip.count({ where: { driverId } }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.trip.count({ where: { driverId, status: 'CANCELLED' } }),
    prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: { stars: true } }),
    prisma.booking.aggregate({
      where: { trip: { driverId }, status: { notIn: ['CANCELLED', 'PENDING'] } },
      _sum: { fareAmountPesewas: true, commissionAmountPesewas: true },
    }),
  ]);

  // Real per-document review state (status + photo URL + rejection reason) from
  // the same source the driver app uses. The previous presence-only summary
  // ({ ghanaCard: 'VERIFIED'|'MISSING' }) hid PENDING/REJECTED docs entirely,
  // so admins could never actually review uploads — while goOnline() blocks
  // drivers until every doc is VERIFIED.
  const driversService = require('../drivers/drivers.service');
  const docStatus = await driversService.getDocuments(driverId);

  return {
    ...driver,
    stats: {
      totalTrips,
      completedTrips,
      cancelledTrips,
      completionRate: totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0,
      cancellationRate: totalTrips > 0 ? Math.round((cancelledTrips / totalTrips) * 100) : 0,
      totalRevenue: earningsAgg._sum.fareAmountPesewas || 0,
      totalCommission: earningsAgg._sum.commissionAmountPesewas || 0,
      netEarnings: (earningsAgg._sum.fareAmountPesewas || 0) - (earningsAgg._sum.commissionAmountPesewas || 0),
    },
    ratings: {
      average: ratingAgg._avg.stars ? Math.round(ratingAgg._avg.stars * 10) / 10 : null,
      count: ratingAgg._count.stars || 0,
    },
    documents: docStatus,
  };
}

async function getDriverTrips(driverId, { page = 1, limit = 20 }) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const skip = (p - 1) * l;
  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where: { driverId },
      include: {
        route: true,
        bookings: {
          where: { status: { notIn: ['CANCELLED'] } },
          include: { user: { select: { name: true, phone: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.trip.count({ where: { driverId } }),
  ]);
  return { trips, total, page: p, totalPages: Math.ceil(total / l) };
}

async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      bookings: {
        where: { status: { notIn: ['CANCELLED'] } },
        include: {
          trip: { include: { route: true, driver: { select: { name: true, phone: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
  if (!user) throw new NotFoundError('User');
  return user;
}

async function getUserTrips(userId, { page = 1, limit = 20 }) {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  const skip = (p - 1) * l;
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: { userId, status: { notIn: ['CANCELLED'] } },
      include: {
        trip: { include: { route: true, driver: { select: { name: true, phone: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.booking.count({ where: { userId, status: { notIn: ['CANCELLED'] } } }),
  ]);
  return { bookings, total, page: p, totalPages: Math.ceil(total / l) };
}

async function getSupportTickets({ page = 1, limit = 20, status }) {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  const skip = (p - 1) * l;
  const where = status ? { status } : {};
  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: {
        user: { select: { name: true, phone: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return { tickets, total, page: p, totalPages: Math.ceil(total / l) };
}

// Driver trip reports were write-only (reportTrip persists them, nothing read
// them back). Surface them to the admin console. TripReport has no Prisma
// relations, so we hydrate driver/trip details in a second pass.
async function getTripReports({ page = 1, limit = 20, status }) {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  const skip = (p - 1) * l;
  const where = status ? { status } : {};
  const [reports, total] = await Promise.all([
    prisma.tripReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.tripReport.count({ where }),
  ]);

  const driverIds = [...new Set(reports.map((r) => r.driverId))];
  const tripIds = [...new Set(reports.map((r) => r.tripId))];
  const [drivers, trips] = await Promise.all([
    prisma.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true, phone: true } }),
    prisma.trip.findMany({
      where: { id: { in: tripIds } },
      select: { id: true, shortId: true, route: { select: { originName: true, destinationName: true } } },
    }),
  ]);
  const driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  const tripMap = Object.fromEntries(trips.map((t) => [t.id, t]));

  const hydrated = reports.map((r) => ({
    ...r,
    driver: driverMap[r.driverId] ?? null,
    trip: tripMap[r.tripId] ?? null,
  }));

  return { reports: hydrated, total, page: p, totalPages: Math.ceil(total / l) };
}

// The ticket list only ever loads each ticket's LAST message (take: 1, for the
// preview line), so the admin console's ticket modal had no way to show the
// full conversation history, or the category/priority/linked-driver fields
// that already exist on SupportTicket but were never fetched anywhere. This
// gives the modal a real detail endpoint to fetch on open.
async function getSupportTicketDetail(ticketId) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true, walletBalancePesewas: true, isBanned: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw new NotFoundError('SupportTicket');

  // SupportTicket.driverId is a bare id column (no Prisma relation), so hydrate
  // it manually — same pattern as getTripReports/getSosEvents below.
  let driver = null;
  if (ticket.driverId) {
    driver = await prisma.driver.findUnique({
      where: { id: ticket.driverId },
      select: { id: true, name: true, phone: true, status: true },
    });
  }

  return { ...ticket, driver };
}

async function respondToTicket(ticketId, { text, senderId, senderRole }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError('SupportTicket');

  // Update status to IN_PROGRESS if currently OPEN
  if (ticket.status === 'OPEN') {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'IN_PROGRESS' } });
  }

  return prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: senderId || 'admin',
      senderRole: senderRole || 'ADMIN',
      text,
    },
  });
}

async function closeTicket(ticketId) {
  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: 'CLOSED' },
  });
}

async function getPromotions() {
  return prisma.promotion.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { bookings: true } } },
  });
}

async function createPromotion(data) {
  const discountPercent = parseInt(data.discountPercent);
  const maxDiscountPesewas = parseFloat(data.maxDiscountPesewas);
  const expiry = new Date(data.expiry);
  const { AppError } = require('../../utils/errors');
  if (!data.code || !data.code.trim()) throw new AppError('Promo code is required', 400);
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    throw new AppError('discountPercent must be between 1 and 100', 400);
  }
  if (!Number.isFinite(maxDiscountPesewas) || maxDiscountPesewas <= 0) throw new AppError('maxDiscountPesewas must be positive', 400);
  if (Number.isNaN(expiry.getTime())) throw new AppError('Invalid expiry date', 400);
  try {
    return await prisma.promotion.create({
      data: {
        code: data.code.trim().toUpperCase(),
        discountPercent,
        maxDiscountPesewas,
        expiry,
        active: data.active !== false,
      },
    });
  } catch (err) {
    // Promotion.code is @unique — surface a clean 409 instead of a raw P2002 500
    if (err.code === 'P2002') throw new AppError('A promotion with this code already exists', 409, 'DUPLICATE_CODE');
    throw err;
  }
}

async function togglePromotion(promotionId) {
  const promo = await prisma.promotion.findUnique({ where: { id: promotionId } });
  if (!promo) throw new NotFoundError('Promotion');
  return prisma.promotion.update({
    where: { id: promotionId },
    data: { active: !promo.active },
  });
}

async function rejectDriver(driverId, reason) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'REJECTED', rejectionReason: reason ?? null, isOnline: false },
  });

  if (driver.fcmToken) {
    await pushService.sendPush(
      driver.fcmToken,
      'Application Update',
      reason
        ? `Your EyeGo driver application was not approved: ${reason}`
        : 'Your EyeGo driver application was not approved at this time.',
      { type: 'DRIVER_REJECTED' }
    );
  }

  return updated;
}

async function banUser(userId, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');

  // Revoke active refresh-token sessions so the ban takes effect immediately.
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });

  // The reason has nowhere to live on the User model — persist it in the audit
  // log at least, instead of silently dropping what the admin typed.
  logger.info(`[ADMIN] User ${userId} banned. Reason: ${reason || 'none'}`);

  return prisma.user.update({
    where: { id: userId },
    data: { isBanned: true },
  });
}

async function getMetrics() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    activeTrips,
    driversOnline,
    todayPayments,
    totalUsers,
    totalDrivers,
    pendingApprovals,
  ] = await Promise.all([
    prisma.trip.count({ where: { status: { in: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] } } }),
    prisma.driver.count({ where: { isOnline: true } }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', createdAt: { gte: today } },
      _sum: { amountPesewas: true },
    }),
    prisma.user.count(),
    prisma.driver.count(),
    prisma.driver.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);

  const todayRevenuePesewas = todayPayments._sum.amountPesewas ?? 0;
  const env = require('../../config/env');
  const todayCommissionPesewas = percentOf(todayRevenuePesewas, env.PLATFORM_COMMISSION);

  return {
    activeTrips,
    driversOnline,
    todayRevenuePesewas,
    todayCommissionPesewas,
    totalUsers,
    totalDrivers,
    pendingApprovals,
  };
}

async function getActiveTrips() {
  return prisma.trip.findMany({
    where: { status: { in: ['DRIVER_EN_ROUTE', 'IN_PROGRESS'] } },
    include: {
      driver: { select: { id: true, name: true, currentLat: true, currentLng: true, phone: true } },
      route: { select: { originName: true, destinationName: true } },
      _count: { select: { bookings: { where: { status: { notIn: ['CANCELLED'] } } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function setSurgeMultiplier(zoneId, multiplier) {
  const redis = require('../../config/redis');
  // Written as a MANUAL OVERRIDE key that surge.service.getSurgeMultiplier
  // actually reads (it applies max(auto, manual)). The previous `surge:${zoneId}`
  // key matched nothing — the fare path reads `surge:{lat}:{lng}:multiplier`
  // grid keys — so this endpoint was completely inert. Use zoneId 'global'
  // for a platform-wide floor; a `lat:lng` zoneId (2-dp grid) targets one cell.
  if (!Number.isFinite(multiplier)) {
    throw new (require('../../utils/errors').AppError)('multiplier must be a number', 400);
  }
  const key = `surge:manual:${zoneId}`;
  if (multiplier <= 1) {
    await redis.del(key);
    logger.info(`[ADMIN] Surge override cleared for zone ${zoneId}`);
    return { zoneId, multiplier: 1, cleared: true };
  }
  const capped = Math.min(multiplier, 3.0);
  await redis.set(key, capped, 'EX', 3600); // expires after 1 hour
  logger.info(`[ADMIN] Surge override set to ${capped}x for zone ${zoneId} (1h TTL)`);
  return { zoneId, multiplier: capped, expiresInSeconds: 3600 };
}

async function getLiveDrivers() {
  // Get all online drivers with their current locations and active trip info
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true },
    select: {
      id: true, name: true, phone: true, currentLat: true, currentLng: true,
      currentHeading: true, status: true, walletBalancePesewas: true,
      _count: { select: { trips: true } },
      vehicles: { where: { isActive: true }, take: 1, select: { make: true, model: true, plateNumber: true, seaterCount: true, tier: true } },
    },
  });
  // Attach active trip info for each driver
  const now = new Date();
  const driverIds = drivers.map(d => d.id);
  const activeTrips = await prisma.trip.findMany({
    where: {
      driverId: { in: driverIds },
      status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] },
    },
    select: {
      id: true, shortId: true, driverId: true, status: true,
      route: { select: { originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      _count: { select: { bookings: { where: { status: { notIn: ['CANCELLED'] } } } } },
      maxSeats: true, confirmedSeats: true,
    },
  });
  const tripMap = {};
  activeTrips.forEach(t => { tripMap[t.driverId] = t; });
  return drivers.map(d => ({
    id: d.id, name: d.name, phone: d.phone,
    lat: d.currentLat, lng: d.currentLng, heading: d.currentHeading,
    status: d.status, walletBalancePesewas: d.walletBalancePesewas,
    totalTrips: d._count.trips,
    vehicle: d.vehicles[0] || null,
    activeTrip: tripMap[d.id] || null,
    lastUpdated: Date.now(),
  }));
}

async function assignDriverToTrip(tripId, driverId, adminId) {
  const { AppError } = require('../../utils/errors');
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new NotFoundError('Trip');
  if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
    throw new AppError('Trip cannot be reassigned in its current state', 400, 'INVALID_STATUS');
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (!driver.isOnline) throw new AppError('Driver is offline', 400, 'DRIVER_OFFLINE');

  // Atomic check-then-act: only assign if the trip's status hasn't changed since we
  // read it above. Prevents two admins (or a double-tap) racing to assign different
  // drivers to the same trip — the loser gets a clean 409 instead of silently
  // overwriting the winner's assignment.
  //
  // Unlike the old pre-departure-only flow, this does NOT reset status to
  // FILLING — this panel's real use case is a driver going offline MID-trip
  // (DRIVER_EN_ROUTE/ARRIVED_AT_PICKUP/IN_PROGRESS with riders already
  // matched or aboard), where forcing the trip back into "gathering
  // passengers via acceptDispatch" would be wrong. The new driver picks up
  // the trip exactly where it was; only driverId changes.
  const claim = await prisma.trip.updateMany({
    where: { id: tripId, status: trip.status },
    data: { driverId },
  });
  if (claim.count === 0) {
    throw new AppError('Trip was already reassigned by another admin action', 409, 'ASSIGNMENT_CONFLICT');
  }

  const updated = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      route: true,
      driver: { select: { id: true, name: true, phone: true } },
      bookings: {
        where: { status: { notIn: ['CANCELLED'] } },
        include: { user: { select: { name: true } } },
      },
    },
  });

  // Audit log
  logger.info(`[ADMIN] Driver ${driverId} assigned to trip ${tripId} by admin ${adminId}`);

  // Notify the newly-assigned driver — without this they'd have no idea
  // dispatch just handed them a trip mid-route until they happened to check.
  if (driver.fcmToken) {
    pushService.sendPush(
      driver.fcmToken,
      'Trip assigned by dispatch',
      `You've been assigned to a trip${updated?.route?.destinationName ? ` to ${updated.route.destinationName}` : ''}. Open the app to continue.`,
      { type: 'ADMIN_TRIP_ASSIGNED', tripId },
    ).catch(() => {});
  }

  return updated;
}

const DISPATCH_OFFER_WINDOW_MS = 3 * 60 * 1000; // matches the driver app's ~2 min countdown + buffer
const DISPATCH_OFFER_ESCALATE_MS = 15 * 60 * 1000; // flag loudly if still unanswered after this long

/**
 * Trip.driverId is required (a trip always has an owning driver), so an unanswered
 * assignment can't be "unassigned" the way a nullable-driver design could. Instead:
 * re-nudge the driver once with a fresh push, and log loudly for admin follow-up if
 * it's been ignored well past the offer window — so a stuck offer is now visible
 * instead of silently sitting in FILLING forever.
 */
async function expireUnansweredDispatchOffers() {
  const cutoff = new Date(Date.now() - DISPATCH_OFFER_WINDOW_MS);
  const escalateCutoff = new Date(Date.now() - DISPATCH_OFFER_ESCALATE_MS);

  const staleOffers = await prisma.trip.findMany({
    where: { status: 'FILLING', updatedAt: { lt: cutoff } },
    include: { driver: { select: { id: true, name: true, fcmToken: true } }, route: { select: { destinationName: true } } },
    take: 100,
  });

  let actioned = 0;
  for (const trip of staleOffers) {
    const answered = await prisma.dispatchAction.findFirst({
      where: { tripId: trip.id, driverId: trip.driverId },
    });
    if (answered) continue; // driver did respond; FILLING is legitimate (e.g. awaiting more seats)

    // The sweep runs every 60s but nothing it does updates trip.updatedAt, so
    // without this window check the same driver would get re-pushed EVERY
    // minute for the whole 3–15 min stale range (up to 12 duplicate pushes).
    // Only nudge during the single sweep interval right after the offer
    // window lapses; after that, stay silent until the escalation log.
    const nudgeWindowStart = new Date(cutoff.getTime() - 60 * 1000);
    if (trip.updatedAt < escalateCutoff) {
      logger.warn(`[Dispatch expiry] Trip ${trip.id} assigned to driver ${trip.driverId} has been unanswered for 15+ min — needs admin attention`);
    } else if (trip.updatedAt >= nudgeWindowStart && trip.driver?.fcmToken) {
      await pushService.sendPush(
        trip.driver.fcmToken,
        'Trip Still Waiting',
        `You have an unanswered trip assignment to ${trip.route?.destinationName ?? 'a destination'}. Please respond.`,
        { type: 'TRIP_ASSIGNED', tripId: trip.id },
      ).catch(() => {});
    }
    actioned++;
  }

  return actioned;
}

async function getUnassignedTrips() {
  // Every trip's driverId is set at creation (drivers self-create their own
  // trips in the current on-demand model) — a genuinely driverless Trip row
  // never exists, so the old "SCHEDULED/FILLING + driver offline" definition
  // here was almost always empty by construction, leaving this admin panel
  // permanently blank with nothing to act on.
  //
  // Repurposed: "unassigned" now means any non-terminal trip whose assigned
  // driver has gone offline — SCHEDULED/FILLING (offline before departure)
  // through DRIVER_EN_ROUTE/ARRIVED_AT_PICKUP/IN_PROGRESS (offline mid-trip,
  // with riders already matched or aboard) — the actual scenario an admin
  // needs to intervene on and hand off to another online driver.
  return prisma.trip.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      driver: { isOnline: false },
    },
    include: {
      route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      driver: { select: { id: true, name: true, isOnline: true } },
      _count: { select: { bookings: { where: { status: { notIn: ['CANCELLED'] } } } } },
    },
    orderBy: { departureTime: 'asc' },
    take: 50,
  });
}

async function unbanUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');
  logger.info(`[ADMIN] User ${userId} unbanned`);
  return prisma.user.update({ where: { id: userId }, data: { isBanned: false } });
}

async function deletePulseSchedule(id) {
  const sched = await prisma.pulseSchedule.findUnique({ where: { id } });
  if (!sched) throw new NotFoundError('Pulse schedule');
  logger.info(`[ADMIN] Pulse schedule ${id} deleted`);
  return prisma.pulseSchedule.delete({ where: { id } });
}

// SOS events are written by rider SOS, driver SOS, and the passenger socket,
// but were never queryable by admin — the safety console read from nothing.
// SosEvent.userId holds a rider id OR a driver id depending on who triggered
// it, so resolve the reporter against both tables.
async function getSosEvents({ page = 1, limit = 20, unresolvedOnly } = {}) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const where = String(unresolvedOnly) === 'true' ? { resolvedAt: null } : {};
  const [events, total] = await Promise.all([
    prisma.sosEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * l, take: l }),
    prisma.sosEvent.count({ where }),
  ]);

  const reporterIds = [...new Set(events.map((e) => e.userId))];
  const tripIds = [...new Set(events.map((e) => e.tripId))];
  const [users, driversList, trips] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: reporterIds } }, select: { id: true, name: true, phone: true } }),
    prisma.driver.findMany({ where: { id: { in: reporterIds } }, select: { id: true, name: true, phone: true } }),
    prisma.trip.findMany({
      where: { id: { in: tripIds } },
      select: {
        id: true, status: true,
        route: { select: { name: true } },
        driver: { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const driverMap = Object.fromEntries(driversList.map((d) => [d.id, d]));
  const tripMap = Object.fromEntries(trips.map((t) => [t.id, t]));

  return {
    events: events.map((e) => ({
      ...e,
      reporter: userMap[e.userId]
        ? { role: 'RIDER', ...userMap[e.userId] }
        : driverMap[e.userId]
          ? { role: 'DRIVER', ...driverMap[e.userId] }
          : { role: 'UNKNOWN', id: e.userId, name: 'Unknown', phone: '' },
      trip: tripMap[e.tripId] ?? null,
    })),
    total,
    page: p,
    totalPages: Math.ceil(total / l) || 1,
  };
}

// Trip reports could be listed but never closed — status stayed OPEN and
// resolvedAt stayed null forever, so the safety console would fill up with
// permanently-open reports.
async function resolveTripReport(id) {
  const report = await prisma.tripReport.findUnique({ where: { id } });
  if (!report) throw new NotFoundError('Trip report');
  if (report.status === 'RESOLVED') return report; // idempotent
  logger.info(`[ADMIN] Trip report ${id} resolved`);
  return prisma.tripReport.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
}

async function resolveSosEvent(id) {
  const event = await prisma.sosEvent.findUnique({ where: { id } });
  if (!event) throw new NotFoundError('SOS event');
  if (event.resolvedAt) return event; // idempotent
  logger.info(`[ADMIN] SOS event ${id} resolved`);
  return prisma.sosEvent.update({ where: { id }, data: { resolvedAt: new Date() } });
}

// ─────────────────────────────────────────────────────────────────
// ANALYTICS DASHBOARDS
// All functions guard against empty tables (return zeros, never throw).
// ─────────────────────────────────────────────────────────────────

const ACTIVE_TRIP_STATUSES = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

// Build a 14-day (today + previous 13) array of { date: 'YYYY-MM-DD', value }.
function bucketByDay(rows, dateField, valueFn) {
  const buckets = {};
  for (let i = 13; i >= 0; i--) {
    const key = daysAgo(i).toISOString().slice(0, 10);
    buckets[key] = 0;
  }
  for (const r of rows) {
    const dt = r[dateField];
    if (!dt) continue;
    const key = new Date(dt).toISOString().slice(0, 10);
    if (key in buckets) buckets[key] += valueFn(r);
  }
  return Object.entries(buckets).map(([date, value]) => ({ date, value }));
}

async function getAnalyticsOverview() {
  const env = require('../../config/env');
  const commissionRate = env.PLATFORM_COMMISSION;
  const today = startOfToday();
  const weekAgo = daysAgo(7);
  const monthAgo = daysAgo(30);
  const fourteenAgo = daysAgo(13);

  const [
    revenueAll,
    revenueToday,
    revenueWeek,
    revenueMonth,
    successfulPayments14d,
    tripsGrouped,
    trips14d,
    completedCount,
    cancelledCount,
    totalBookings,
    activeTripsNow,
    driversOnlineNow,
    totalDrivers,
    activeDrivers,
    pendingDriverApprovals,
    suspendedDrivers,
    totalRiders,
    newRidersThisWeek,
    fareAgg,
    cashBookings,
    cardBookings,
  ] = await Promise.all([
    // Revenue must be read from Booking.paymentStatus (PAID), not
    // PaymentTransaction.status (SUCCESS) — a CASH booking's PaymentTransaction
    // row is created with status 'PENDING' and NEVER flips to 'SUCCESS' (cash
    // has no gateway callback to do that); only Booking.paymentStatus reflects
    // the real settlement, via boardPassenger/completeTrip. Since this platform
    // is majority cash, the old PaymentTransaction-only query undercounted
    // revenue down to ~0. Matches the pattern already used in getDriverDetail's
    // earningsAgg (Booking.aggregate, not PaymentTransaction).
    prisma.booking.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { fareAmountPesewas: true } }),
    prisma.booking.aggregate({ where: { paymentStatus: 'PAID', createdAt: { gte: today } }, _sum: { fareAmountPesewas: true } }),
    prisma.booking.aggregate({ where: { paymentStatus: 'PAID', createdAt: { gte: weekAgo } }, _sum: { fareAmountPesewas: true } }),
    prisma.booking.aggregate({ where: { paymentStatus: 'PAID', createdAt: { gte: monthAgo } }, _sum: { fareAmountPesewas: true } }),
    prisma.booking.findMany({ where: { paymentStatus: 'PAID', createdAt: { gte: fourteenAgo } }, select: { fareAmountPesewas: true, createdAt: true } }),
    prisma.trip.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.trip.findMany({ where: { createdAt: { gte: fourteenAgo } }, select: { createdAt: true } }),
    prisma.trip.count({ where: { status: 'COMPLETED' } }),
    prisma.trip.count({ where: { status: 'CANCELLED' } }),
    prisma.booking.count(),
    prisma.trip.count({ where: { status: { in: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] } } }),
    prisma.driver.count({ where: { isOnline: true } }),
    prisma.driver.count(),
    prisma.driver.count({ where: { status: 'ACTIVE' } }),
    prisma.driver.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.driver.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.booking.aggregate({ where: { status: { notIn: ['CANCELLED'] } }, _avg: { fareAmountPesewas: true } }),
    prisma.booking.count({ where: { paymentMethod: 'CASH' } }),
    prisma.booking.count({ where: { paymentMethod: 'CARD' } }),
  ]);

  // `round2` is for the genuinely fractional things on this dashboard —
  // percentages, average star ratings, average minutes. Money is integer
  // pesewas and uses `wholePesewas`, because an average fare comes back from
  // the database as a fraction of a pesewa and a fraction of a pesewa is not
  // an amount of money.
  const round2 = (n) => Math.round((n || 0) * 100) / 100;
  const totalRevenuePesewas = wholePesewas(revenueAll._sum.fareAmountPesewas);
  const completedTripsCount = completedCount;
  const cancelledTripsCount = cancelledCount;
  const totalTerminal = completedTripsCount + cancelledTripsCount;

  const tripsByStatus = {};
  for (const g of tripsGrouped) tripsByStatus[g.status] = g._count._all;

  return {
    totalRevenuePesewas,
    todayRevenuePesewas: wholePesewas(revenueToday._sum.fareAmountPesewas),
    weekRevenuePesewas: wholePesewas(revenueWeek._sum.fareAmountPesewas),
    monthRevenuePesewas: wholePesewas(revenueMonth._sum.fareAmountPesewas),
    totalCommissionPesewas: percentOf(totalRevenuePesewas, commissionRate),
    revenueByDay: bucketByDay(successfulPayments14d, 'createdAt', (r) => r.fareAmountPesewas || 0)
      .map((d) => ({ date: d.date, valuePesewas: wholePesewas(d.value) })),
    tripsByStatus,
    tripsByDay: bucketByDay(trips14d, 'createdAt', () => 1),
    completedTripsCount,
    cancelledTripsCount,
    cancellationRate: totalTerminal > 0 ? round2((cancelledTripsCount / totalTerminal) * 100) : 0,
    activeTripsNow,
    driversOnlineNow,
    totalDrivers,
    activeDrivers,
    pendingDriverApprovals,
    suspendedDrivers,
    totalRiders,
    newRidersThisWeek,
    avgFarePesewas: wholePesewas(fareAgg._avg.fareAmountPesewas),
    totalBookings,
    paymentMethodBreakdown: { cash: cashBookings, card: cardBookings },
  };
}

async function getAnalyticsDrivers() {
  const round2 = (n) => Math.round((n || 0) * 100) / 100;

  const [drivers, onlineCount, activeCount, suspendedCount, offlineCount] = await Promise.all([
    prisma.driver.findMany({
      select: {
        id: true, name: true, status: true, isOnline: true,
        _count: { select: { trips: { where: { status: 'COMPLETED' } } } },
        ratings: { select: { stars: true } },
        walletTxs: { where: { type: { in: ['EARNINGS_CREDIT', 'TIP'] } }, select: { amountPesewas: true } },
      },
    }),
    prisma.driver.count({ where: { isOnline: true } }),
    prisma.driver.count({ where: { status: 'ACTIVE' } }),
    prisma.driver.count({ where: { status: 'SUSPENDED' } }),
    prisma.driver.count({ where: { isOnline: false } }),
  ]);

  const enriched = drivers.map((d) => {
    const trips = d._count.trips;
    const earningsPesewas = wholePesewas(d.walletTxs.reduce((s, t) => s + (t.amountPesewas || 0), 0));
    const ratingCount = d.ratings.length;
    const avgRating = ratingCount > 0
      ? round2(d.ratings.reduce((s, r) => s + (r.stars || 0), 0) / ratingCount)
      : null;
    return { id: d.id, name: d.name, status: d.status, isOnline: d.isOnline, trips, earningsPesewas, avgRating, ratingCount };
  });

  const topByTrips = [...enriched].sort((a, b) => b.trips - a.trips).slice(0, 10);
  const topByEarnings = [...enriched].sort((a, b) => b.earningsPesewas - a.earningsPesewas).slice(0, 10);
  const topByRating = [...enriched].filter((d) => d.avgRating !== null)
    .sort((a, b) => b.avgRating - a.avgRating).slice(0, 10);

  return {
    counts: {
      total: drivers.length,
      online: onlineCount,
      offline: offlineCount,
      active: activeCount,
      suspended: suspendedCount,
    },
    topByTrips,
    topByEarnings,
    topByRating,
  };
}

async function getAnalyticsSafety() {
  const round2 = (n) => Math.round((n || 0) * 100) / 100;
  const thirtyAgo = daysAgo(29);

  const [
    totalSos,
    unresolvedSos,
    resolvedSos,
    sos30d,
    totalReports,
    unresolvedReports,
    reportsByType,
  ] = await Promise.all([
    prisma.sosEvent.count(),
    prisma.sosEvent.count({ where: { resolvedAt: null } }),
    prisma.sosEvent.findMany({ where: { resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } }),
    prisma.sosEvent.findMany({ where: { createdAt: { gte: thirtyAgo } }, select: { createdAt: true } }),
    prisma.tripReport.count(),
    prisma.tripReport.count({ where: { status: { not: 'RESOLVED' } } }),
    prisma.tripReport.groupBy({ by: ['type'], _count: { _all: true } }),
  ]);

  const avgResolutionMinutes = resolvedSos.length > 0
    ? round2(resolvedSos.reduce((s, e) => s + (new Date(e.resolvedAt) - new Date(e.createdAt)), 0) / resolvedSos.length / 60000)
    : 0;

  // 30-day-by-day bucket (last 30 days incl today)
  const buckets = {};
  for (let i = 29; i >= 0; i--) buckets[daysAgo(i).toISOString().slice(0, 10)] = 0;
  for (const e of sos30d) {
    const key = new Date(e.createdAt).toISOString().slice(0, 10);
    if (key in buckets) buckets[key] += 1;
  }
  const sosByDay = Object.entries(buckets).map(([date, value]) => ({ date, value }));

  const reportBreakdown = {};
  for (const r of reportsByType) reportBreakdown[r.type || 'UNKNOWN'] = r._count._all;

  return {
    totalSosEvents: totalSos,
    unresolvedSosEvents: unresolvedSos,
    avgResolutionMinutes,
    sosByDay,
    totalTripReports: totalReports,
    unresolvedTripReports: unresolvedReports,
    reportBreakdown,
  };
}

async function getAnalyticsScheduled() {
  const [pending, dispatched, matched, expired, cancelled, upcoming] = await Promise.all([
    prisma.scheduledRideIntent.count({ where: { status: 'PENDING' } }),
    prisma.scheduledRideIntent.count({ where: { status: 'DISPATCHED' } }),
    prisma.scheduledRideIntent.count({ where: { status: 'MATCHED' } }),
    prisma.scheduledRideIntent.count({ where: { status: 'EXPIRED' } }),
    prisma.scheduledRideIntent.count({ where: { status: 'CANCELLED' } }),
    prisma.scheduledRideIntent.findMany({
      where: { status: { in: ['PENDING', 'DISPATCHED'] }, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        route: { select: { originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      },
    }),
  ]);

  return {
    counts: { pending, dispatched, matched, expired, cancelled },
    upcoming: upcoming.map((i) => ({
      id: i.id,
      status: i.status,
      scheduledAt: i.scheduledAt,
      seatCount: i.seatCount,
      rider: i.user ? { id: i.user.id, name: i.user.name, phone: i.user.phone } : null,
      pickup: i.route ? { name: i.route.originName, lat: i.route.originLat, lng: i.route.originLng } : null,
      destination: i.route ? { name: i.route.destinationName, lat: i.route.destLat, lng: i.route.destLng } : null,
    })),
  };
}

// Live driver positions for admin map — trimmed shape (task 5).
async function getLiveDriversMap() {
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true, currentLat: { not: null }, currentLng: { not: null } },
    select: {
      id: true, name: true, currentLat: true, currentLng: true, currentHeading: true, status: true,
      vehicles: { where: { isActive: true }, take: 1, select: { plateNumber: true } },
    },
  });

  const driverIds = drivers.map((d) => d.id);
  const activeTrips = driverIds.length
    ? await prisma.trip.findMany({
        where: { driverId: { in: driverIds }, status: { in: ACTIVE_TRIP_STATUSES } },
        select: { id: true, driverId: true },
      })
    : [];
  const tripByDriver = {};
  for (const t of activeTrips) tripByDriver[t.driverId] = t.id;

  return drivers.map((d) => ({
    id: d.id,
    name: d.name,
    lat: d.currentLat,
    lng: d.currentLng,
    heading: d.currentHeading ?? null,
    status: d.status,
    activeTripId: tripByDriver[d.id] || null,
    vehiclePlate: d.vehicles[0]?.plateNumber || null,
  }));
}

module.exports = {
  approveDriver, suspendDriver, rejectDriver, banUser, unbanUser,
  getMetrics, getActiveTrips, setSurgeMultiplier, expireUnansweredDispatchOffers,
  getRoutes, createRoute, updateRoute, deleteRoute, addVirtualStops,
  getAllPulseSchedules, createPulseSchedule, deletePulseSchedule,
  getAllTrips, getAllBookings, getPendingDrivers, getAllDrivers, getAllUsers,
  getDriverDetail, getDriverTrips,
  getUserDetail, getUserTrips,
  getSupportTickets, getSupportTicketDetail, getTripReports, resolveTripReport, respondToTicket, closeTicket,
  getPromotions, createPromotion, togglePromotion,
  getLiveDrivers, assignDriverToTrip, getUnassignedTrips,
  getSosEvents, resolveSosEvent,
  getAnalyticsOverview, getAnalyticsDrivers, getAnalyticsSafety, getAnalyticsScheduled,
  getLiveDriversMap,
};
