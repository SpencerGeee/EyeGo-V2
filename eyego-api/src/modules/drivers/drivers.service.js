'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const cloudinaryService = require('../../services/cloudinary.service');
const otpService = require('../../services/otp.service');
const smsService = require('../../services/sms.service');
const pushService = require('../../services/push.service');
const { NotFoundError, AppError, InsufficientWalletError, ForbiddenError } = require('../../utils/errors');
const { isWithinGhana } = require('../../services/mapbox.service');
const { generateTripReceipt, refundBookingForDriverCancellation } = require('../cancellation/cancellation.service');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const { estimateFare, calculateFare, haversineKm } = require('../trips/fare.calculator');
const { availableDriverWhere, isDriverAvailable } = require('../../services/driver-availability');
const { expireStaleTrips, liveUnstartedTripFilter } = require('../../services/stale-trips');
const { toCedis } = require('../../utils/money');

// ─── Trip status machine ─────────────────────────────────────────────────────
// The four driver-driven transitions used to be unguarded `trip.update`s: any
// of them would happily overwrite any status, so a stale client (offline queue
// replay, double-tap, a screen resumed from the background) could walk a trip
// backwards — e.g. push IN_PROGRESS back to DRIVER_EN_ROUTE and re-notify every
// rider that the driver had "started the trip" again.
//
// Note there is no DISPATCHED→CONFIRMED→start hop for on-demand rides: those
// trips are created at DRIVER_EN_ROUTE the moment the driver accepts (see
// trip-request.service.js), so `startTrip` — the app's "Start Trip" button —
// only ever applies to a trip that was genuinely scheduled ahead of time.
const TRIP_TRANSITIONS = Object.freeze({
  DRIVER_EN_ROUTE:   ['SCHEDULED', 'FILLING', 'CONFIRMED'],
  ARRIVED_AT_PICKUP: ['DRIVER_EN_ROUTE'],
  IN_PROGRESS:       ['ARRIVED_AT_PICKUP'],
  COMPLETED:         ['IN_PROGRESS'],
});

/**
 * Assert `trip` may move to `next`. Idempotent: re-issuing the transition a
 * trip is already in is a no-op success (returns false, "nothing to do"), so
 * retried requests don't 409 or fire duplicate push notifications.
 */
function assertTransition(trip, next) {
  if (trip.status === next) return false;
  const allowed = TRIP_TRANSITIONS[next] ?? [];
  if (!allowed.includes(trip.status)) {
    throw new AppError(
      `Cannot move this trip from ${trip.status} to ${next}.`,
      409,
      'INVALID_TRIP_TRANSITION',
    );
  }
  return true;
}

// Attach the same per-person estimate that the rider home screen shows,
// so both apps display consistent pricing for the same trip.
// Uses stored baseFare/perKmRate so pricing reflects the rates set at trip creation.
function attachFarePerSeat(trip) {
  const distanceKm = trip.route?.distanceKm ?? 0;
  // Use the driver-set availableSeats (not confirmedSeats) for consistent per-person pricing.
  const occupancy = Math.min(
    Math.max(trip.availableSeats ?? trip.confirmedSeats ?? trip.maxSeats ?? 4, 4),
    trip.maxSeats ?? 14,
  );
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm,
    seatCount: occupancy,
    doorstepPickup: trip.doorstepPickup ?? false,
    heavyLoad: trip.heavyLoad ?? false,
    surgeMultiplier: trip.surgeMultiplier ?? 1.0,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
  });
  return {
    ...trip,
    farePerSeat: fareInfo.farePerPerson,
    commissionRate: fareInfo.commissionRate,
    driverEarningsPerSeat: fareInfo.driverEarningsPerSeat,
  };
}

async function getMe(driverId) {
  const [driver, totalTrips, ratingAgg] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true, phone: true, name: true, profilePhoto: true, dateOfBirth: true,
        status: true, isOnline: true, walletBalance: true,
        ghanaCardNumber: true, createdAt: true, preferences: true,
        vehicles: { where: { isActive: true } },
      },
    }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: { stars: true } }),
  ]);
  if (!driver) throw new NotFoundError('Driver');
  // updatePreferences() writes navigationApp/theme into the preferences JSON
  // blob, but getMe() never read it back — the client's local cache of these
  // settings was the only copy that ever displayed, so a reinstall silently
  // lost them even though the account had them saved all along.
  const { preferences: preferencesJson, ...driverFields } = driver;
  const preferences = preferencesJson ? JSON.parse(preferencesJson) : {};
  return {
    ...driverFields,
    ...preferences,
    avatarUrl: driver.profilePhoto,
    totalTrips,
    // null when no ratings yet — frontend shows "New" instead of a number
    rating: ratingAgg._avg.stars ?? null,
    ratingCount: ratingAgg._count.stars ?? 0,
    totalEarned: driver.walletBalance,
    isActive: driver.status === 'ACTIVE',
    profileComplete: !!(driver.name && driver.profilePhoto),
  };
}

async function updateProfile(driverId, data) {
  const allowed = {};
  if (data.name) allowed.name = data.name;
  if (data.dateOfBirth) allowed.dateOfBirth = data.dateOfBirth;
  if (data.profilePhoto) allowed.profilePhoto = data.profilePhoto;
  return prisma.driver.update({ where: { id: driverId }, data: allowed });
}

async function updateFcmToken(driverId, fcmToken) {
  return prisma.driver.update({ where: { id: driverId }, data: { fcmToken } });
}

async function completeVerification(driverId, data) {
  const { name, ghanaCardNumber, vehicle } = data;
  return prisma.$transaction(async (tx) => {
    const driver = await tx.driver.update({
      where: { id: driverId },
      data: { name, ghanaCardNumber },
    });

    await tx.vehicle.create({
      data: {
        driverId,
        plateNumber: vehicle.plateNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        seaterCount: vehicle.seaterCount,
        tier: vehicle.tier,
      },
    });

    return driver;
  });
}

async function addVehicle(driverId, data) {
  return prisma.vehicle.create({
    data: { driverId, ...data },
  });
}

async function goOnline(driverId, lat, lng) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (driver.status !== 'ACTIVE') throw new ForbiddenError('Your account must be approved before going online');

  // Clear out trips this driver created but never ran before they start taking
  // dispatch. Without this, one abandoned trip keeps them permanently "busy"
  // in driver-availability's filter and no rider request ever reaches them —
  // going online is exactly the moment that must be true again.
  await expireStaleTrips(prisma, { driverId });

  // Document verification gating — previously goOnline() never checked this despite
  // the app's own copy claiming unverified documents block "full trip access."
  if (env.NODE_ENV !== 'development') {
    const docs = await getDocuments(driverId);
    const required = docs.filter((d) => d.type === 'DRIVERS_LICENSE' || d.type === 'GHANA_CARD');
    const notVerified = required.find((d) => d.status !== 'VERIFIED');
    if (notVerified) {
      throw new AppError(
        `Your ${notVerified.type === 'GHANA_CARD' ? 'Ghana Card' : 'driver\'s license'} must be verified before you can go online.`,
        403,
        'DOCUMENTS_NOT_VERIFIED',
      );
    }
  }

  if (driver.walletBalance < 0) {
    throw new AppError(
      `Account suspended — GHS ${Math.abs(driver.walletBalance).toFixed(2)} outstanding. Top up your wallet to go back online.`,
      402,
      'NEGATIVE_WALLET_BALANCE'
    );
  }

  // Rating & acceptance-rate enforcement — the driver terms screen warns that a
  // pattern of low ratings/declines "may affect your driver level or trigger a
  // review," but nothing previously enforced it. Mirror the document/wallet gates
  // above: block going online (rather than silently suspending) once a driver has
  // enough history to judge fairly.
  if (env.NODE_ENV !== 'development') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [ratingAgg, accepted, declined] = await Promise.all([
      prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: { stars: true } }),
      prisma.dispatchAction.count({ where: { driverId, action: 'ACCEPTED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.dispatchAction.count({ where: { driverId, action: 'DECLINED', createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    if (ratingAgg._count.stars >= 5 && (ratingAgg._avg.stars ?? 5) < 3.5) {
      throw new AppError(
        'Your rating has fallen below the minimum required to accept trips. Contact support to appeal.',
        403,
        'RATING_TOO_LOW',
      );
    }

    const totalDispatches = accepted + declined;
    if (totalDispatches >= 10 && accepted / totalDispatches < 0.3) {
      throw new AppError(
        'Your acceptance rate is too low to go online. Accept more of your dispatched trips to restore access.',
        403,
        'ACCEPTANCE_RATE_TOO_LOW',
      );
    }
  }

  if (lat && lng && !isWithinGhana(lat, lng) && env.NODE_ENV !== 'development') {
    throw new AppError('Location outside of Ghana. Please check your GPS.', 400, 'INVALID_LOCATION');
  }

  const [updated] = await prisma.$transaction([
    prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: true, currentLat: lat, currentLng: lng },
    }),
    // Start an online session for real hour tracking
    prisma.onlineSession.create({
      data: { driverId, startTime: new Date() },
    }),
  ]);

  // Publish location to Redis
  if (lat && lng) {
    await redis.set(`driver:${driverId}:location`, JSON.stringify({ lat, lng, heading: 0, speed: 0 }), 'EX', 3600);
  }

  return updated;
}

async function goOffline(driverId) {
  const [updated] = await prisma.$transaction([
    prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: false },
    }),
    // Close the most recent active online session
    prisma.onlineSession.updateMany({
      where: { driverId, endTime: null },
      data: { endTime: new Date() },
    }),
  ]);
  await redis.del(`driver:${driverId}:location`);
  return updated;
}

async function getActiveTrip(driverId) {
  // BUGFIX (phantom "Resume Trip" on a fresh install): this matched SCHEDULED
  // and FILLING with no time bound at all, so a trip the driver created and
  // abandoned days ago was still offered as resumable — including after the
  // app was deleted and sideloaded again, which is how it was reported. Sweep
  // those to EXPIRED first, then only accept an unstarted trip whose departure
  // is still within the grace window. Trips actually under way
  // (CONFIRMED → IN_PROGRESS) are unaffected: they stay resumable forever,
  // which is the whole point of the banner.
  await expireStaleTrips(prisma, { driverId });

  const trip = await prisma.trip.findFirst({
    where: {
      driverId,
      OR: [
        { status: { in: ['CONFIRMED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] } },
        liveUnstartedTripFilter(),
      ],
    },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      bookings: {
        where: { status: { notIn: ['CANCELLED'] } },
        include: { user: { select: { name: true, phone: true, profilePhoto: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return trip ? attachFarePerSeat(trip) : null;
}

async function getAllTrips(driverId) {
  const trips = await prisma.trip.findMany({
    where: { driverId },
    include: {
      route: true,
      vehicle: true,
      bookings: {
        where: { status: { notIn: ['CANCELLED'] } },
        select: { id: true, seatNumber: true, fareAmount: true, commissionAmount: true, paymentStatus: true, status: true, isOffline: true },
      },
    },
    orderBy: { departureTime: 'asc' },
  });
  // Compute farePerSeat using the same estimateFare formula the rider home screen uses
  return trips.map(attachFarePerSeat);
}

async function devActivate(driverId) {
  // Guard: dev-only endpoint
  if (env.NODE_ENV !== 'development') {
    throw new ForbiddenError('This endpoint is only available in development');
  }

  const minBalance = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE ?? 20;
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, walletBalance: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const currentBalance = driver.walletBalance ?? 0;
  const topUp = currentBalance < minBalance ? minBalance - currentBalance : 0;

  // Atomically update status + wallet, and record the transaction
  return prisma.$transaction(async (tx) => {
    const updated = await tx.driver.update({
      where: { id: driverId },
      data: {
        status: 'ACTIVE',
        ...(topUp > 0 && { walletBalance: { increment: topUp } }),
      },
    });

    if (topUp > 0) {
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'TOP_UP',
          amount: topUp,
          description: 'Dev-activate wallet top-up',
          balanceBefore: currentBalance,
          balanceAfter: currentBalance + topUp,
        },
      });
    }

    return updated;
  });
}
async function getTripHistory(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
      include: { route: true, bookings: { select: { id: true, fareAmount: true, paymentStatus: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } } }),
  ]);
  return { trips, total, page, totalPages: Math.ceil(total / limit) };
}

async function arriveAtPickup(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (!assertTransition(trip, 'ARRIVED_AT_PICKUP')) return trip;
  const updated = await prisma.trip.update({ where: { id: tripId }, data: { status: 'ARRIVED_AT_PICKUP' } });

  setImmediate(async () => {
    try {
      const [driver, bookings] = await Promise.all([
        prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } }),
        prisma.booking.findMany({
          where: { tripId, status: { notIn: ['CANCELLED'] } },
          include: { user: { select: { fcmToken: true } } },
        }),
      ]);
      const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
      if (tokens.length) {
        await pushService.sendMulticastPush(
          tokens,
          'Driver has arrived',
          `${driver?.name ?? 'Your driver'} has arrived at the pickup point`,
          { type: 'ARRIVED_AT_PICKUP', tripId },
        );
      }
    } catch (err) {
      logger.debug('[driversService] arriveAtPickup push failed (non-blocking):', err?.message ?? err);
    }
  });

  return updated;
}

async function getTripById(driverId, tripId) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      bookings: {
        where: { status: { notIn: ['CANCELLED'] } },
        include: { user: { select: { name: true, phone: true, profilePhoto: true } } },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');
  return attachFarePerSeat(trip);
}

// Statuses from which a dispatched trip may still be accepted by its driver.
// Once a trip leaves this set (cancelled, completed, already in progress, or
// already confirmed) the dispatch is stale and must be rejected.
const ACCEPTABLE_DISPATCH_STATUSES = ['SCHEDULED', 'FILLING'];

async function acceptDispatch(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');

  // Atomic, guarded transition: only confirm if the trip is still in an
  // acceptable pre-dispatch state. The conditional updateMany makes concurrent
  // accepts race-safe — the first writer wins and any later/expired accept sees
  // count === 0 and is rejected with 409 (the client handles 409/410 by
  // navigating away with a "dispatch unavailable" message). The ACCEPTED action
  // is only recorded when the claim actually succeeds.
  return prisma.$transaction(async (tx) => {
    const updateResult = await tx.trip.updateMany({
      where: { id: tripId, driverId, status: { in: ACCEPTABLE_DISPATCH_STATUSES } },
      data: { status: 'CONFIRMED' },
    });

    if (updateResult.count === 0) {
      throw new AppError(
        'This dispatch has expired or already been claimed.',
        409,
        'DISPATCH_UNAVAILABLE'
      );
    }

    await tx.dispatchAction.create({
      data: { driverId, tripId, action: 'ACCEPTED' },
    });

    return tx.trip.findUnique({ where: { id: tripId } });
  });
}

async function declineDispatch(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  // Unassign driver from the trip so it can be re-dispatched
  const [updated] = await prisma.$transaction([
    prisma.trip.update({
      where: { id: tripId },
      data: { status: 'CANCELLED' },
    }),
    prisma.dispatchAction.create({
      data: { driverId, tripId, action: 'DECLINED' },
    }),
  ]);
  return updated;
}

async function uploadDocument(driverId, file, type) {
  if (!file || !file.buffer) throw new AppError('No file provided', 400);
  if (!type) throw new AppError('Document type is required', 400);

  const result = await cloudinaryService.uploadBuffer(file.buffer, {
    folder: `eyego/drivers/${driverId}/documents`,
    resource_type: 'image',
    public_id: `${type.toLowerCase()}_${Date.now()}`,
  });
  const url = result.secure_url;

  const fieldMap = {
    DRIVERS_LICENSE: 'licensePhoto',
    PROFILE_PHOTO: 'profilePhoto',
    GHANA_CARD: 'ghanaCardPhoto',
  };

  const field = fieldMap[type];
  if (field) {
    // New/re-uploaded documents go to PENDING review, not straight to VERIFIED —
    // previously any photo present flipped status to VERIFIED with zero human review.
    const current = await prisma.driver.findUnique({ where: { id: driverId }, select: { documentReview: true } });
    let review = {};
    try { review = current?.documentReview ? JSON.parse(current.documentReview) : {}; } catch { /* reset on malformed data */ }
    review[type] = { status: 'PENDING', reviewedAt: null, rejectionReason: null };

    await prisma.driver.update({
      where: { id: driverId },
      data: { [field]: url, documentReview: JSON.stringify(review) },
    });
  }

  return { url, type, status: 'PENDING' };
}

async function startTrip(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (!assertTransition(trip, 'DRIVER_EN_ROUTE')) return trip;
  const updated = await prisma.trip.update({ where: { id: tripId }, data: { status: 'DRIVER_EN_ROUTE' } });

  // Push notifications — non-blocking
  setImmediate(async () => {
    try {
      const [driver, bookings] = await Promise.all([
        prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } }),
        prisma.booking.findMany({
          where: { tripId, status: 'CONFIRMED', paymentStatus: 'PAID' },
          include: { user: { select: { fcmToken: true } } },
        }),
      ]);
      const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
      if (tokens.length) {
        await pushService.sendMulticastPush(
          tokens,
          'Driver is on the way',
          `${driver?.name ?? 'Your driver'} has started the trip`,
          { type: 'DRIVER_EN_ROUTE', tripId },
        );
      }
    } catch (_) {}
  });

  return updated;
}

async function departTrip(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (!assertTransition(trip, 'IN_PROGRESS')) return trip;
  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'IN_PROGRESS', departedAt: new Date() },
  });

  // Push notifications — non-blocking
  setImmediate(async () => {
    try {
      const bookings = await prisma.booking.findMany({
        where: { tripId, status: 'CONFIRMED', paymentStatus: 'PAID' },
        include: { user: { select: { fcmToken: true } } },
      });
      const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
      if (tokens.length) {
        await pushService.sendMulticastPush(
          tokens,
          'Trip in progress',
          'Your EyeGo has departed. Enjoy the ride!',
          { type: 'IN_PROGRESS', tripId },
        );
      }
    } catch (_) {}
  });

  return updated;
}

async function arriveTrip(driverId, tripId) {
  const result = await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, driverId },
      include: {
        // Include both PAID (MoMo/card) and PENDING (cash) bookings — drivers collect cash in person
        bookings: { where: { status: { notIn: ['CANCELLED'] }, paymentStatus: { in: ['PAID', 'PENDING'] } } },
      },
    });
    if (!trip) throw new NotFoundError('Trip');

    // Idempotency guard: if already completed (e.g. mutation retry, or the
    // socket `driver:arrived` path already ran), bail before crediting again.
    // Without this, the active-screen `retry: 1` mutation could double-credit
    // the driver's wallet.
    if (trip.status === 'COMPLETED') {
      return { trip, totalEarnings: 0, alreadyCompleted: true };
    }
    // A trip can only be completed from IN_PROGRESS — nothing may jump the
    // queue from e.g. ARRIVED_AT_PICKUP and settle fares for a ride that never
    // departed. (The COMPLETED short-circuit above keeps retries idempotent,
    // so this only ever rejects genuinely out-of-order calls.)
    assertTransition(trip, 'COMPLETED');

    // Close trip
    await tx.trip.update({
      where: { id: tripId },
      data: { status: 'COMPLETED', arrivedAt: new Date() },
    });

    // ── Auto-settle any still-unpaid CASH bookings ───────────────────────
    // Mirrors the same fix in trips.service.js completeTrip — "Mark Boarded"
    // is a manual per-seat driver action that's easy to skip, which would
    // otherwise leave a cash booking's paymentStatus stuck at PENDING
    // forever even though the trip is over and the rider paid in person.
    const unsettledCash = await tx.booking.findMany({
      where: {
        tripId,
        paymentMethod: 'CASH',
        paymentStatus: { not: 'PAID' },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { id: true, commissionAmount: true },
    });
    if (unsettledCash.length > 0) {
      const totalCommissionOwed = unsettledCash.reduce((sum, b) => sum + (b.commissionAmount || 0), 0);
      await tx.booking.updateMany({
        where: { id: { in: unsettledCash.map((b) => b.id) } },
        data: { paymentStatus: 'PAID' },
      });
      if (totalCommissionOwed > 0) {
        const driverBeforeSettle = await tx.driver.findUnique({ where: { id: driverId }, select: { walletBalance: true } });
        await tx.driver.update({
          where: { id: driverId },
          data: { walletBalance: { decrement: totalCommissionOwed } },
        });
        await tx.walletTransaction.create({
          data: {
            driverId,
            type: 'COMMISSION_DEDUCTION',
            amount: totalCommissionOwed,
            description: `Cash commission auto-settled on arrival — ${unsettledCash.length} seat(s) not marked boarded`,
            balanceBefore: driverBeforeSettle?.walletBalance ?? 0,
            balanceAfter: (driverBeforeSettle?.walletBalance ?? 0) - totalCommissionOwed,
            tripId,
          },
        });
      }
    }

    // Complete ALL active bookings (CONFIRMED, SEAT_HELD, PAID, BOARDED)
    // This ensures cash riders (SEAT_HELD) also show up in the rider's past trips
    await tx.booking.updateMany({
      where: { tripId, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } },
      data: { status: 'COMPLETED' },
    });

    // Credit driver earnings — ONLY for online-paid bookings (MoMo/card/wallet).
    // Cash bookings (paymentStatus PENDING, paid in hand) already had commission
    // debited at boarding and the driver keeps the cash directly, so crediting the
    // wallet too would double-pay. Match completeTrip's PAID-only filter.
    const ONLINE_METHODS = ['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO', 'CARD', 'WALLET'];
    const onlinePaidBookings = trip.bookings.filter(
      (b) => b.paymentStatus === 'PAID' && ONLINE_METHODS.includes(b.paymentMethod),
    );
    const totalEarnings = onlinePaidBookings.reduce((sum, b) => sum + toCedis(b.fareAmount * (1 - env.PLATFORM_COMMISSION)), 0);
    const safeEarnings = toCedis(totalEarnings);
    if (safeEarnings > 0) {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { increment: safeEarnings } },
      });
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'EARNINGS_CREDIT',
          amount: safeEarnings,
          description: `Earnings from Trip #${trip.shortId}`,
          balanceBefore: driver.walletBalance,
          balanceAfter: toCedis(driver.walletBalance + safeEarnings),
          tripId,
        },
      });
    }

    // ── Quest progress ── increment RIDES_COUNT and EARNINGS so the driver's
    // Quests tab actually advances after a completed ride. This was previously
    // ONLY done in trips.service.completeTrip(), which the active-screen flow
    // never reached because this REST path completes the trip first and the
    // socket completeTrip then bailed on the idempotency guard.
    const { incrementProgress } = require('../quests/quests.service');
    await incrementProgress(driverId, 'RIDES_COUNT', 1, tx);
    if (safeEarnings > 0) {
      await incrementProgress(driverId, 'EARNINGS', safeEarnings, tx);
    }

    return { trip, totalEarnings: safeEarnings };
  });

  // Generate receipts for PAID bookings — non-blocking, runs after transaction commits
  setImmediate(async () => {
    const paidBookings = result.trip.bookings.filter(b => b.paymentStatus === 'PAID');
    await Promise.all(paidBookings.map(b => generateTripReceipt(b.id).catch(() => {})));
  });

  // Push notifications — non-blocking (result is { trip, totalEarnings })
  setImmediate(async () => {
    try {
      const completedTrip = result.trip;
      const bookings = await prisma.booking.findMany({
        where: { tripId, status: 'COMPLETED' },
        include: { user: { select: { fcmToken: true, notificationPrefs: true } } },
      });
      const originName = completedTrip.route?.originName ?? 'your stop';
      await Promise.all(
        bookings.map(b => {
          if (!b.user?.fcmToken) return null;
          return pushService.notifications.driverArrived(b.user.fcmToken, originName, b.user.notificationPrefs, tripId, b.id);
        }),
      );
    } catch (_) {}
  });

  return result;
}

async function addOfflinePassenger(driverId, tripId, { phone, seatNumber }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: { route: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Calculate correct per-seat fare
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm: trip.route?.distanceKm ?? 0,
    seatCount: trip.maxSeats,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
  });
  const seatFare = fareInfo.farePerPerson;
  const commissionAmount = seatFare * env.PLATFORM_COMMISSION;

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalance < commissionAmount) throw new InsufficientWalletError();

  // Atomically check seat contention + create booking inside a transaction
  // to prevent overbooking when two drivers add offline passengers concurrently
  const existing = await prisma.booking.findFirst({
    where: { tripId, seatNumber, status: { notIn: ['CANCELLED'] } },
  });
  if (existing) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

  const otp = otpService.generateOfflineOtp();
  const otpExp = otpService.offlineOtpExpiry();

  const booking = await prisma.$transaction(async (tx) => {
    // Re-check seat inside the tx to catch concurrent creates
    const conflict = await tx.booking.findFirst({
      where: { tripId, seatNumber, status: { notIn: ['CANCELLED'] } },
    });
    if (conflict) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

    return tx.booking.create({
      data: {
        tripId,
        seatNumber,
        fareAmount: seatFare, // correct per-seat fare
        commissionAmount,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        isOffline: true,
        offlinePhone: phone,
        offlineOtp: otp,
        offlineOtpExp: otpExp,
        status: 'SEAT_HELD',
      },
    });
  });

  // Send SMS
  await smsService.sendOfflinePassengerOtp(
    phone,
    trip.shortId.slice(0, 8).toUpperCase(),
    'your destination',
    seatNumber,
    seatFare,
    otp
  );

  if (process.env.NODE_ENV === 'development') {
    return { booking, _dev_otp: otp };
  }
  return { booking };
}

async function addCashNoPhone(driverId, tripId, { seatNumber }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: { route: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Calculate correct per-seat fare using the same formula riders see
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm: trip.route?.distanceKm ?? 0,
    seatCount: trip.maxSeats,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
  });
  const seatFare = fareInfo.farePerPerson;
  const commissionAmount = seatFare * env.PLATFORM_COMMISSION;

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalance < commissionAmount) throw new InsufficientWalletError();

  // Deduct commission immediately — seat check + booking creation inside the tx
  // to prevent concurrent overbooking from two driver taps. BUGFIX: the balance
  // check above happens BEFORE this transaction, so two concurrent cash-boarding
  // requests could both pass it and both decrement, pushing the wallet negative.
  // updateMany + gte re-checks the balance atomically at decrement time, same
  // pattern as wallet.service.js's withdraw().
  await prisma.$transaction(async (tx) => {
    const conflict = await tx.booking.findFirst({
      where: { tripId, seatNumber, status: { notIn: ['CANCELLED'] } },
    });
    if (conflict) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

    const debited = await tx.driver.updateMany({
      where: { id: driverId, walletBalance: { gte: commissionAmount } },
      data: { walletBalance: { decrement: commissionAmount } },
    });
    if (debited.count === 0) throw new InsufficientWalletError();

    await tx.booking.create({
      data: {
        tripId, seatNumber,
        fareAmount: seatFare, // correct per-seat fare, not raw base fare
        commissionAmount,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        isOffline: true,
        offlineOtpVerified: true,
        status: 'BOARDED',
      },
    });

    await tx.walletTransaction.create({
      data: {
        driverId, type: 'COMMISSION_DEDUCTION',
        amount: commissionAmount,
        description: `Cash passenger commission — Seat ${seatNumber} Trip #${trip.shortId}`,
        balanceBefore: driver.walletBalance,
        balanceAfter: driver.walletBalance - commissionAmount,
        tripId,
      },
    });

    await tx.trip.update({ where: { id: tripId }, data: { confirmedSeats: { increment: 1 } } });
  });
}

async function verifyOfflineOtp(driverId, tripId, { bookingId, otp }) {
  // BUGFIX: this used `include: { trip: { where: { driverId } } }`. Prisma only
  // accepts `where` inside an include for to-MANY relations — `Booking.trip` is
  // to-one, so the client rejected the query with a PrismaClientValidationError
  // before it ever reached the database. Every "Phone + OTP" verification the
  // driver attempted returned a 500, which is why the flow never worked.
  // Verified against the generated client on 2026-07-28. The ownership check
  // belongs in the top-level `where` as a relation filter anyway.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId, trip: { driverId } },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.offlineOtp || booking.offlineOtp !== otp) {
    throw new AppError('Invalid OTP', 400, 'OTP_INVALID');
  }
  if (booking.offlineOtpExp < new Date()) throw new AppError('OTP expired', 400, 'OTP_EXPIRED');

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalance < booking.commissionAmount) throw new InsufficientWalletError();

  // BUGFIX: same TOCTOU race as addCashNoPhone above — decrement via
  // updateMany + gte so a concurrent double-tap can't both pass a pre-tx
  // balance check and push the wallet negative.
  return prisma.$transaction(async (tx) => {
    const debited = await tx.driver.updateMany({
      where: { id: driverId, walletBalance: { gte: booking.commissionAmount } },
      data: { walletBalance: { decrement: booking.commissionAmount } },
    });
    if (debited.count === 0) throw new InsufficientWalletError();

    await tx.booking.update({
      where: { id: bookingId },
      data: { offlineOtpVerified: true, status: 'BOARDED', paymentStatus: 'PAID' },
    });

    await tx.walletTransaction.create({
      data: {
        driverId, type: 'COMMISSION_DEDUCTION',
        amount: booking.commissionAmount,
        description: `Offline passenger commission — Seat ${booking.seatNumber}`,
        balanceBefore: driver.walletBalance,
        balanceAfter: driver.walletBalance - booking.commissionAmount,
        tripId,
      },
    });

    await tx.trip.update({ where: { id: tripId }, data: { confirmedSeats: { increment: 1 } } });
  });
}

async function boardPassenger(driverId, tripId, bookingId) {
  // Same invalid `include: { trip: { where } }` as verifyOfflineOtp above —
  // Prisma rejected it outright, so boarding any passenger 500'd. See the note
  // there; ownership is expressed as a relation filter instead.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId, trip: { driverId } },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');

  // In-app riders who chose CASH never trigger a payment webhook, so unlike
  // card/MoMo bookings their commission is never deducted at confirmPayment
  // time. Deduct it here at boarding — mirrors addCashNoPhone/verifyOfflineOtp,
  // which do the same for driver-added offline passengers. Without this the
  // driver's wallet never moves for a cash trip (no debit at boarding, no
  // credit at completion since completeTrip intentionally skips cash bookings
  // to avoid double-paying commission already collected here).
  if (booking.paymentMethod === 'CASH' && booking.paymentStatus !== 'PAID') {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (driver.walletBalance < booking.commissionAmount) throw new InsufficientWalletError();

    return prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'BOARDED', paymentStatus: 'PAID' },
      });

      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { decrement: booking.commissionAmount } },
      });

      await tx.walletTransaction.create({
        data: {
          driverId, type: 'COMMISSION_DEDUCTION',
          amount: booking.commissionAmount,
          description: `Cash passenger commission — Seat ${booking.seatNumber}`,
          balanceBefore: driver.walletBalance,
          balanceAfter: driver.walletBalance - booking.commissionAmount,
          tripId,
        },
      });

      return updated;
    });
  }

  return prisma.booking.update({ where: { id: bookingId }, data: { status: 'BOARDED' } });
}

// Statuses where riders are matched/waiting but nobody has boarded yet — a
// driver bailing here should hand the trip to another driver, not strand the
// riders back at square one with a cancellation+refund. Once IN_PROGRESS
// (someone's actually in the vehicle) a straight cancel is the right call —
// redispatching mid-ride doesn't make sense.
const REDISPATCHABLE_STATUSES = ['CONFIRMED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP'];

async function cancelTrip(driverId, tripId, { reason, note } = {}) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
    throw new AppError('Trip cannot be cancelled in its current state', 400, 'INVALID_STATUS');
  }

  if (REDISPATCHABLE_STATUSES.includes(trip.status)) {
    const activeBookingCount = await prisma.booking.count({
      where: { tripId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
    });
    if (activeBookingCount > 0) {
      return redispatchTrip(driverId, trip, { reason, note });
    }
  }

  const updatedTrip = await prisma.$transaction(async (tx) => {
    const bookingsToCancel = await tx.booking.findMany({
      where: { tripId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
    });

    for (const booking of bookingsToCancel) {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          seatNumber: null,
          cancelledAt: new Date(),
          cancellationReason: reason || 'DRIVER_CANCELLED',
        },
      });
      // Rider isn't at fault when the driver cancels — always a full refund, no fee.
      if (booking.paymentStatus === 'PAID') {
        await refundBookingForDriverCancellation(
          tx,
          booking,
          reason ? `Driver cancelled trip: ${reason}` : 'Driver cancelled trip',
        );
      }
    }

    return tx.trip.update({
      where: { id: tripId },
      data: { status: 'CANCELLED' },
      include: { route: true },
    });
  });

  logger.info('Driver cancelled trip', { driverId, tripId, reason, note });

  return updatedTrip;
}

const REDISPATCH_RADIUS_KM = 8;
const MAX_REDISPATCH_DRIVERS_TO_NOTIFY = 12;

// Driver bailed on a trip riders are already matched/waiting on
// (REDISPATCHABLE_STATUSES). Instead of cancelling+refunding, keep the
// bookings intact, put the trip up for grabs to nearby online drivers, and
// let the first one to claim it take over exactly where it was.
async function redispatchTrip(cancellingDriverId, trip, { reason, note } = {}) {
  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: 'REASSIGNING' },
    include: { route: true, bookings: { where: { status: { notIn: ['CANCELLED'] } }, include: { user: { select: { fcmToken: true } } } } },
  });

  await prisma.dispatchAction.create({
    data: { driverId: cancellingDriverId, tripId: trip.id, action: 'DECLINED' },
  }).catch(() => {});

  logger.info('Driver cancelled trip pre-boarding — redispatching', { cancellingDriverId, tripId: trip.id, reason, note });

  // Tell the matched riders their driver changed (not that the trip died) —
  // fire-and-forget, must not fail the cancel response.
  setImmediate(async () => {
    for (const b of updated.bookings) {
      if (b.user?.fcmToken) {
        pushService.sendPush(
          b.user.fcmToken,
          'Finding you a new driver',
          'Your driver had to cancel — we\'re matching you with another driver nearby.',
          { type: 'TRIP_REASSIGNING', tripId: trip.id },
        ).catch(() => {});
      }
    }

    // Broadcast to nearby online drivers (excluding the one who just bailed),
    // reusing the same geo-radius eligibility as the initial dispatch.
    try {
      let nearbyDriverIds = [];
      if (trip.pickupLat != null && trip.pickupLng != null) {
        try {
          nearbyDriverIds = await redis.geosearch(
            'drivers:online',
            'FROMLONLAT', trip.pickupLng, trip.pickupLat,
            'BYRADIUS', REDISPATCH_RADIUS_KM, 'km',
            'ASC', 'COUNT', 30,
          );
        } catch (_) {
          nearbyDriverIds = await redis.georadius(
            'drivers:online',
            trip.pickupLng, trip.pickupLat,
            REDISPATCH_RADIUS_KM, 'km',
            'ASC', 'COUNT', 30,
          ).catch(() => []);
        }
      }
      nearbyDriverIds = nearbyDriverIds.filter((id) => id !== cancellingDriverId);

      // Shared availability rule — see services/driver-availability.js. This
      // used to exclude only IN_PROGRESS/DRIVER_EN_ROUTE, so a driver already
      // committed to another trip was still offered the reassignment.
      const eligibleDrivers = await prisma.driver.findMany({
        where: availableDriverWhere({
          ids: nearbyDriverIds.length > 0 ? nearbyDriverIds : null,
          excludeId: cancellingDriverId,
        }),
        select: { id: true, fcmToken: true },
        take: MAX_REDISPATCH_DRIVERS_TO_NOTIFY,
      });

      const fcmTokens = eligibleDrivers.map((d) => d.fcmToken).filter(Boolean);
      if (fcmTokens.length > 0) {
        await pushService.sendMulticastPush(
          fcmTokens,
          'Trip needs a driver',
          `A trip to ${updated.route?.destinationName ?? 'a nearby destination'} needs a new driver.`,
          { type: 'TRIP_REASSIGNMENT_AVAILABLE', tripId: trip.id },
        ).catch(() => {});
      }

      const io = require('../../app').get('io');
      if (io) {
        const payload = {
          tripId: trip.id,
          kind: 'REASSIGNMENT',
          routeOrigin: 'Pickup nearby',
          routeDestination: updated.route?.destinationName ?? trip.route?.destinationName,
          departureTime: trip.departureTime,
          seatCount: updated.bookings.length,
        };
        for (const d of eligibleDrivers) {
          io.of('/driver').to(`driver:${d.id}`).emit('trip:assigned', payload);
        }
      }
    } catch (err) {
      logger.error('Failed to broadcast trip redispatch', { tripId: trip.id, err: err?.message });
    }
  });

  return updated;
}

// A nearby driver claims a trip that's up for redispatch (see
// redispatchTrip above). Atomic first-claim-wins, same pattern as
// acceptDispatch — resumes the trip exactly where it left off
// (DRIVER_EN_ROUTE) under the new driver.
async function claimReassignedTrip(driverId, tripId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (!driver.isOnline) throw new AppError('You must be online to accept trips', 400, 'DRIVER_OFFLINE');

  // Server-side backstop for the busy-driver rule. Even if a stale dispatch
  // card is still on screen from before the driver took another trip, they
  // cannot claim a second one.
  if (!(await isDriverAvailable(prisma, driverId))) {
    throw new AppError('Finish your current trip before accepting another.', 409, 'DRIVER_BUSY');
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { driverId, isActive: true } });
  if (!vehicle) throw new AppError('No active vehicle registered. Add a vehicle before accepting trips.', 400, 'NO_VEHICLE');

  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.trip.updateMany({
      where: { id: tripId, status: 'REASSIGNING' },
      data: { driverId, vehicleId: vehicle.id, status: 'DRIVER_EN_ROUTE' },
    });
    if (claim.count === 0) {
      throw new AppError('This trip has already been reassigned to another driver.', 409, 'REASSIGNMENT_UNAVAILABLE');
    }

    await tx.dispatchAction.create({ data: { driverId, tripId, action: 'ACCEPTED' } });

    return tx.trip.findUnique({
      where: { id: tripId },
      include: {
        route: true,
        bookings: { where: { status: { notIn: ['CANCELLED'] } }, include: { user: { select: { fcmToken: true } } } },
      },
    });
  });

  setImmediate(async () => {
    for (const b of result.bookings) {
      if (b.user?.fcmToken) {
        pushService.sendPush(
          b.user.fcmToken,
          'New driver on the way',
          'A new driver has been matched to your trip and is heading your way.',
          { type: 'TRIP_REASSIGNED', tripId },
        ).catch(() => {});
      }
    }
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT DELETION
// ═══════════════════════════════════════════════════════════════════

async function deleteMe(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  return prisma.driver.update({
    where: { id: driverId },
    data: {
      name: '[Deleted Account]',
      phone: `deleted_${driverId.slice(0, 8)}`,
      status: 'DISABLED',
      isOnline: false,
      fcmToken: null,
      currentLat: null,
      currentLng: null,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// TRIP REPORT
// ═══════════════════════════════════════════════════════════════════

async function reportTrip(driverId, tripId, { type, details }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    select: { id: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  return prisma.tripReport.create({
    data: {
      tripId,
      driverId,
      type,
      details: details || null,
    },
  });
}

// Derives a notification history from the driver's own trips/bookings — mirrors
// the rider notifications module's "no separate Notification model needed"
// pattern. Backfills what a driver missed while the app was fully killed (the
// live socket-driven notifications store only catches events while connected).
async function getNotifications(driverId, limit = 30) {
  const take = Math.min(parseInt(limit, 10) || 30, 50);

  const trips = await prisma.trip.findMany({
    where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
    include: {
      route: { select: { originName: true, destinationName: true } },
      bookings: { where: { paymentStatus: 'PAID' }, select: { id: true, fareAmount: true, seatNumber: true, updatedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take,
  });

  const notifications = trips.flatMap((trip) => {
    const dest = trip.route?.destinationName ?? 'your destination';
    const items = [];

    if (trip.status === 'COMPLETED') {
      items.push({
        id: `${trip.id}:completed`,
        type: 'COMPLETED',
        title: 'Trip completed',
        body: `Your trip to ${dest} is complete.`,
        tripId: trip.id,
        createdAt: (trip.arrivedAt ?? trip.updatedAt).toISOString(),
      });
    } else if (trip.status === 'CANCELLED') {
      items.push({
        id: `${trip.id}:cancelled`,
        type: 'INFO',
        title: 'Trip cancelled',
        body: `Your trip to ${dest} was cancelled.`,
        tripId: trip.id,
        createdAt: trip.updatedAt.toISOString(),
      });
    }

    for (const b of trip.bookings) {
      items.push({
        id: `${b.id}:paid`,
        type: 'PAYMENT_CONFIRMED',
        title: 'Payment confirmed',
        body: `GHS ${b.fareAmount?.toFixed(2) ?? '—'} paid for Seat #${b.seatNumber} on your trip to ${dest}.`,
        tripId: trip.id,
        createdAt: b.updatedAt.toISOString(),
      });
    }

    return items;
  });

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { notifications: notifications.slice(0, take) };
}

// ─────────────────────────────────────────────────────────────────
// PENDING TRIP-REQUEST POLL FALLBACK
// Socket/FCM dispatch is fire-and-forget and racy; this REST endpoint lets the
// driver app reliably POLL for on-demand requests it may be eligible for.
// ─────────────────────────────────────────────────────────────────
async function getPendingTripRequests(driverId, { lat, lng } = {}) {
  const { haversineKm } = require('../trips/fare.calculator');
  const DISPATCH_RADIUS_KM = parseFloat(process.env.DISPATCH_RADIUS_KM) || 8;
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // BUSY-DRIVER LEAK FIX: this poll had no eligibility check at all, so even
  // when the push/socket dispatch paths correctly skipped a busy driver, that
  // driver's app polled this endpoint every few seconds and rendered the
  // dispatch card anyway — which is exactly the "I'm on my own trip and it
  // still shows me other riders" symptom. A driver who is offline, not
  // approved, or already engaged now gets an empty list, full stop.
  if (!(await isDriverAvailable(prisma, driverId))) return [];

  const requests = await prisma.tripRequest.findMany({
    where: {
      status: { in: ['PENDING', 'DISPATCHED'] },
      createdAt: { gte: fiveMinAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { name: true } } },
  });

  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng);

  const requestOffers = requests
    .filter((r) => {
      if (!hasCoords) return true; // no driver coords → return all recent pending
      if (r.pickupLat == null || r.pickupLng == null) return true; // can't filter → include
      return haversineKm(lat, lng, r.pickupLat, r.pickupLng) <= DISPATCH_RADIUS_KM;
    })
    .map((r) => ({
      tripId: r.id, // this is the tripRequest id — accept via /trip-requests/:id/accept
      kind: 'REQUEST',
      routeOrigin: r.user?.name ? `${r.user.name}'s pickup` : 'Rider pickup',
      routeDestination: r.destination,
      departureTime: r.scheduledAt,
      seatCount: r.seatCount,
      pickupLat: r.pickupLat,
      pickupLng: r.pickupLng,
    }));

  // Trips a driver bailed on pre-boarding (see redispatchTrip) — reliability
  // backstop for the socket-pushed 'trip:assigned' event, same reasoning as
  // the REQUEST poll above. Excludes the driver who just cancelled it.
  const reassignments = await prisma.trip.findMany({
    where: { status: 'REASSIGNING', driverId: { not: driverId } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: { route: true, bookings: { where: { status: { notIn: ['CANCELLED'] } }, select: { id: true } } },
  });
  const reassignmentOffers = reassignments
    .filter((t) => {
      if (!hasCoords) return true;
      if (t.pickupLat == null || t.pickupLng == null) return true;
      return haversineKm(lat, lng, t.pickupLat, t.pickupLng) <= DISPATCH_RADIUS_KM;
    })
    .map((t) => ({
      tripId: t.id, // this is the trip id — accept via drivers/trips/:id/claim-reassignment
      kind: 'REASSIGNMENT',
      routeOrigin: 'Pickup nearby',
      routeDestination: t.route?.destinationName,
      departureTime: t.departureTime,
      seatCount: t.bookings.length,
      pickupLat: t.pickupLat,
      pickupLng: t.pickupLng,
    }));

  return [...reassignmentOffers, ...requestOffers];
}

// Upcoming scheduled trips this driver is matched to (their own SCHEDULED/FILLING
// trips with a future departure). ScheduledRideIntent has no driver link until it
// is matched onto a Trip, so driver-facing "scheduled awareness" is the trips the
// driver owns that haven't departed yet.
async function getUpcomingScheduledTrips(driverId) {
  const trips = await prisma.trip.findMany({
    where: {
      driverId,
      status: { in: ['SCHEDULED', 'FILLING'] },
      departureTime: { gte: new Date() },
    },
    orderBy: { departureTime: 'asc' },
    take: 50,
    include: {
      route: { select: { originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      _count: { select: { bookings: { where: { status: { notIn: ['CANCELLED'] } } } } },
    },
  });

  return trips.map((t) => ({
    tripId: t.id,
    kind: 'SCHEDULED',
    status: t.status,
    routeOrigin: t.route?.originName ?? null,
    routeDestination: t.route?.destinationName ?? null,
    departureTime: t.departureTime,
    seatCount: t.maxSeats,
    confirmedSeats: t.confirmedSeats,
    bookedSeats: t._count.bookings,
    pickupLat: t.pickupLat ?? t.route?.originLat ?? null,
    pickupLng: t.pickupLng ?? t.route?.originLng ?? null,
  }));
}

module.exports = {
  getMe, updateProfile, updateFcmToken, completeVerification, addVehicle,
  goOnline, goOffline, getActiveTrip, getTripHistory, getAllTrips, devActivate,
  getNotifications,
  startTrip, departTrip, arriveAtPickup, arriveTrip, cancelTrip,
  getTripById, acceptDispatch, declineDispatch, uploadDocument, reviewDocument,
  addOfflinePassenger, addCashNoPhone, verifyOfflineOtp, boardPassenger,
  getPerformance, getRatings, getDocuments, updateEmergencyContact, updatePreferences, ratePassenger,
  setDestinationFilter, getDestinationFilter, deleteDestinationFilter,
  startShift, endShift, getCurrentShift, getShiftHistory,
  getEarningsBreakdown, getWalletTransactions,
  getSupportTickets, createSupportTicket, replyToTicket,
  scheduleInspection, getInspections,
  deleteMe, reportTrip,
  getPendingTripRequests, getUpcomingScheduledTrips, claimReassignedTrip,
};

// ── Rate passenger (driver rates rider after trip) ────────────────
async function ratePassenger(driverId, bookingId, { stars, comment }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.trip || booking.trip.driverId !== driverId) throw new ForbiddenError('Not your trip');
  if (!booking.userId) throw new AppError('Cannot rate offline passenger', 400);
  if (booking.trip.status !== 'COMPLETED') throw new AppError('Can only rate after trip completion', 400, 'TRIP_NOT_COMPLETED');

  const s = Number(stars);
  if (isNaN(s) || s < 1 || s > 5) {
    throw new AppError('Stars must be between 1 and 5', 400);
  }

  const rating = await prisma.passengerRating.upsert({
    where: {
      driverId_tripId_userId: {
        driverId,
        tripId: booking.tripId,
        userId: booking.userId,
      },
    },
    update: { stars: s, comment: comment ?? undefined },
    create: {
      driverId,
      userId: booking.userId,
      tripId: booking.tripId,
      stars: s,
      comment,
    },
  });

  // ── Push notification to rider ───────────────────────────────────
  setImmediate(async () => {
    try {
      const pushService = require('../../services/push.service');
      // Fetch the passenger's FCM token separately — booking.trip query doesn't load driver relation
      const passenger = await prisma.user.findUnique({ where: { id: booking.userId }, select: { fcmToken: true } });
      if (passenger?.fcmToken) {
        await pushService.sendPush(
          passenger.fcmToken,
          '✨ Your driver rated you!',
          `Your driver gave you ${s} star${s !== 1 ? 's' : ''}`,
          { type: 'PASSENGER_RATING', tripId: booking.tripId, stars: String(s) },
        );
      }
    } catch (err) {
      // Non-blocking
    }
  });

  return { rating };
}

// ── Performance stats ──────────────────────────────────────────────
async function getPerformance(driverId) {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    totalTrips, completedTrips, cancelledTrips, weekTrips, weekEarnings,
    acceptedDispatches, declinedDispatches, onlineSessions,
  ] = await Promise.all([
    prisma.trip.count({ where: { driverId } }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.trip.count({ where: { driverId, status: 'CANCELLED' } }),
    prisma.trip.count({ where: { driverId, createdAt: { gte: weekAgo } } }),
    prisma.walletTransaction.aggregate({
      where: { driverId, type: 'EARNINGS_CREDIT', createdAt: { gte: weekAgo } },
      _sum: { amount: true },
    }),
    // Real dispatch tracking
    prisma.dispatchAction.count({ where: { driverId, action: 'ACCEPTED', createdAt: { gte: weekAgo } } }),
    prisma.dispatchAction.count({ where: { driverId, action: 'DECLINED', createdAt: { gte: weekAgo } } }),
    // Real online session hours
    prisma.onlineSession.findMany({
      where: { driverId, startTime: { gte: weekAgo } },
      select: { startTime: true, endTime: true },
    }),
  ]);

  // Calculate real acceptance rate
  const totalDispatches = acceptedDispatches + declinedDispatches;
  const acceptanceRate = totalDispatches > 0
    ? Math.round((acceptedDispatches / totalDispatches) * 100)
    : null;

  // Calculate real online hours this week
  const onlineHoursThisWeek = onlineSessions.reduce((total, session) => {
    const end = session.endTime ?? now;
    const hours = (end.getTime() - session.startTime.getTime()) / (1000 * 60 * 60);
    return total + hours;
  }, 0);

  return {
    acceptanceRate,
    completionRate: totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 100,
    cancellationRate: totalTrips > 0 ? Math.round((cancelledTrips / totalTrips) * 100) : 0,
    onlineHoursThisWeek: Math.round(onlineHoursThisWeek * 10) / 10,
    tripsThisWeek: weekTrips,
    earningsThisWeek: weekEarnings._sum.amount ?? 0,
    level: completedTrips >= 100 ? 'PLATINUM' : completedTrips >= 50 ? 'GOLD' : completedTrips >= 20 ? 'SILVER' : 'BRONZE',
    weeklyGoal: 20,
    weeklyGoalProgress: weekTrips,
  };
}

// Canonical compliment tags the rider app lets riders attach to a rating
// (apps/rider/app/ride/[id]/rate-tip.tsx). They're sent as a comma-joined
// prefix on the free-text comment (e.g. "Punctual, Friendly — great driver!"),
// so we count real occurrences here instead of returning made-up numbers.
const COMPLIMENT_TAGS = [
  { label: 'Punctual', icon: 'time-outline' },
  { label: 'Safe Driver', icon: 'shield-checkmark-outline' },
  { label: 'Clean Vehicle', icon: 'sparkles-outline' },
  { label: 'Friendly', icon: 'happy-outline' },
  { label: 'Helpful', icon: 'heart-outline' },
  { label: 'Smooth Ride', icon: 'car-sport-outline' },
];

// ── Ratings ────────────────────────────────────────────────────────
async function getRatings(driverId) {
  const [aggregate, allRatings, recent] = await Promise.all([
    prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: true }),
    prisma.driverRating.findMany({ where: { driverId }, select: { stars: true, comment: true } }),
    prisma.driverRating.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  // Build star breakdown
  const breakdown = [5, 4, 3, 2, 1].map((stars) => {
    const count = allRatings.filter((r) => r.stars === stars).length;
    return {
      stars,
      count,
      percentage: allRatings.length > 0 ? Math.round((count / allRatings.length) * 100) : 0,
    };
  });

  // Real compliment counts — how many ratings' comment text mentions each tag.
  const compliments = COMPLIMENT_TAGS.map(({ label, icon }) => ({
    label,
    icon,
    count: allRatings.filter((r) => r.comment?.includes(label)).length,
  })).filter((c) => c.count > 0);

  return {
    average: aggregate._avg.stars ?? 5.0,
    total: aggregate._count,
    breakdown,
    compliments,
    recent: recent.map((r) => ({
      tripId: r.tripId,
      stars: r.stars,
      comment: r.comment || undefined,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ── Documents ──────────────────────────────────────────────────────
async function getDocuments(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { ghanaCardPhoto: true, licensePhoto: true, profilePhoto: true, documentReview: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  let review = {};
  try { review = driver.documentReview ? JSON.parse(driver.documentReview) : {}; } catch { /* ignore malformed data */ }

  const statusFor = (type, hasPhoto) => {
    if (!hasPhoto) return 'MISSING';
    // Grandfather photos uploaded before this review system existed — otherwise every
    // already-active driver would be retroactively gated offline pending re-review.
    // Only uploads made through the (now PENDING-by-default) upload flow have a
    // review entry at all, so its absence here specifically means "predates review."
    return review[type]?.status ?? 'VERIFIED';
  };

  const docs = [
    { id: 'license', type: 'DRIVERS_LICENSE', status: statusFor('DRIVERS_LICENSE', !!driver.licensePhoto), url: driver.licensePhoto ?? undefined, rejectionReason: review.DRIVERS_LICENSE?.rejectionReason ?? undefined },
    { id: 'ghana_card', type: 'GHANA_CARD', status: statusFor('GHANA_CARD', !!driver.ghanaCardPhoto), url: driver.ghanaCardPhoto ?? undefined, rejectionReason: review.GHANA_CARD?.rejectionReason ?? undefined },
    { id: 'profile', type: 'PROFILE_PHOTO', status: statusFor('PROFILE_PHOTO', !!driver.profilePhoto), url: driver.profilePhoto ?? undefined, rejectionReason: review.PROFILE_PHOTO?.rejectionReason ?? undefined },
  ];
  return docs;
}

/**
 * Admin approve/reject a specific driver document. Previously there was no
 * per-document review path at all — status was a binary present→VERIFIED.
 */
async function reviewDocument(driverId, type, { approve, rejectionReason } = {}) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { documentReview: true } });
  if (!driver) throw new NotFoundError('Driver');

  let review = {};
  try { review = driver.documentReview ? JSON.parse(driver.documentReview) : {}; } catch { /* reset on malformed data */ }

  review[type] = {
    status: approve ? 'VERIFIED' : 'REJECTED',
    reviewedAt: new Date().toISOString(),
    rejectionReason: approve ? null : (rejectionReason || 'Document rejected by review team'),
  };

  await prisma.driver.update({ where: { id: driverId }, data: { documentReview: JSON.stringify(review) } });
  return review[type];
}

// ── Emergency contact ───────────────────────────────────────────────
async function updateEmergencyContact(driverId, data) {
  const { name, phone, relationship } = data;
  if (!name || !phone) throw new AppError('Name and phone are required', 400);

  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: { emergencyContact: JSON.stringify({ name, phone, relationship: relationship || null }) },
    select: { emergencyContact: true },
  });
  return JSON.parse(driver.emergencyContact);
}

// ── Preferences ─────────────────────────────────────────────────────
async function updatePreferences(driverId, data) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { preferences: true },
  });

  const currentPrefs = driver?.preferences ? JSON.parse(driver.preferences) : {};
  const merged = { ...currentPrefs, ...data };

  await prisma.driver.update({
    where: { id: driverId },
    data: { preferences: JSON.stringify(merged) },
  });
  return merged;
}

// ═══════════════════════════════════════════════════════════════════
// DESTINATION FILTER
// ═══════════════════════════════════════════════════════════════════

async function setDestinationFilter(driverId, { destLat, destLng, destName }) {
  if (!destLat || !destLng || !destName) {
    throw new AppError('Destination coordinates and name are required', 400);
  }
  const filter = await prisma.driverDestinationPreference.upsert({
    where: { driverId },
    update: { destLat, destLng, destName, isActive: true },
    create: { driverId, destLat, destLng, destName },
  });
  return filter;
}

async function getDestinationFilter(driverId) {
  const filter = await prisma.driverDestinationPreference.findUnique({
    where: { driverId },
  });
  return filter ?? null;
}

async function deleteDestinationFilter(driverId) {
  await prisma.driverDestinationPreference.deleteMany({ where: { driverId } });
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// SHIFT TRACKING
// ═══════════════════════════════════════════════════════════════════

async function startShift(driverId) {
  // End any active shift first
  await prisma.driverShift.updateMany({
    where: { driverId, status: 'ACTIVE' },
    data: {
      status: 'ENDED',
      endTime: new Date(),
    },
  });

  const shift = await prisma.driverShift.create({
    data: {
      driverId,
      startTime: new Date(),
      status: 'ACTIVE',
    },
  });
  return shift;
}

async function endShift(driverId) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, status: 'ACTIVE' },
    orderBy: { startTime: 'desc' },
  });
  if (!shift) throw new AppError('No active shift found', 400);

  // Calculate shift earnings from trips completed during the shift
  const completedTrips = await prisma.walletTransaction.aggregate({
    where: {
      driverId,
      type: 'EARNINGS_CREDIT',
      createdAt: { gte: shift.startTime },
    },
    _sum: { amount: true },
    _count: { amount: true },
  });

  const updated = await prisma.driverShift.update({
    where: { id: shift.id },
    data: {
      status: 'ENDED',
      endTime: new Date(),
      earnings: completedTrips._sum.amount ?? 0,
      tripsCount: completedTrips._count.amount ?? 0,
    },
  });
  return updated;
}

async function getCurrentShift(driverId) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, status: 'ACTIVE' },
    orderBy: { startTime: 'desc' },
  });
  if (!shift) return null;

  // Update live earnings/trip count
  const completedTrips = await prisma.walletTransaction.aggregate({
    where: {
      driverId,
      type: 'EARNINGS_CREDIT',
      createdAt: { gte: shift.startTime },
    },
    _sum: { amount: true },
    _count: { amount: true },
  });

  const hoursElapsed = (Date.now() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);

  return {
    ...shift,
    earnings: completedTrips._sum.amount ?? 0,
    tripsCount: completedTrips._count.amount ?? 0,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    hourlyRate: hoursElapsed > 0
      ? Math.round(((completedTrips._sum.amount ?? 0) / hoursElapsed) * 100) / 100
      : 0,
  };
}

async function getShiftHistory(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [shifts, total] = await Promise.all([
    prisma.driverShift.findMany({
      where: { driverId },
      orderBy: { startTime: 'desc' },
      skip,
      take: limit,
    }),
    prisma.driverShift.count({ where: { driverId } }),
  ]);
  return { shifts, total, page, totalPages: Math.ceil(total / limit) };
}

// ═══════════════════════════════════════════════════════════════════
// EARNINGS BREAKDOWN
// ═══════════════════════════════════════════════════════════════════

async function getEarningsBreakdown(driverId, period = 'week') {
  const now = new Date();
  let startDate;

  switch (period) {
    case 'day':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
  }

  const [earningsAgg, tipsAgg, deductionsAgg, tripsData, dailyBreakdown] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { driverId, type: 'EARNINGS_CREDIT', createdAt: { gte: startDate } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, type: 'TIP', createdAt: { gte: startDate } },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, type: { in: ['COMMISSION_DEDUCTION', 'WITHDRAWAL'] }, createdAt: { gte: startDate } },
      _sum: { amount: true },
    }),
    prisma.trip.findMany({
      where: { driverId, status: 'COMPLETED', createdAt: { gte: startDate } },
      select: { id: true, shortId: true, createdAt: true, baseFare: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Daily breakdown
    prisma.$queryRaw`
      SELECT DATE(created_at) as date, SUM(amount) as earnings, COUNT(*) as trips
      FROM wallet_transactions
      WHERE driver_id = ${driverId}
        AND type = 'EARNINGS_CREDIT'
        AND created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `,
  ]);

  return {
    totalEarnings: earningsAgg._sum.amount ?? 0,
    totalTrips: earningsAgg._count ?? 0,
    totalTips: tipsAgg._sum.amount ?? 0,
    totalDeductions: deductionsAgg._sum.amount ?? 0,
    netEarnings: (earningsAgg._sum.amount ?? 0) - (deductionsAgg._sum.amount ?? 0),
    averagePerTrip: earningsAgg._count > 0
      ? Math.round(((earningsAgg._sum.amount ?? 0) / earningsAgg._count) * 100) / 100
      : 0,
    dailyBreakdown: Array.isArray(dailyBreakdown) ? dailyBreakdown : [],
    recentTrips: tripsData.slice(0, 10),
    period,
  };
}

async function getWalletTransactions(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.walletTransaction.count({ where: { driverId } }),
  ]);

  // WalletTransaction only stores a scalar tripId (no relation), so batch-fetch
  // shortIds separately instead of an invalid Prisma `include`.
  const tripIds = [...new Set(transactions.map((tx) => tx.tripId).filter(Boolean))];
  const trips = tripIds.length
    ? await prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, shortId: true } })
    : [];
  const shortIdByTripId = new Map(trips.map((t) => [t.id, t.shortId]));

  return {
    transactions: transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      balanceBefore: tx.balanceBefore,
      balanceAfter: tx.balanceAfter,
      tripShortId: tx.tripId ? (shortIdByTripId.get(tx.tripId) ?? null) : null,
      createdAt: tx.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT TICKETS (Driver-side)
// ═══════════════════════════════════════════════════════════════════

async function createSupportTicket(driverId, { subject, category, description }) {
  if (!subject || !description) {
    throw new AppError('Subject and description are required', 400);
  }

  // Create a user entry for the driver if one doesn't exist
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  // Find or create a user record for this driver
  let user = await prisma.user.findUnique({ where: { phone: driver.phone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: driver.phone,
        name: driver.name || 'Driver',
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId: user.id,
        driverId,
        subject,
        category: category || 'GENERAL',
        status: 'OPEN',
        priority: 'MEDIUM',
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.id,
        senderRole: 'USER',
        text: description,
      },
    });

    return ticket;
  });
}

async function getSupportTickets(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!driver) throw new NotFoundError('Driver');

  const user = await prisma.user.findUnique({ where: { phone: driver.phone } });

  // Two sources, combined: (1) the driver's own tickets, matched by a rider
  // account sharing their phone number — the original (fragile) mechanism;
  // (2) tickets actually filed by riders ABOUT this driver's trips, via the
  // dedicated driverId column that submitDispute now populates. Previously
  // only (1) was queried, so a rider's dispute about a driver's trip was
  // invisible on the driver's side unless they coincidentally shared a phone
  // number with that rider's account.
  const tickets = await prisma.supportTicket.findMany({
    where: {
      OR: [
        ...(user ? [{ userId: user.id }] : []),
        { driverId },
      ],
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, text: true, senderRole: true, createdAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return { tickets };
}

async function replyToTicket(driverId, ticketId, { message }) {
  if (!message) throw new AppError('Message is required', 400);

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!driver) throw new NotFoundError('Driver');

  const user = await prisma.user.findUnique({ where: { phone: driver.phone } });
  if (!user) throw new NotFoundError('User account');

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, userId: user.id },
  });
  if (!ticket) throw new NotFoundError('Ticket');

  return prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: user.id,
        senderRole: 'USER',
        text: message,
      },
    });

    await tx.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'OPEN', updatedAt: new Date() },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// VEHICLE INSPECTION SCHEDULING
// ═══════════════════════════════════════════════════════════════════

async function scheduleInspection(driverId, { vehicleId, scheduledDate, notes }) {
  if (!vehicleId || !scheduledDate) {
    throw new AppError('Vehicle and scheduled date are required', 400);
  }

  // Verify vehicle belongs to driver
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, driverId },
  });
  if (!vehicle) throw new NotFoundError('Vehicle');

  const inspection = await prisma.vehicleInspection.create({
    data: {
      vehicleId,
      driverId,
      scheduledDate: new Date(scheduledDate),
      status: 'SCHEDULED',
      notes: notes || null,
    },
  });

  return inspection;
}

async function getInspections(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [inspections, total] = await Promise.all([
    prisma.vehicleInspection.findMany({
      where: { driverId },
      include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
      orderBy: { scheduledDate: 'desc' },
      skip,
      take: limit,
    }),
    prisma.vehicleInspection.count({ where: { driverId } }),
  ]);

  return { inspections, total, page, totalPages: Math.ceil(total / limit) };
}
