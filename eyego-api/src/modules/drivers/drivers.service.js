'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const cloudinaryService = require('../../services/cloudinary.service');
const otpService = require('../../services/otp.service');
const smsService = require('../../services/sms.service');
const pushService = require('../../services/push.service');
const { NotFoundError, AppError, InsufficientWalletError, ForbiddenError } = require('../../utils/errors');
const { isWithinGhana } = require('../../services/mapbox.service');
const { generateTripReceipt } = require('../cancellation/cancellation.service');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const { estimateFare, calculateFare } = require('../trips/fare.calculator');
const { toCedis } = require('../../utils/money');

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
    confirmedSeats: occupancy,
    doorstepPickup: trip.doorstepPickup ?? false,
    heavyLoad: trip.heavyLoad ?? false,
    surgeMultiplier: trip.surgeMultiplier ?? 1.0,
    storedBaseFare: trip.baseFare,
    storedPerKmRate: trip.perKmRate,
  });
  return { ...trip, farePerSeat: fareInfo.farePerPerson };
}

async function getMe(driverId) {
  const [driver, totalTrips, ratingAgg] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true, phone: true, name: true, profilePhoto: true, dateOfBirth: true,
        status: true, isOnline: true, walletBalance: true,
        ghanaCardNumber: true, createdAt: true,
        vehicles: { where: { isActive: true } },
      },
    }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: { stars: true } }),
  ]);
  if (!driver) throw new NotFoundError('Driver');
  return {
    ...driver,
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
  if (driver.walletBalance < 0) {
    throw new AppError(
      `Account suspended — GHS ${Math.abs(driver.walletBalance).toFixed(2)} outstanding. Top up your wallet to go back online.`,
      402,
      'NEGATIVE_WALLET_BALANCE'
    );
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
  const trip = await prisma.trip.findFirst({
    where: {
      driverId,
      status: { in: ['SCHEDULED', 'CONFIRMED', 'DRIVER_EN_ROUTE', 'IN_PROGRESS', 'FILLING'] },
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
  };

  const field = fieldMap[type];
  if (field) {
    await prisma.driver.update({ where: { id: driverId }, data: { [field]: url } });
  }

  return { url, type };
}

async function startTrip(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
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

    // Close trip
    await tx.trip.update({
      where: { id: tripId },
      data: { status: 'COMPLETED', arrivedAt: new Date() },
    });

    // Complete ALL active bookings (CONFIRMED, SEAT_HELD, PAID, BOARDED)
    // This ensures cash riders (SEAT_HELD) also show up in the rider's past trips
    await tx.booking.updateMany({
      where: { tripId, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } },
      data: { status: 'COMPLETED' },
    });

    // Credit driver earnings
    const totalEarnings = trip.bookings.reduce((sum, b) => sum + toCedis(b.fareAmount * (1 - env.PLATFORM_COMMISSION)), 0);
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
        include: { user: { select: { fcmToken: true } } },
      });
      const originName = completedTrip.route?.originName ?? 'your stop';
      await Promise.all(
        bookings.map(b => {
          if (!b.user?.fcmToken) return null;
          return pushService.notifications.driverArrived(b.user.fcmToken, originName);
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
  // to prevent concurrent overbooking from two driver taps
  await prisma.$transaction(async (tx) => {
    const conflict = await tx.booking.findFirst({
      where: { tripId, seatNumber, status: { notIn: ['CANCELLED'] } },
    });
    if (conflict) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

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

    await tx.driver.update({
      where: { id: driverId },
      data: { walletBalance: { decrement: commissionAmount } },
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
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId },
    include: { trip: { where: { driverId } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.trip) throw new ForbiddenError();
  if (!booking.offlineOtp || booking.offlineOtp !== otp) {
    throw new AppError('Invalid OTP', 400, 'OTP_INVALID');
  }
  if (booking.offlineOtpExp < new Date()) throw new AppError('OTP expired', 400, 'OTP_EXPIRED');

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });

  return prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { offlineOtpVerified: true, status: 'BOARDED', paymentStatus: 'PAID' },
    });

    await tx.driver.update({
      where: { id: driverId },
      data: { walletBalance: { decrement: booking.commissionAmount } },
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
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId },
    include: { trip: { where: { driverId } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  return prisma.booking.update({ where: { id: bookingId }, data: { status: 'BOARDED' } });
}

async function cancelTrip(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
    throw new AppError('Trip cannot be cancelled in its current state', 400, 'INVALID_STATUS');
  }
  await prisma.booking.updateMany({
    where: { tripId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
    data: { status: 'CANCELLED', seatNumber: null },
  });
  return prisma.trip.update({
    where: { id: tripId },
    data: { status: 'CANCELLED' },
    include: { route: true },
  });
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

module.exports = {
  getMe, updateProfile, updateFcmToken, completeVerification, addVehicle,
  goOnline, goOffline, getActiveTrip, getTripHistory, getAllTrips, devActivate,
  startTrip, departTrip, arriveAtPickup, arriveTrip, cancelTrip,
  getTripById, acceptDispatch, declineDispatch, uploadDocument,
  addOfflinePassenger, addCashNoPhone, verifyOfflineOtp, boardPassenger,
  getPerformance, getRatings, getDocuments, updateEmergencyContact, updatePreferences, ratePassenger,
  setDestinationFilter, getDestinationFilter, deleteDestinationFilter,
  startShift, endShift, getCurrentShift, getShiftHistory,
  getEarningsBreakdown, getWalletTransactions,
  getSupportTickets, createSupportTicket, replyToTicket,
  scheduleInspection, getInspections,
  deleteMe, reportTrip,
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

// ── Ratings ────────────────────────────────────────────────────────
async function getRatings(driverId) {
  const [aggregate, allRatings, recent] = await Promise.all([
    prisma.driverRating.aggregate({ where: { driverId }, _avg: { stars: true }, _count: true }),
    prisma.driverRating.findMany({ where: { driverId }, select: { stars: true } }),
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

  return {
    average: aggregate._avg.stars ?? 5.0,
    total: aggregate._count,
    breakdown,
    compliments: [
      { label: 'Punctual', count: 12, icon: 'time-outline' },
      { label: 'Clean Car', count: 8, icon: 'car-outline' },
      { label: 'Safe Driving', count: 15, icon: 'shield-outline' },
    ],
    recent: recent.map((r) => ({
      tripId: r.tripId,
      stars: r.stars,
      comment: undefined,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ── Documents ──────────────────────────────────────────────────────
async function getDocuments(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { ghanaCardNumber: true, licensePhoto: true, profilePhoto: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const docs = [
    { id: 'license', type: 'DRIVERS_LICENSE', status: driver.licensePhoto ? 'VERIFIED' : 'MISSING', url: driver.licensePhoto ?? undefined },
    { id: 'ghana_card', type: 'VEHICLE_REGISTRATION', status: driver.ghanaCardNumber ? 'VERIFIED' : 'MISSING' },
    { id: 'profile', type: 'PROFILE_PHOTO', status: driver.profilePhoto ? 'VERIFIED' : 'MISSING', url: driver.profilePhoto ?? undefined },
  ];
  return docs;
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
      include: {
        trip: { select: { shortId: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.walletTransaction.count({ where: { driverId } }),
  ]);

  return {
    transactions: transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      balanceBefore: tx.balanceBefore,
      balanceAfter: tx.balanceAfter,
      tripShortId: tx.trip?.shortId ?? null,
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
  if (!user) return { tickets: [] };

  const tickets = await prisma.supportTicket.findMany({
    where: { userId: user.id },
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
