'use strict';

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
async function getRoutes() {
  const routes = await prisma.route.findMany({
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
        driver: { select: { name: true, phone: true, walletBalance: true } },
        vehicle: true,
        bookings: {
          where: { status: { notIn: ['CANCELLED'] } },
          include: { user: { select: { name: true, phone: true, walletBalance: true } } },
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
        user: { select: { name: true, phone: true, walletBalance: true } },
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
      _sum: { fareAmount: true, commissionAmount: true },
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
      totalRevenue: earningsAgg._sum.fareAmount || 0,
      totalCommission: earningsAgg._sum.commissionAmount || 0,
      netEarnings: (earningsAgg._sum.fareAmount || 0) - (earningsAgg._sum.commissionAmount || 0),
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
  const maxDiscount = parseFloat(data.maxDiscount);
  const expiry = new Date(data.expiry);
  const { AppError } = require('../../utils/errors');
  if (!data.code || !data.code.trim()) throw new AppError('Promo code is required', 400);
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    throw new AppError('discountPercent must be between 1 and 100', 400);
  }
  if (!Number.isFinite(maxDiscount) || maxDiscount <= 0) throw new AppError('maxDiscount must be positive', 400);
  if (Number.isNaN(expiry.getTime())) throw new AppError('Invalid expiry date', 400);
  try {
    return await prisma.promotion.create({
      data: {
        code: data.code.trim().toUpperCase(),
        discountPercent,
        maxDiscount,
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
    prisma.trip.count({ where: { status: { in: ['DRIVER_EN_ROUTE', 'IN_PROGRESS'] } } }),
    prisma.driver.count({ where: { isOnline: true } }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', createdAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.user.count(),
    prisma.driver.count(),
    prisma.driver.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);

  const todayRevenue = todayPayments._sum.amount ?? 0;
  const env = require('../../config/env');
  const todayCommission = Math.round(todayRevenue * env.PLATFORM_COMMISSION * 100) / 100;

  return {
    activeTrips,
    driversOnline,
    todayRevenue,
    todayCommission,
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
      currentHeading: true, status: true, walletBalance: true,
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
      status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] },
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
    status: d.status, walletBalance: d.walletBalance,
    totalTrips: d._count.trips,
    vehicle: d.vehicles[0] || null,
    activeTrip: tripMap[d.id] || null,
    lastUpdated: Date.now(),
  }));
}

async function assignDriverToTrip(tripId, driverId, adminId) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new NotFoundError('Trip');
  if (!['SCHEDULED', 'FILLING'].includes(trip.status)) {
    throw new (require('../../utils/errors').AppError)('Trip cannot be assigned in its current state', 400, 'INVALID_STATUS');
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (!driver.isOnline) throw new (require('../../utils/errors').AppError)('Driver is offline', 400, 'DRIVER_OFFLINE');

  // Atomic check-then-act: only assign if the trip's status hasn't changed since we
  // read it above. Prevents two admins (or a double-tap) racing to assign different
  // drivers to the same trip — the loser gets a clean 409 instead of silently
  // overwriting the winner's assignment.
  const claim = await prisma.trip.updateMany({
    where: { id: tripId, status: trip.status },
    data: {
      driverId,
      status: 'FILLING', // Keep as FILLING so driver accepts via acceptDispatch
    },
  });
  if (claim.count === 0) {
    throw new (require('../../utils/errors').AppError)('Trip was already reassigned by another admin action', 409, 'ASSIGNMENT_CONFLICT');
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
  // Trips that need a driver assigned (driver is offline or needs reassignment)
  return prisma.trip.findMany({
    where: {
      status: { in: ['SCHEDULED', 'FILLING'] },
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

module.exports = {
  approveDriver, suspendDriver, rejectDriver, banUser, unbanUser,
  getMetrics, getActiveTrips, setSurgeMultiplier, expireUnansweredDispatchOffers,
  getRoutes, createRoute, updateRoute, deleteRoute, addVirtualStops,
  getAllPulseSchedules, createPulseSchedule, deletePulseSchedule,
  getAllTrips, getAllBookings, getPendingDrivers, getAllDrivers, getAllUsers,
  getDriverDetail, getDriverTrips,
  getUserDetail, getUserTrips,
  getSupportTickets, getTripReports, resolveTripReport, respondToTicket, closeTicket,
  getPromotions, createPromotion, togglePromotion,
  getLiveDrivers, assignDriverToTrip, getUnassignedTrips,
  getSosEvents, resolveSosEvent,
};
