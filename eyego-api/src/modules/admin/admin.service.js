'use strict';

const { formatGhs, percentOf, assertPesewas, wholePesewas } = require('../../utils/money');

const prisma = require('../../config/database');
const pushService = require('../../services/push.service');
const mapboxService = require('../../services/mapbox.service');
const redis = require('../../config/redis');
const { haversineMeters } = require('../../utils/geo');
const { NotFoundError, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
// Admin previously counted seats with `status: { notIn: ['CANCELLED'] }` in ten
// places. BookingStatus has FOUR seat-releasing terminals (CANCELLED, EXPIRED,
// REFUNDED, NO_SHOW), so every one of those counts treated an expired hold, a
// refund and a no-show as a passenger — inflating occupancy on the trip list,
// the driver detail, the live map and, worst, the capacity check inside
// assignDriverToTrip. Use the shared predicate, never an inline list.
const { seatOccupyingWhere } = require('../../utils/booking-status');

/**
 * Trip statuses that still tie up a driver.
 *
 * ARRIVED_AT_PICKUP must be in here. A driver waiting at the pickup point is
 * not free, and omitting it reports them as available — which invites a second
 * dispatch to a vehicle that already has a rider walking up to it.
 */
const DRIVER_OCCUPYING_TRIP_STATUSES = [
  'REQUESTED',
  'MATCHING',
  'REASSIGNING',
  'SCHEDULED',
  'FILLING',
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
];

/** Absorbing states. A trip in one of these needs no admin intervention ever. */
const TERMINAL_TRIP_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'NO_SHOW',
];

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
        // `id` was missing, so the console could show a driver's name on the
        // trip list but had nothing to link to their record with.
        driver: { select: { id: true, name: true, phone: true, walletBalancePesewas: true } },
        vehicle: true,
        bookings: {
          where: seatOccupyingWhere(),
          include: { user: { select: { id: true, name: true, phone: true, walletBalancePesewas: true } } },
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
        user: { select: { id: true, name: true, phone: true, walletBalancePesewas: true } },
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
/**
 * MISSING FUNCTIONALITY, now added: this took only page/limit, so the console
 * could not search for a driver at all. Support taking a call from a driver had
 * no way to find that driver except paging through the whole fleet, which is why
 * the old console asked for limit=500 and hoped.
 *
 * `q` matches name, phone or Ghana Card. `status` filters on the Driver.status
 * enum, and `onlineOnly` narrows to drivers currently connected.
 */
async function getAllDrivers({ page = 1, limit = 20, q, status, onlineOnly } = {}) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 500);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

  const where = {};
  if (q && String(q).trim()) {
    const term = String(q).trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term } },
      { ghanaCardNumber: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = String(status);
  if (onlineOnly === true || onlineOnly === 'true') where.isOnline = true;

  const [data, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: {
        vehicles: true,
        // Completed trips only. Counting every Trip row inflated the figure with
        // cancelled and expired ones, so a driver who had never finished a job
        // could still show a healthy trip count.
        _count: { select: { trips: { where: { status: 'COMPLETED' } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.driver.count({ where }),
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

/**
 * Same missing-search fix as getAllDrivers. Support cannot help a rider they
 * cannot find, and a rider is identified over the phone by their number.
 */
async function getAllUsers({ page = 1, limit = 20, q, bannedOnly } = {}) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 500);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

  const where = {};
  if (q && String(q).trim()) {
    const term = String(q).trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term } },
      { email: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (bannedOnly === true || bannedOnly === 'true') where.isBanned = true;

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        // Seat-occupying bookings only, so a cancelled or expired hold does not
        // count as a ride this rider took.
        _count: { select: { bookings: { where: seatOccupyingWhere() } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count({ where }),
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
    // BUGFIX: this excluded only CANCELLED and PENDING, so REFUNDED, EXPIRED
    // and NO_SHOW bookings were all counted as money this driver earned. A
    // refunded fare is not earnings. Settlement truth on this platform is
    // paymentStatus === 'PAID', which both the cash and the card paths set —
    // the same rule the revenue KPI now uses.
    prisma.booking.aggregate({
      where: { trip: { driverId }, paymentStatus: 'PAID' },
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
          where: seatOccupyingWhere(),
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
        where: seatOccupyingWhere(),
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

/**
 * MISSING ENDPOINT, now added.
 *
 * There was no way to fetch ONE trip. Admin could list trips and could list a
 * driver's or a rider's trips, but every "open this trip" path — from an SOS
 * alert, a trip report, a support ticket or the dispatch board — had nowhere to
 * go. Investigating an incident meant paging the trip list looking for an id.
 *
 * Returns the full picture an investigation needs: the seat map, who is in each
 * seat, the money on each booking, and the append-only TripEvent history, which
 * is the authoritative record of how the trip moved through its lifecycle.
 */
/**
 * WHY DISPATCH IS OR IS NOT WORKING, RIGHT NOW.
 *
 * Every "the rider requested and nothing reached the driver phone" report has so
 * far been answered by someone opening a psql session and a redis-cli and
 * guessing. The information needed is small and it is all here:
 *
 *   - the SUPPLY POOL is Redis (`supply:drivers:geo` + a 90s presence key). A
 *     driver is only dispatchable while they are pinging; `isOnline` in Postgres
 *     is NOT the pool. A driver whose app is open but whose socket has stopped
 *     emitting location falls out of the pool silently, and that difference is
 *     invisible everywhere else in this console.
 *   - eligibility is Postgres, and `explainIneligible` already names the exact
 *     reason per driver (NOT_ACTIVE / OFFLINE / REQUESTS_PAUSED / BUSY).
 *   - a driver with no `fcmToken` can only be reached over an open socket, so a
 *     backgrounded app never sees the offer at all.
 *
 * Read-only: it inspects, it never dispatches.
 */
async function getDispatchHealth() {
  const supply = require('../../services/supply-index.service');
  const { availableDriverWhere, explainIneligible, busyTripFilter } = require('../../services/driver-availability');

  const [poolSize, drivers, awaitingTrips] = await Promise.all([
    supply.poolSize(),
    prisma.driver.findMany({
      select: {
        id: true, name: true, phone: true, status: true, isOnline: true,
        requestsPaused: true, currentLat: true, currentLng: true, fcmToken: true,
        vehicles: { where: { isActive: true }, select: { tier: true, isVerified: true, plateNumber: true } },
        trips: { where: busyTripFilter(), select: { id: true, status: true }, take: 1 },
      },
      orderBy: { name: 'asc' },
    }),
    // Trips dispatch still owes a driver, oldest first — the queue an operator
    // would act on.
    prisma.trip.findMany({
      where: { status: { in: ['REQUESTED', 'MATCHING', 'REASSIGNING'] } },
      select: {
        id: true, shortId: true, status: true, tier: true, createdAt: true,
        pickupLat: true, pickupLng: true, pickupAddress: true,
        events: { where: { type: 'DISPATCH_PROGRESS' }, orderBy: { seq: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
  ]);

  // Who Postgres would allow an offer to go to at all, ignoring geography.
  const eligibleIds = new Set(
    (await prisma.driver.findMany({ where: availableDriverWhere(), select: { id: true } })).map((d) => d.id),
  );

  // The reason each non-eligible driver is out, straight from the rule that
  // excluded them, so this panel cannot drift from the dispatch decision.
  const reasons = Object.fromEntries(
    (await explainIneligible(prisma, drivers.filter((d) => !eligibleIds.has(d.id)).map((d) => d.id)).catch(() => []))
      .map((r) => [r.id, r.reason]),
  );

  // Membership of the Redis pool, per driver. Checked against the driver's own
  // last known position so a driver in the pool is reported as in the pool even
  // if they have since moved.
  const inPool = new Set();
  for (const d of drivers) {
    if (!Number.isFinite(d.currentLat) || !Number.isFinite(d.currentLng)) continue;
    const hit = await supply
      .nearbyDrivers(d.currentLat, d.currentLng, 25, 200)
      .catch(() => []);
    if (hit.some((h) => h.driverId === d.id)) inPool.add(d.id);
  }

  return {
    pool: {
      size: poolSize,
      presenceTtlSeconds: supply.PRESENCE_TTL_SECONDS,
    },
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      status: d.status,
      isOnline: d.isOnline,
      requestsPaused: d.requestsPaused,
      hasGps: Number.isFinite(d.currentLat) && Number.isFinite(d.currentLng),
      inSupplyPool: inPool.has(d.id),
      dispatchable: eligibleIds.has(d.id) && inPool.has(d.id),
      // Not decoration: with no token, an offer only ever arrives on an open
      // socket, so a backgrounded driver app is unreachable.
      canBeWoken: !!d.fcmToken,
      activeTrip: d.trips[0] ?? null,
      vehicle: d.vehicles[0]
        ? { tier: d.vehicles[0].tier, plateNumber: d.vehicles[0].plateNumber, isVerified: d.vehicles[0].isVerified }
        : null,
      // Present only when they are NOT eligible.
      reason: reasons[d.id] ?? null,
    })),
    awaiting: awaitingTrips.map((t) => ({
      id: t.id,
      shortId: t.shortId,
      status: t.status,
      tier: t.tier,
      createdAt: t.createdAt,
      pickupAddress: t.pickupAddress,
      hasPickupCoords: Number.isFinite(t.pickupLat) && Number.isFinite(t.pickupLng),
      // The cascade's own last word on this trip: SEARCHING / OFFERED /
      // WIDENING / WAITING_FOR_SUPPLY, with its counts.
      lastProgress: t.events[0]?.payload ?? null,
    })),
  };
}


/**
 * Runtime platform settings for the console: every knob, its current value, its
 * env default, and who last changed it.
 *
 * The registry in src/config/settings.js is the single source of truth for what
 * exists, what type it is and what bounds it has — this only joins it to the
 * override rows so the page can show provenance.
 */
async function getPlatformSettings() {
  const settings = require('../../config/settings');
  const rows = await prisma.platformSetting.findMany();
  return settings.snapshot(rows);
}

/**
 * Write a batch of settings. Validation and the all-or-nothing transaction live
 * in the settings module; a partially-applied pricing change is a real hazard, so
 * nothing is written unless every field passes.
 *
 * A value of `null` resets that key to its env default.
 */
async function updatePlatformSettings(entries, actor) {
  const settings = require('../../config/settings');
  const result = await settings.set(entries || {}, actor || {});
  if (!result.ok) {
    throw new AppError(
      'Some settings were rejected: ' +
        Object.entries(result.errors).map((e) => e[0] + ' ' + e[1]).join('; '),
      400,
    );
  }
  logger.info('[ADMIN] platform settings updated', { changed: result.changed, reset: result.reset, by: actor?.email });
  const rows = await prisma.platformSetting.findMany();
  return { ...settings.snapshot(rows), changed: result.changed, reset: result.reset };
}

async function getTripDetail(tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      route: true,
      vehicle: true,
      driver: {
        select: {
          id: true, name: true, phone: true, status: true,
          isOnline: true, currentLat: true, currentLng: true,
        },
      },
      requester: { select: { id: true, name: true, phone: true } },
      // ALL bookings here, not just seat-occupying ones: an investigation needs
      // to see the cancelled and refunded rows too. The UI distinguishes them by
      // status rather than the query hiding them.
      bookings: {
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: [{ seatNumber: 'asc' }, { createdAt: 'asc' }],
      },
      events: { orderBy: { seq: 'asc' } },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Occupancy derived from the one predicate, so this can never disagree with
  // the availableSeats the apps are shown.
  const { SEAT_OCCUPYING_STATUSES } = require('../../utils/booking-status');
  const occupied = trip.bookings.filter((b) => SEAT_OCCUPYING_STATUSES.includes(b.status));
  const settled = trip.bookings.filter((b) => b.paymentStatus === 'PAID');

  /**
   * PRICING, DERIVED THE ONE WAY IT IS ALLOWED TO BE DERIVED.
   *
   * `Trip` stores the rates it locked in (baseFarePesewas, perKmRatePesewas,
   * surgeMultiplier) but NOT the resulting per-seat price — that is computed by
   * fare.calculator from the rates, the distance and the seat count. The console
   * used to read a `trip.farePerSeatPesewas` column that has never existed,
   * which is why every trip showed "—" for the seat fare.
   *
   * Re-deriving it here with the STORED rates (never the current env rates) is
   * what makes this number the same one the rider was charged. Distance comes
   * from the Route when there is one, and from the trip's own pickup/dropoff
   * when it was an on-demand ride with no Route row.
   */
  let pricing = null;
  try {
    const { calculateFare, haversineKm } = require('../trips/fare.calculator');
    const distanceKm = Number.isFinite(trip.route?.distanceKm)
      ? trip.route.distanceKm
      : Number.isFinite(trip.pickupLat) && Number.isFinite(trip.dropoffLat)
        ? haversineKm(trip.pickupLat, trip.pickupLng, trip.dropoffLat, trip.dropoffLng)
        : null;

    if (distanceKm != null) {
      const fare = calculateFare({
        tier: trip.tier,
        distanceKm,
        seatCount: trip.maxSeats,
        doorstepPickup: trip.doorstepPickup,
        heavyLoad: trip.heavyLoad,
        surgeMultiplier: trip.surgeMultiplier ?? 1,
        storedBaseFarePesewas: trip.baseFarePesewas,
        storedPerKmRatePesewas: trip.perKmRatePesewas,
      });
      pricing = {
        farePerSeatPesewas: fare.farePerPersonPesewas,
        totalTripCostPesewas: fare.totalTripCostPesewas,
        driverEarningsPerSeatPesewas: fare.driverEarningsPerSeatPesewas,
        commissionPerSeatPesewas: fare.commissionPerSeatPesewas,
        distanceKm: fare.distanceKm,
        // `true` means the platform minimum set the price, not the distance —
        // worth showing, because it explains a short trip costing "too much".
        floorApplied: fare.floorApplied,
        surchargePerSeatPesewas: fare.surchargePerSeatPesewas,
        heavyLoadSurchargePesewas: fare.heavyLoadSurchargePesewas,
        doorstepSurchargePesewas: fare.doorstepSurchargePesewas,
        // Whether the distance is measured road distance or a straight line, so
        // the console never presents an estimate as a measurement.
        distanceSource: Number.isFinite(trip.route?.distanceKm) ? 'ROUTE' : 'STRAIGHT_LINE',
      };
    }
  } catch (err) {
    // A pricing display must never take the investigation page down with it.
    logger.warn(`[admin] trip pricing derivation failed for ${tripId}: ${err.message}`);
  }

  /**
   * GEOMETRY FOR THE MAP. Pickup, dropoff and — where it can be had — the road
   * line between them, so an admin can see the actual route rather than guess
   * from two place names.
   *
   * Cached in Redis for a day and best-effort: a Directions failure or a missing
   * Mapbox token leaves `line` null and the console falls back to drawing the
   * straight line between the two pins, clearly labelled as such.
   */
  const geometry = {
    pickup:
      Number.isFinite(trip.pickupLat) && Number.isFinite(trip.pickupLng)
        ? { lat: trip.pickupLat, lng: trip.pickupLng, address: trip.pickupAddress ?? trip.route?.originName ?? null }
        : trip.route
          ? { lat: trip.route.originLat, lng: trip.route.originLng, address: trip.route.originName }
          : null,
    dropoff:
      Number.isFinite(trip.dropoffLat) && Number.isFinite(trip.dropoffLng)
        ? { lat: trip.dropoffLat, lng: trip.dropoffLng, address: trip.dropoffAddress ?? trip.route?.destinationName ?? null }
        : trip.route
          ? { lat: trip.route.destLat, lng: trip.route.destLng, address: trip.route.destinationName }
          : null,
    driver:
      trip.driver && Number.isFinite(trip.driver.currentLat)
        ? { lat: trip.driver.currentLat, lng: trip.driver.currentLng }
        : null,
    line: null,
    lineSource: 'NONE',
  };

  if (geometry.pickup && geometry.dropoff) {
    const cacheKey = `admin:trip-line:${tripId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        geometry.line = JSON.parse(cached);
        geometry.lineSource = 'DIRECTIONS';
      } else {
        const directions = await mapboxService.getDirections(
          geometry.pickup.lng, geometry.pickup.lat,
          geometry.dropoff.lng, geometry.dropoff.lat,
        );
        if (directions?.geometry) {
          geometry.line = directions.geometry;
          geometry.lineSource = 'DIRECTIONS';
          geometry.roadDistanceKm = directions.distanceKm;
          geometry.roadDurationMin = directions.durationMin;
          await redis.set(cacheKey, JSON.stringify(directions.geometry), 'EX', 86400);
        }
      }
    } catch (err) {
      logger.debug(`[admin] trip line unavailable for ${tripId}: ${err.message}`);
    }
  }

  return {
    ...trip,
    pricing,
    geometry,
    occupancy: {
      maxSeats: trip.maxSeats,
      occupiedSeats: occupied.length,
      availableSeats: Math.max(0, (trip.maxSeats || 0) - occupied.length),
      seatNumbers: occupied.map((b) => b.seatNumber).filter((n) => n !== null),
    },
    money: {
      settledBookings: settled.length,
      // Settlement truth is paymentStatus === 'PAID' — this platform is mostly
      // cash, so counting PaymentTransaction rows would report near zero.
      settledPesewas: settled.reduce((sum, b) => sum + (b.fareAmountPesewas || 0), 0),
      commissionPesewas: settled.reduce((sum, b) => sum + (b.commissionAmountPesewas || 0), 0),
    },
  };
}

async function getUserTrips(userId, { page = 1, limit = 20 }) {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  const skip = (p - 1) * l;
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: { userId, ...seatOccupyingWhere() },
      include: {
        trip: { include: { route: true, driver: { select: { name: true, phone: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: l,
    }),
    prisma.booking.count({ where: { userId, ...seatOccupyingWhere() } }),
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

/**
 * Create a promotion.
 *
 * BUGFIX ("creating a promotion on the admin doesnt work, it says failed to
 * create promo"). Two faults, and a third that made both of them invisible.
 *
 * 1. `maxDiscountPesewas` is an Int column but was read with `parseFloat`. A
 *    cap typed as "10.50" became 10.5, passed every check here, and was then
 *    rejected by Postgres at the INSERT — a 500 from a value the form was
 *    perfectly happy to accept.
 * 2. The field is named in pesewas but every admin form types cedis. Sent
 *    under a cedis name it arrived `undefined`, `parseFloat` returned NaN, and
 *    the request died on "must be positive" for a box the operator had filled
 *    in. Both spellings are now accepted and normalised to integer pesewas —
 *    the canonical money unit everywhere in this codebase.
 * 3. Each failure threw a message naming an internal field, so the panel
 *    showed one flat "failed to create promo" no matter which box was wrong.
 *    Messages now name the box and say what was received.
 */
async function createPromotion(data) {
  const { AppError } = require('../../utils/errors');
  const discountPercent = parseInt(data.discountPercent, 10);

  // Accept either unit; store pesewas. A cedis-named field is multiplied,
  // a pesewas-named one is taken as-is, and both are rounded to an integer
  // because the column is one.
  const rawPesewas =
    data.maxDiscountPesewas != null && data.maxDiscountPesewas !== ''
      ? Number(data.maxDiscountPesewas)
      : data.maxDiscountGhs != null && data.maxDiscountGhs !== ''
        ? Number(data.maxDiscountGhs) * 100
        : data.maxDiscount != null && data.maxDiscount !== ''
          ? Number(data.maxDiscount) * 100
          : NaN;
  const maxDiscountPesewas = Math.round(rawPesewas);

  const expiry = new Date(data.expiry);

  if (!data.code || !String(data.code).trim()) {
    throw new AppError('Promo code is required', 400);
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    throw new AppError(
      `Discount must be a whole number between 1 and 100 (received "${data.discountPercent}")`,
      400,
    );
  }
  if (!Number.isFinite(maxDiscountPesewas) || maxDiscountPesewas <= 0) {
    throw new AppError(
      'Maximum discount is required and must be greater than zero',
      400,
    );
  }
  if (Number.isNaN(expiry.getTime())) {
    throw new AppError(`Expiry is not a valid date (received "${data.expiry}")`, 400);
  }

  // Optional cap on total redemptions. Silently dropped before, so a limit the
  // operator set was never enforced.
  const maxRedemptions =
    data.maxRedemptions != null && data.maxRedemptions !== ''
      ? parseInt(data.maxRedemptions, 10)
      : null;
  if (maxRedemptions != null && (!Number.isFinite(maxRedemptions) || maxRedemptions < 1)) {
    throw new AppError('Redemption limit must be a whole number of 1 or more', 400);
  }

  try {
    return await prisma.promotion.create({
      data: {
        code: String(data.code).trim().toUpperCase(),
        discountPercent,
        maxDiscountPesewas,
        expiry,
        active: data.active !== false,
        ...(maxRedemptions != null ? { maxRedemptions } : {}),
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
    // BUGFIX — this read PaymentTransaction.status === 'SUCCESS'.
    //
    // EyeGo is a cash-majority platform: most fares are settled in the car and
    // never create a PaymentTransaction row at all. Counting transactions
    // therefore reported only the Paystack/MoMo minority, so today's revenue
    // read near zero on a normal trading day and the commission derived from it
    // was wrong by the same factor.
    //
    // Settlement truth is Booking.paymentStatus === 'PAID', which both the cash
    // and the card paths set. Anything reporting money in this console must use
    // that and nothing else.
    prisma.booking.aggregate({
      where: { paymentStatus: 'PAID', updatedAt: { gte: today } },
      _sum: { fareAmountPesewas: true },
    }),
    prisma.user.count(),
    prisma.driver.count(),
    prisma.driver.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);

  const todayRevenuePesewas = todayPayments._sum.fareAmountPesewas ?? 0;
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
    // BUGFIX: this listed only DRIVER_EN_ROUTE and IN_PROGRESS while the
    // activeTrips KPI right above counted ARRIVED_AT_PICKUP as well. The two
    // disagreed, so a driver waiting at the pickup point was counted in the
    // headline number but vanished from the list an operator actually works —
    // the trip disappeared from view at the exact moment it most often needs
    // attention. Both now derive from one constant.
    where: { status: { in: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] } },
    include: {
      driver: { select: { id: true, name: true, currentLat: true, currentLng: true, phone: true } },
      route: { select: { originName: true, destinationName: true } },
      _count: { select: { bookings: { where: seatOccupyingWhere() } } },
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
      // BUGFIX: this list omitted REQUESTED, MATCHING, REASSIGNING, CONFIRMED
      // and DRIVER_ASSIGNED. A driver who had just accepted a trip but not yet
      // started moving carried no active trip on the live map, so the console
      // drew them as free and an operator could assign them a second one —
      // double-dispatching a vehicle that already had a rider waiting.
      status: { in: DRIVER_OCCUPYING_TRIP_STATUSES },
    },
    select: {
      id: true, shortId: true, driverId: true, status: true,
      route: { select: { originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      _count: { select: { bookings: { where: seatOccupyingWhere() } } },
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
  // No `version` bump here on purpose: `recordEvent` below owns it, and every
  // version MUST have exactly one TripEvent with `seq === version` or the
  // clients' "replay everything above lastSeq" leaves a permanent gap.
  const claim = await prisma.trip.updateMany({
    where: { id: tripId, status: trip.status },
    data: { driverId },
  });
  if (claim.count === 0) {
    throw new AppError('Trip was already reassigned by another admin action', 409, 'ASSIGNMENT_CONFLICT');
  }

  /**
   * TELL THE APPS. A reassignment nobody is told about did not happen.
   *
   * The claim above swapped `driverId` with a bare `updateMany` — no version
   * bump, no `TripEvent`, no realtime publish. Both apps are event-driven off
   * `trip:event` and arbitrate on `Trip.version`, so an admin moving a live trip
   * to a new driver produced ZERO state change on either side: the rider kept
   * watching the old driver's puck and phone number, and the new driver's app
   * never learned it owned a trip (the push notification alone cannot populate
   * the trip surface). Worse, with the version unchanged, the next genuine event
   * carried a snapshot whose driver had silently changed under a seq the clients
   * had already seen — so even a later refresh could be discarded as stale.
   *
   * `recordEvent` rather than `applyTransition`: the status deliberately does
   * NOT move here (see the note above), and `applyTransition` requires a
   * from → to edge. This appends an event at the version the swap just produced
   * and fans out the snapshot WITH relations, which is what repaints both apps.
   *
   * Best-effort: the reassignment is already committed and correct. A failed
   * fan-out must not turn a successful swap into a 500 — it degrades to the
   * clients picking the change up on their next refetch.
   */
  try {
    const tripState = require('../../services/trip-state.service');
    await tripState.recordEvent(tripId, 'DRIVER_REASSIGNED', {
      actor: tripState.ACTOR.ADMIN,
      actorId: adminId ?? null,
      payload: { driverId, previousDriverId: trip.driverId ?? null, status: trip.status },
    });
  } catch (err) {
    logger.warn(
      `[admin] driver reassigned on ${tripId} but the trip:event fan-out failed ` +
        `(the swap IS committed): ${err.message}`,
    );
  }

  const updated = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      route: true,
      driver: { select: { id: true, name: true, phone: true } },
      bookings: {
        where: seatOccupyingWhere(),
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
      // BUGFIX: excluding only COMPLETED and CANCELLED left the other three
      // terminals in — NO_DRIVERS_FOUND, EXPIRED and NO_SHOW. Those trips are
      // over and their driver is very often offline, so they accumulated in the
      // "needs intervention" queue permanently, burying the handful of live
      // trips that genuinely needed a hand-off.
      status: { notIn: TERMINAL_TRIP_STATUSES },
      driver: { isOnline: false },
    },
    include: {
      route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      driver: { select: { id: true, name: true, isOnline: true } },
      _count: { select: { bookings: { where: seatOccupyingWhere() } } },
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

// Analytics used its own shorter list, which disagreed with both the KPI count
// and the live map. One definition now, at the top of this file.
const ACTIVE_TRIP_STATUSES = DRIVER_OCCUPYING_TRIP_STATUSES;

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
    prisma.booking.aggregate({ where: seatOccupyingWhere(), _avg: { fareAmountPesewas: true } }),
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
  getDriverDetail, getDriverTrips, getTripDetail,
  getUserDetail, getUserTrips,
  getSupportTickets, getSupportTicketDetail, getTripReports, resolveTripReport, respondToTicket, closeTicket,
  getPromotions, createPromotion, togglePromotion,
  getLiveDrivers, assignDriverToTrip, getUnassignedTrips,
  getSosEvents, resolveSosEvent,
  getAnalyticsOverview, getAnalyticsDrivers, getAnalyticsSafety, getAnalyticsScheduled,
  getLiveDriversMap,
  getDispatchHealth,
  getPlatformSettings,
  updatePlatformSettings,
};
