'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const { calculateFare, estimateFare, haversineKm } = require('./fare.calculator');
const { NotFoundError, ConflictError, ForbiddenError, AppError } = require('../../utils/errors');
const { v4: uuidv4 } = require('uuid');
const surgeService = require('./surge.service');
const { dispatchToNearbyDrivers } = require('../../services/dispatch.service');
const pushService = require('../../services/push.service');
const pubSub = require('../../graphql/pubsub');
const logger = require('../../utils/logger');

async function createTrip(driverId, data) {
  const { routeId, vehicleId: requestedVehicleId, departureTime, doorstepPickup, pickupLat, pickupLng, pickupAddress, heavyLoad, availableSeats } = data;
  const tier = data.tier || 'ECONOMY';

  // Auto-select vehicle: use provided vehicleId or fall back to driver's first active vehicle
  let vehicle;
  if (requestedVehicleId) {
    vehicle = await prisma.vehicle.findFirst({ where: { id: requestedVehicleId, driverId, isActive: true } });
  } else {
    vehicle = await prisma.vehicle.findFirst({ where: { driverId, isActive: true } });
  }

  // DEV MODE: auto-seed a trial vehicle + activate driver if missing
  if (!vehicle && env.NODE_ENV === 'development') {
    const devPlate = `DEV-${driverId.slice(0, 8).toUpperCase()}`;
    const [devVehicle] = await prisma.$transaction(async (tx) => {
      // Activate driver + top up wallet to minimum
      const minBalance = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE ?? 20;
      const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { id: true, walletBalance: true, status: true } });
      if (driver) {
        const currentBalance = driver.walletBalance ?? 0;
        const topUp = currentBalance < minBalance ? minBalance - currentBalance : 0;
        const updates = { status: 'ACTIVE' };
        if (topUp > 0) {
          updates.walletBalance = { increment: topUp };
        }
        await tx.driver.update({ where: { id: driverId }, data: updates });
        if (topUp > 0) {
          await tx.walletTransaction.create({
            data: {
              driverId,
              type: 'TOP_UP',
              amount: topUp,
              description: 'Dev-createTrip wallet top-up',
              balanceBefore: currentBalance,
              balanceAfter: currentBalance + topUp,
            },
          });
        }
      }

      // Remove any previously created dev vehicles for this driver to avoid plateNumber conflict
      await tx.vehicle.deleteMany({ where: { driverId, plateNumber: { startsWith: 'DEV-' } } });

      // Create trial vehicle
      return Promise.all([
        tx.vehicle.create({
          data: {
            driverId,
            plateNumber: devPlate,
            make: 'Toyota',
            model: 'Hiace',
            year: 2024,
            seaterCount: 14,
            tier: 'ECO',
            isVerified: true,
            isActive: true,
          },
        }),
      ]);
    });
    vehicle = devVehicle;
  }

  if (!vehicle) throw new AppError('No vehicle registered. Please add a vehicle in your profile before publishing a trip.', 400, 'NO_VEHICLE');

  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw new NotFoundError('Route');

  const normalizedTier = tier === 'ECO' ? 'ECO' : (tier === 'COMFORT' ? 'COMFORT' : 'ECO');
  const baseFare = normalizedTier === 'ECO' ? env.ECO_BASE_FARE : env.COMFORT_BASE_FARE;
  const perKmRate = normalizedTier === 'ECO' ? env.ECO_PER_KM_RATE : env.COMFORT_PER_KM_RATE;

  // Record supply and get surge multiplier
  let surgeMultiplier = 1.0;
  if (pickupLat && pickupLng) {
    await surgeService.recordSupply(pickupLat, pickupLng, driverId);
    surgeMultiplier = await surgeService.getSurgeMultiplier(pickupLat, pickupLng);
  }

  const trip = await prisma.trip.create({
    data: {
      driverId,
      vehicleId: vehicle.id,
      routeId,
      tier: normalizedTier,
      departureTime: new Date(departureTime),
      doorstepPickup: doorstepPickup || false,
      pickupLat, pickupLng, pickupAddress,
      heavyLoad: heavyLoad || false,
      baseFare,
      perKmRate,
      surgeMultiplier,
      maxSeats: (availableSeats && availableSeats > 0 && availableSeats <= vehicle.seaterCount) ? availableSeats : vehicle.seaterCount,
      status: 'SCHEDULED',
    },
    include: { route: true, vehicle: true, driver: { select: { name: true, profilePhoto: true } } },
  });

  // Attach farePerSeat + totalTripCost immediately so the driver app shows the
  // same per-seat price the rider will see — no waiting for the next refetch.
  // Always use maxSeats as the denominator: that is the capacity the driver
  // chose for this trip and must match what riders see on the listing.
  const fareInfo = estimateFare({
    tier: trip.tier,
    distanceKm: trip.route?.distanceKm ?? 0,
    doorstepPickup: trip.doorstepPickup,
    heavyLoad: trip.heavyLoad,
    surgeMultiplier: trip.surgeMultiplier,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
    availableSeats: trip.maxSeats,
  });
  trip.farePerSeat = fareInfo.farePerPerson;
  trip.totalTripCost = fareInfo.totalTripCost;

  // Notify nearby online drivers about this new trip (fire-and-forget)
  setImmediate(() => dispatchToNearbyDrivers(trip));

  return trip;
}

async function getTrip(id) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true } },
      bookings: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, seatNumber: true, status: true, paymentStatus: true, userId: true, isOffline: true, guestName: true },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Divide by maxSeats — the fixed capacity the driver chose for this trip.
  // This keeps farePerSeat stable and identical to what the listing showed.
  const fareInfo = calculateFare({
    tier: trip.tier,
    distanceKm: trip.route.distanceKm,
    seatCount: trip.maxSeats,
    doorstepPickup: trip.doorstepPickup,
    heavyLoad: trip.heavyLoad,
    surgeMultiplier: trip.surgeMultiplier,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
  });
  trip.farePerSeat = fareInfo.farePerPerson;
  trip.fare = fareInfo.farePerPerson; // kept for backwards-compat with older clients
  // Full trip cost — what a rider pays when they choose "I'm paying for everyone".
  trip.totalTripCost = fareInfo.totalTripCost;

  // Attach driver's average rating
  if (trip.driver) {
    const ratingAgg = await prisma.driverRating.aggregate({
      where: { driverId: trip.driverId },
      _avg: { stars: true },
      _count: { stars: true },
    });
    trip.driver.rating = ratingAgg._avg.stars ?? null;
    trip.driver.ratingCount = ratingAgg._count.stars ?? 0;
  }

  return trip;
}

async function getTripByShareToken(shareToken) {
  const group = await prisma.rideGroup.findUnique({
    where: { shareToken },
    include: {
      trip: {
        include: {
          route: true,
          vehicle: true,
          driver: { select: { id: true, name: true, profilePhoto: true } },
          bookings: {
            where: { status: { not: 'CANCELLED' } },
            select: { seatNumber: true, status: true },
          },
        },
      },
    },
  });
  if (!group) throw new NotFoundError('Ride');

  // ── Share token expiration validation ────────────────────────────────
  // RideGroup.expiresAt is set to 2 hours after creation. If it's past expiry,
  // the invite link is dead — return a clear error so the join screen can show
  // a graceful "This invite has expired" message instead of a generic 404.
  if (group.expiresAt < new Date()) {
    throw new AppError('This invite link has expired', 410, 'INVITE_EXPIRED');
  }

  const fare = estimateFare({
    tier: group.trip.tier,
    distanceKm: group.trip.route.distanceKm,
    doorstepPickup: group.trip.doorstepPickup,
    heavyLoad: group.trip.heavyLoad,
    surgeMultiplier: group.trip.surgeMultiplier,
    storedBaseFare: group.trip.baseFare,
    storedPerKmRate: group.trip.perKmRate,
    availableSeats: group.trip.maxSeats,
  });

  // Flatten so the rider's group hub can read `trip.fare` / `trip.totalTripCost`
  // the same way every other rider screen does — single source of truth.
  group.trip.fare = fare.farePerPerson;
  group.trip.farePerSeat = fare.farePerPerson;
  group.trip.totalTripCost = fare.totalTripCost;

  return { group, trip: group.trip, fareEstimate: fare };
}

async function getSeatMap(tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { maxSeats: true, confirmedSeats: true, tier: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  const bookings = await prisma.booking.findMany({
    where: { tripId, status: { notIn: ['CANCELLED'] } },
    select: { seatNumber: true, status: true, userId: true, isOffline: true },
  });

  const seats = Array.from({ length: trip.maxSeats }, (_, i) => {
    const booking = bookings.find((b) => b.seatNumber === i + 1);
    if (booking) {
      // SEAT_HELD = payment not yet confirmed — show as "PENDING" so other riders
      // can see it's being considered but it's not permanently blocked.
      // CONFIRMED / COMPLETED / BOARDED = fully taken.
      const displayStatus = booking.status === 'SEAT_HELD' ? 'PENDING' : booking.status;
      return {
        number: i + 1,
        status: displayStatus,
        isOffline: booking?.isOffline || false,
      };
    }
    // If there are no bookings, deterministically mark trip.confirmedSeats seats as OCCUPIED using a hash of tripId
    const hash = Array.from(tripId || '').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const isOccupied = ((hash + i) % trip.maxSeats) < trip.confirmedSeats;
    return {
      number: i + 1,
      status: isOccupied ? 'OCCUPIED' : 'AVAILABLE',
      isOffline: false,
    };
  });

  return { seats, maxSeats: trip.maxSeats, confirmedSeats: trip.confirmedSeats };
}

async function getPulseSchedules() {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // daysOfWeek is a JSON-encoded string column (e.g. "[1,2,3,4,5]"), not a
  // native list — Prisma's `has` filter only works on real list fields and
  // throws a validation error on every call. Filter in JS after fetch instead.
  const allActiveSchedules = await prisma.pulseSchedule.findMany({
    where: { isActive: true },
    include: {
      route: true,
      trips: {
        where: {
          departureTime: { gte: today },
          status: { in: ['SCHEDULED', 'FILLING'] },
        },
        orderBy: { departureTime: 'asc' },
        take: 1,
        include: {
          bookings: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  const schedules = allActiveSchedules.filter((s) => {
    try {
      const days = JSON.parse(s.daysOfWeek);
      return Array.isArray(days) && days.includes(dayOfWeek);
    } catch {
      return false;
    }
  });

  return schedules.map((s) => ({
    ...s,
    nextTrip: s.trips[0] || null,
    seatsAvailable: s.trips[0] ? s.maxSeats - (s.trips[0].bookings?.length || 0) : s.maxSeats,
  }));
}

async function searchTrips(query) {
  const { destination, originLat, originLng, destLat, destLng, radius = 5, page = 1, limit = 50 } = query;

  const where = {
    status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] },
    departureTime: { gte: new Date() },
  };

  if (destination) {
    where.route = {
      OR: [
        { destinationName: { contains: destination } }, // SQLite contains is case-insensitive by default in Prisma if configured, but let's just use contains
        { virtualStops: { some: { name: { contains: destination } } } }
      ]
    };
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit), 100);
  const take = Math.min(Number(limit), 100);

  const [totalCount, trips] = await Promise.all([
    prisma.trip.count({ where }),
    prisma.trip.findMany({
      where,
      include: {
        route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
        vehicle: true,
        driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true } },
        bookings: {
          where: { status: { not: 'CANCELLED' } },
          select: { id: true, seatNumber: true, status: true },
        },
      },
      orderBy: { departureTime: 'asc' },
      skip,
      take,
    }),
  ]);

  if (originLat && originLng && destLat && destLng) {
    const oLat = parseFloat(originLat);
    const oLng = parseFloat(originLng);
    const dLat = parseFloat(destLat);
    const dLng = parseFloat(destLng);
    const rad = parseFloat(radius);

    trips = trips.filter(trip => {
      const route = trip.route;
      // Check if origin is near route origin or any virtual stop
      let originNear = haversineKm(oLat, oLng, route.originLat, route.originLng) <= rad;
      if (!originNear) {
        originNear = route.virtualStops.some(stop => haversineKm(oLat, oLng, stop.lat, stop.lng) <= rad);
      }

      // Check if destination is near route destination or any virtual stop
      let destNear = haversineKm(dLat, dLng, route.destLat, route.destLng) <= rad;
      if (!destNear) {
        destNear = route.virtualStops.some(stop => haversineKm(dLat, dLng, stop.lat, stop.lng) <= rad);
      }

      return originNear && destNear;
    });
  }

  trips.forEach(trip => {
    // Always use maxSeats as the denominator so the listed price matches exactly
    // what a rider is charged when they book — eliminating the home/payment mismatch.
    const fareInfo = estimateFare({
      tier: trip.tier,
      distanceKm: trip.route.distanceKm,
      doorstepPickup: trip.doorstepPickup,
      heavyLoad: trip.heavyLoad,
      surgeMultiplier: trip.surgeMultiplier,
      storedBaseFare: trip.baseFare,
      storedPerKmRate: trip.perKmRate,
      availableSeats: trip.maxSeats,
    });
    trip.farePerSeat = fareInfo.farePerPerson;
    trip.fare = fareInfo.farePerPerson; // backwards-compat
    trip.totalTripCost = fareInfo.totalTripCost;
  });

  return { trips, total: totalCount, page: Number(page), totalPages: Math.ceil(totalCount / take) };
}

async function getActiveTrip(userId) {
  const booking = await prisma.booking.findFirst({
    where: {
      userId,
      status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] },
      trip: {
        status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] }
      }
    },
    include: {        trip: {
          include: {
            route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
            vehicle: true,
            driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true } } // phone excluded — use contact relay
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

  if (!booking) {
    throw new NotFoundError('No active trip found');
  }

  return booking;
}

/**
 * Store (or clear) the ActivityKit push token for the rider's Live Activity
 * on a given trip. Scoped to the rider's own CONFIRMED/PAID/BOARDED booking
 * for that trip — a rider can only register a token for their own booking.
 *
 * `activityId` is the native Activity's local id (from LiveActivity.startActivity
 * on-device); it's stored mainly for debugging/log correlation, the push
 * itself only needs `pushToken`.
 */
async function saveLiveActivityToken(userId, tripId, { pushToken, activityId }) {
  const booking = await prisma.booking.findFirst({
    where: { tripId, userId, status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } },
    select: { id: true },
  });
  if (!booking) {
    throw new NotFoundError('No active booking found for this trip');
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      liveActivityPushToken: pushToken || null,
      liveActivityId: activityId || null,
    },
  });

  return { bookingId: booking.id };
}

/** Clear the stored token — called once the activity ends (COMPLETED/CANCELLED/NO_SHOW). */
async function clearLiveActivityToken(bookingId) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { liveActivityPushToken: null, liveActivityId: null },
  }).catch(() => null); // non-critical — booking may already be gone/reassigned
}

async function completeTrip(tripId) {
  const completedRiderTokens = []; // populated inside the tx, pushed to after commit

  await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      select: { status: true, driverId: true, departureTime: true },
    });
    if (!trip) throw new NotFoundError('Trip');
    // Idempotency guard: if already completed, return early to prevent double wallet credits
    if (trip.status === 'COMPLETED') {
      return tx.trip.findUnique({ where: { id: tripId } });
    }

    const completedAt = new Date();

    // Update trip status
    await tx.trip.update({
      where: { id: tripId },
      data: { status: 'COMPLETED' },
    });

    // Batch-update all active bookings to COMPLETED so rider Past tab reflects correctly
    await tx.booking.updateMany({
      where: {
        tripId,
        status: { in: ['CONFIRMED', 'SEAT_HELD', 'BOARDED', 'PAID'] },
      },
      data: { status: 'COMPLETED' },
    });

    // Credit driver wallet: sum fareAmount from paid+confirmed bookings, minus 15% platform fee
    const paidBookings = await tx.booking.findMany({
      where: {
        tripId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'PAID',
      },
      select: {
        id: true, userId: true, fareAmount: true, commissionAmount: true, paymentMethod: true, updatedAt: true,
        paymentTxs: { where: { status: 'SUCCESS' }, select: { createdAt: true }, take: 1, orderBy: { createdAt: 'desc' } },
        user: { select: { fcmToken: true, notificationPrefs: true } },
      },
    });

    for (const b of paidBookings) {
      if (b.user?.fcmToken) {
        completedRiderTokens.push({ token: b.user.fcmToken, fareAmount: b.fareAmount, notificationPrefs: b.user.notificationPrefs });
      }
    }

    let totalNetEarnings = 0;
    let totalCommission = 0;

    if (paidBookings.length > 0) {
      // Generate per-rider Receipt records
      for (const b of paidBookings) {
        const commission = b.commissionAmount != null ? b.commissionAmount : Math.round(b.fareAmount * 0.15 * 100) / 100;
        const driverEarnings = b.fareAmount - commission;
        totalNetEarnings += driverEarnings;
        totalCommission += commission;

        const receiptNumber = `RCP-${Date.now()}-${b.id.slice(-6).toUpperCase()}`;
        await tx.receipt.create({
          data: {
            bookingId: b.id,
            userId: b.userId,
            receiptNumber,
            totalPaid: b.fareAmount,
            platformFee: commission,
            driverEarnings,
            discountApplied: 0,
            paymentMethod: b.paymentMethod ?? 'MOMO',
            paidAt: b.paymentTxs?.[0]?.createdAt ?? b.updatedAt,
          },
        });
      }

      if (totalNetEarnings > 0) {
        // Credit driver wallet — tx.wallet does not exist; the balance is a scalar on Driver
        const driverBefore = await tx.driver.findUnique({
          where: { id: trip.driverId },
          select: { walletBalance: true },
        });
        await tx.driver.update({
          where: { id: trip.driverId },
          data: { walletBalance: { increment: totalNetEarnings } },
        });
        await tx.walletTransaction.create({
          data: {
            driverId: trip.driverId,
            type: 'TRIP_EARNING',
            amount: totalNetEarnings,
            description: `Trip earnings — ${paidBookings.length} paid seat(s)`,
            balanceBefore: driverBefore?.walletBalance ?? 0,
            balanceAfter: (driverBefore?.walletBalance ?? 0) + totalNetEarnings,
            tripId,
          },
        });
      }

      // Generate DriverReceipt for this trip
      const driverReceiptNumber = `DRP-${Date.now()}-${tripId.slice(-6).toUpperCase()}`;
      await tx.driverReceipt.create({
        data: {
          driverId: trip.driverId,
          tripId,
          receiptNumber: driverReceiptNumber,
          totalEarnings: totalNetEarnings,
          commissionDeducted: totalCommission,
          periodStart: trip.departureTime,
          periodEnd: completedAt,
          status: 'PAID',
          paidAt: completedAt,
        },
      });
    }

    // ── Quest progress (Phase 2B): increment RIDES_COUNT and EARNINGS ────
    if (trip.driverId) {
      const { incrementProgress } = require('../quests/quests.service');
      // Increment ride count by 1 for completing this trip
      await incrementProgress(trip.driverId, 'RIDES_COUNT', 1, tx);
      // Increment earnings by the net amount credited to wallet
      if (totalNetEarnings > 0) {
        await incrementProgress(trip.driverId, 'EARNINGS', totalNetEarnings, tx);
      }
    }
  });

  // notifications.rideComplete was defined but never called — a backgrounded rider
  // (no live socket connection) never got a "trip complete, rate your ride" push.
  // savedAmount is a rough shared-vs-private-ride estimate for the notification copy,
  // not a precise financial figure.
  for (const { token, fareAmount, notificationPrefs } of completedRiderTokens) {
    const savedAmount = Math.round(fareAmount);
    pushService.notifications.rideComplete(token, savedAmount, notificationPrefs).catch(() => {});
  }

  // Notify GraphQL subscribers of trip completion (fire-and-forget)
  pubSub.publish(`TRIP_STATUS:${tripId}`, {
    tripId,
    status: 'COMPLETED',
    driverLat: null,
    driverLng: null,
    updatedAt: new Date().toISOString(),
  });
}

async function getTripReceipt(tripId, userId) {
  const receipt = await prisma.receipt.findFirst({
    where: {
      booking: { tripId, userId },
    },
    include: {
      booking: {
        include: {
          trip: {
            include: {
              route: { select: { originName: true, destinationName: true } },
              driver: { select: { name: true, phone: true } },
              vehicle: { select: { make: true, model: true, plateNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!receipt) throw new NotFoundError('Receipt not found for this trip');

  const trip = receipt.booking.trip;
  return {
    receiptNumber: receipt.receiptNumber,
    fare: receipt.totalPaid,
    platformFee: receipt.platformFee,
    driverEarnings: receipt.driverEarnings,
    discountApplied: receipt.discountApplied,
    paymentMethod: receipt.paymentMethod,
    paidAt: receipt.paidAt,
    seatNumber: receipt.booking.seatNumber,
    origin: trip.route?.originName,
    destination: trip.route?.destinationName,
    departureTime: trip.departureTime,
    driver: trip.driver
      ? { name: trip.driver.name, phone: trip.driver.phone, vehicle: trip.vehicle }
      : null,
  };
}

async function driverNoShow(tripId, reportingUserId) {
  // Collect push data outside the transaction so we can fire after commit
  let affectedFcmTokens = [];
  let tripRouteLabel = 'your trip';

  const result = await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      include: {
        bookings: {
          where: { status: 'CONFIRMED' },
          include: { user: { select: { fcmToken: true } } },
        },
        route: { select: { originName: true, destinationName: true } },
      },
    });
    if (!trip) throw new NotFoundError('Trip');
    if (trip.driverId !== reportingUserId) {
      throw new ForbiddenError('You are not the driver assigned to this trip');
    }
    if (!['SCHEDULED', 'FILLING', 'CONFIRMED', 'DRIVER_EN_ROUTE'].includes(trip.status)) {
      throw new AppError('Trip cannot be marked as driver no-show in current state', 400);
    }

    // Collect FCM tokens for post-transaction push (fire-and-forget after commit)
    affectedFcmTokens = trip.bookings.map((b) => b.user?.fcmToken).filter(Boolean);
    if (trip.route?.originName && trip.route?.destinationName) {
      tripRouteLabel = `${trip.route.originName} → ${trip.route.destinationName}`;
    }

    // Cancel the trip
    await tx.trip.update({ where: { id: tripId }, data: { status: 'CANCELLED' } });

    // Cancel all confirmed bookings and flag as DRIVER_NO_SHOW
    await tx.booking.updateMany({
      where: { tripId, status: { in: ['CONFIRMED', 'SEAT_HELD'] } },
      data: { status: 'CANCELLED' },
    });

    // Issue refund records for confirmed paid bookings
    for (const booking of trip.bookings) {
      if (booking.paymentStatus === 'PAID') {
        await tx.paymentTransaction.create({
          data: {
            bookingId: booking.id,
            userId: booking.userId,
            amount: booking.fareAmount,
            status: 'REFUNDED',
            paystackRef: booking.paystackRef ?? `noshow_refund_${booking.id}`,
            gatewayResponse: 'Refunded: driver no-show',
          },
        });
      }
    }

    logger.info('Driver no-show recorded', { tripId, reportingUserId });
    return { tripId, refundedCount: trip.bookings.filter((b) => b.paymentStatus === 'PAID').length };
  });

  // Notify affected riders — non-blocking, must not fail the response
  if (affectedFcmTokens.length > 0) {
    pushService.notifications.tripCancelledNoShow(affectedFcmTokens, tripRouteLabel).catch(() => {});
  }

  // Notify GraphQL subscribers of trip cancellation
  pubSub.publish(`TRIP_STATUS:${tripId}`, {
    tripId,
    status: 'CANCELLED',
    driverLat: null,
    driverLng: null,
    updatedAt: new Date().toISOString(),
  });

  return result;
}

async function riderNoShow(tripId, bookingId, reportingUserId) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
    if (!trip) throw new NotFoundError('Trip');
    if (trip.driverId !== reportingUserId) {
      throw new ForbiddenError('You are not the driver assigned to this trip');
    }

    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.tripId !== tripId) throw new AppError('Booking does not belong to this trip', 400);
    if (!['CONFIRMED', 'SEAT_HELD'].includes(booking.status)) {
      throw new AppError('Booking is not in a confirmable state', 400);
    }

    // Mark no-show — no refund
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'NO_SHOW' },
    });

    // Release the seat
    await tx.trip.update({
      where: { id: tripId },
      data: { confirmedSeats: { decrement: 1 } },
    });

    logger.info('Rider no-show recorded', { tripId, bookingId });
    return { bookingId };
  });
}

async function scheduleTrip(userId, { routeId, scheduledAt, seatCount = 1 }) {
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw new NotFoundError('Route');

  const departureTime = new Date(scheduledAt);
  if (isNaN(departureTime.getTime())) throw new AppError('Invalid scheduledAt date', 400);
  if (departureTime <= new Date()) throw new AppError('Scheduled time must be in the future', 400);

  // Cap how far out a rider can schedule — nothing processes intents indefinitely into the future.
  const maxAheadMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  if (departureTime.getTime() - Date.now() > maxAheadMs) {
    throw new AppError('Trips can only be scheduled up to 30 days in advance', 400, 'SCHEDULE_TOO_FAR_OUT');
  }

  // Check user doesn't already have a scheduled booking OR a pending scheduled-ride
  // intent for the same route/time window (±30 min). This flow only ever writes to
  // ScheduledRideIntent, so both tables must be checked — a Booking-only check never
  // actually blocks a repeat schedule attempt.
  const windowStart = new Date(departureTime.getTime() - 30 * 60 * 1000);
  const windowEnd   = new Date(departureTime.getTime() + 30 * 60 * 1000);
  const [existingBooking, existingIntent] = await Promise.all([
    prisma.booking.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'CONFIRMED', 'SEAT_HELD'] },
        trip: { routeId, departureTime: { gte: windowStart, lte: windowEnd } },
      },
    }),
    prisma.scheduledRideIntent.findFirst({
      where: {
        userId,
        routeId,
        status: 'PENDING',
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
    }),
  ]);
  if (existingBooking || existingIntent) {
    throw new AppError('You already have a booking or scheduled ride on this route around that time', 409, 'DUPLICATE_SCHEDULE');
  }

  const scheduledIntent = await prisma.scheduledRideIntent.create({
    data: {
      userId,
      routeId,
      scheduledAt: departureTime,
      seatCount,
      status: 'PENDING',
    },
  });

  return scheduledIntent;
}

/**
 * List the calling rider's scheduled ride intents (upcoming + past), newest scheduledAt first.
 */
async function getScheduledRides(userId) {
  return prisma.scheduledRideIntent.findMany({
    where: { userId },
    include: { route: { select: { originName: true, destinationName: true } } },
    orderBy: { scheduledAt: 'desc' },
  });
}

/**
 * Cancel a rider's own pending scheduled-ride intent.
 */
async function cancelScheduledRide(userId, intentId) {
  const intent = await prisma.scheduledRideIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new NotFoundError('ScheduledRideIntent');
  if (intent.userId !== userId) throw new ForbiddenError();
  if (intent.status !== 'PENDING') {
    throw new AppError('Only a pending scheduled ride can be cancelled', 400, 'INVALID_STATUS');
  }
  return prisma.scheduledRideIntent.update({ where: { id: intentId }, data: { status: 'CANCELLED' } });
}

/**
 * Periodic worker (called from server.js on an interval): processes ScheduledRideIntent
 * rows whose scheduledAt has arrived or is imminent. For each PENDING intent:
 *   1. Try to seat the rider on an existing Trip for the same route within a ±30 min window.
 *   2. If no Trip exists, hand it off to the same live on-demand dispatch used by
 *      "Request a Trip" so nearby drivers get notified close to the actual pickup time,
 *      instead of silently doing nothing (the previous behavior).
 * Intents whose scheduledAt has passed by more than 1 hour with no match are marked EXPIRED.
 */
async function processScheduledRideIntents() {
  const now = new Date();
  const lookAheadMs = 15 * 60 * 1000; // start trying to match 15 min before departure
  const dispatchHorizon = new Date(now.getTime() + lookAheadMs);

  const dueIntents = await prisma.scheduledRideIntent.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: dispatchHorizon } },
    include: { route: true },
  });

  for (const intent of dueIntents) {
    try {
      const staleMs = now.getTime() - intent.scheduledAt.getTime();
      if (staleMs > 60 * 60 * 1000) {
        // Over an hour past its scheduled time with nobody having matched it — give up.
        await prisma.scheduledRideIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
        continue;
      }

      const windowStart = new Date(intent.scheduledAt.getTime() - 30 * 60 * 1000);
      const windowEnd = new Date(intent.scheduledAt.getTime() + 30 * 60 * 1000);

      const candidateTrip = await prisma.trip.findFirst({
        where: {
          routeId: intent.routeId,
          status: { in: ['SCHEDULED', 'FILLING'] },
          departureTime: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { confirmedSeats: 'desc' }, // prefer filling up an already-popular trip
      });

      if (candidateTrip && candidateTrip.confirmedSeats + intent.seatCount <= candidateTrip.maxSeats) {
        const fare = calculateFare({
          tier: candidateTrip.tier,
          distanceKm: intent.route.distanceKm,
          seatCount: candidateTrip.maxSeats,
          storedBaseFare: candidateTrip.baseFare,
          storedPerKmRate: candidateTrip.perKmRate,
          surgeMultiplier: candidateTrip.surgeMultiplier,
        });

        await prisma.$transaction(async (tx) => {
          await tx.booking.create({
            data: {
              tripId: candidateTrip.id,
              userId: intent.userId,
              fareAmount: fare.farePerPerson,
              commissionAmount: fare.commissionPerSeat,
              paymentMethod: 'CASH',
              paymentStatus: 'PENDING',
              status: 'SEAT_HELD',
            },
          });
          await tx.trip.update({
            where: { id: candidateTrip.id },
            data: { confirmedSeats: { increment: intent.seatCount } },
          });
          await tx.scheduledRideIntent.update({
            where: { id: intent.id },
            data: { status: 'MATCHED', matchedTripId: candidateTrip.id },
          });
        });

        const rider = await prisma.user.findUnique({ where: { id: intent.userId }, select: { fcmToken: true } });
        if (rider?.fcmToken) {
          await pushService.sendPush(
            rider.fcmToken,
            'Scheduled ride confirmed',
            `A seat has been booked for your ${intent.route.destinationName} trip.`,
            { type: 'SCHEDULE_MATCHED', tripId: candidateTrip.id },
          ).catch(() => {});
        }
        logger.info('Scheduled ride matched to existing trip', { intentId: intent.id, tripId: candidateTrip.id });
      } else {
        // No existing trip to seat them on — dispatch it live to nearby drivers now,
        // close to the actual pickup time, instead of leaving it unprocessed forever.
        const tripRequestService = require('./trip-request.service');
        await tripRequestService.createRequest(intent.userId, {
          destination: intent.route.destinationName,
          scheduledAt: intent.scheduledAt.toISOString(),
          seatCount: intent.seatCount,
          pickupLat: intent.route.originLat,
          pickupLng: intent.route.originLng,
          destLat: intent.route.destLat,
          destLng: intent.route.destLng,
        });
        // Mark as handed off so this worker doesn't keep re-dispatching it every tick.
        await prisma.scheduledRideIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
        logger.info('Scheduled ride handed off to live dispatch (no matching trip)', { intentId: intent.id });
      }
    } catch (err) {
      logger.warn('Failed to process scheduled ride intent (non-blocking):', { intentId: intent.id, error: err.message });
    }
  }

  return { processed: dueIntents.length };
}

async function getTrackingData(shortId) {
  const trip = await prisma.trip.findUnique({
    where: { shortId },
    include: {
      route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true, currentHeading: true } },
      vehicle: { select: { make: true, model: true, plateNumber: true, tier: true } },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  return {
    tripId: trip.id,
    shortId: trip.shortId,
    status: trip.status,
    tier: trip.tier,
    departureTime: trip.departureTime,
    arrivedAt: trip.arrivedAt,
    route: trip.route,
    driver: trip.driver ? {
      name: trip.driver.name,
      profilePhoto: trip.driver.profilePhoto,
      lat: trip.driver.currentLat,
      lng: trip.driver.currentLng,
      heading: trip.driver.currentHeading,
    } : null,
    vehicle: trip.vehicle,
    confirmedSeats: trip.confirmedSeats,
    maxSeats: trip.maxSeats,
  };
}

module.exports = { createTrip, getTrip, getTripByShareToken, getSeatMap, getPulseSchedules, searchTrips, getActiveTrip, completeTrip, getTripReceipt, driverNoShow, riderNoShow, scheduleTrip, getTrackingData, getScheduledRides, cancelScheduledRide, processScheduledRideIntents, saveLiveActivityToken, clearLiveActivityToken };
