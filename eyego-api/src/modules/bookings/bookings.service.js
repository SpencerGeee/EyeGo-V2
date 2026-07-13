'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const { calculateFare, calculateEnRouteFare } = require('../trips/fare.calculator');
const { SeatTakenError, NotFoundError, AppError, ForbiddenError } = require('../../utils/errors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const SEAT_HOLD_MS = env.SEAT_HOLD_DURATION_MINUTES * 60 * 1000;

// Map the rider-facing method to a value we persist on the booking.
// MoMo defaults to the MTN provider key Paystack expects; the rider can still
// pay with another network at the prompt. CASH/WALLET/CARD are stored verbatim.
const VALID_PAYMENT_METHODS = ['MOMO', 'CARD', 'CASH', 'WALLET', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO'];
function normalizePaymentMethod(method) {
  if (!method) return 'MOMO_MTN';
  if (method === 'MOMO') return 'MOMO_MTN';
  if (!VALID_PAYMENT_METHODS.includes(method)) return 'MOMO_MTN';
  return method;
}

async function bookSeat(userId, tripId, seatNumber, pickupStopId = null, paymentMethod = null, guestName = null, guestPhone = null) {
  // Use $transaction with Serializable isolation to prevent race conditions.
  // This ensures two riders can't book the same seat simultaneously and the
  // capacity check races are eliminated.
  return prisma.$transaction(
    async (tx) => {
      // Re-read trip INSIDE the serializable transaction so we see the latest state
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: { route: { include: { virtualStops: { where: { isActive: true } } } } },
      });
      if (!trip) throw new NotFoundError('Trip');
      if (!['SCHEDULED', 'FILLING'].includes(trip.status)) {
        throw new AppError('This trip is no longer accepting bookings', 400, 'TRIP_UNAVAILABLE');
      }

      // ── Capacity guard: ensure there's still room ───────────────────────
      // Count non-cancelled bookings to get the true number of occupied seats
      const activeBookingCount = await tx.booking.count({
        where: { tripId, status: { notIn: ['CANCELLED'] } },
      });
      if (activeBookingCount >= trip.maxSeats) {
        throw new AppError('This trip is full', 400, 'TRIP_FULL');
      }

      // Cancel any existing SEAT_HELD booking this user already has on this trip
      // (handles the "go back and pick a different seat" flow — prevents ghost bookings)
      // Null the seatNumber too — otherwise the cancelled row keeps its old
      // seatNumber and re-picking the same (or that) seat collides on the
      // @@unique([tripId, seatNumber]) constraint.
      await tx.booking.updateMany({
        where: { tripId, userId, status: 'SEAT_HELD' },
        data: { status: 'CANCELLED', seatNumber: null },
      });

      // Check seat is not already taken by someone else
      const existing = await tx.booking.findFirst({
        where: { tripId, seatNumber, status: { notIn: ['CANCELLED'] } },
      });
      if (existing) throw new SeatTakenError();

      // Calculate fare using maxSeats as the denominator — this is the fixed
      // capacity the driver set for the trip and matches the listing price exactly.
      const fareData = calculateFare({
        tier: trip.tier,
        distanceKm: trip.route.distanceKm,
        seatCount: trip.maxSeats,
        doorstepPickup: trip.doorstepPickup,
        heavyLoad: trip.heavyLoad,
        surgeMultiplier: trip.surgeMultiplier,
        storedBaseFare: trip.baseFare,
        storedPerKmRate: trip.perKmRate,
      });

      // En-route boarding: if a virtual stop was selected, apply a distance-
      // proportional discount (rider travels less of the route → pays less).
      let finalFareAmount = fareData.farePerPerson;
      let finalCommission = fareData.commissionPerSeat;
      let enRouteRatio = null;
      let resolvedPickupStopId = null;

      if (pickupStopId) {
        const stop = trip.route.virtualStops.find((s) => s.id === pickupStopId);
        if (!stop) throw new AppError('Invalid pickup stop for this route', 400, 'INVALID_STOP');

        const enRoute = calculateEnRouteFare({
          fullFarePerSeat: fareData.farePerPerson,
          stopLat: stop.lat,
          stopLng: stop.lng,
          destLat: trip.route.destLat,
          destLng: trip.route.destLng,
          totalRouteKm: trip.route.distanceKm,
        });

        finalFareAmount = enRoute.farePerSeat;
        finalCommission = Math.round(finalFareAmount * env.PLATFORM_COMMISSION * 100) / 100;
        enRouteRatio = enRoute.ratio;
        resolvedPickupStopId = pickupStopId;
      }

      const boardingQr = crypto.randomBytes(16).toString('hex');
      const holdExpiry = new Date(Date.now() + SEAT_HOLD_MS);

      const booking = await tx.booking.create({
        data: {
          tripId,
          userId,
          seatNumber,
          fareAmount: finalFareAmount,
          commissionAmount: finalCommission,
          paymentMethod: normalizePaymentMethod(paymentMethod),
          status: 'SEAT_HELD',
          boardingQr,
          guestName,
          guestPhone,
          ...(resolvedPickupStopId && { pickupStopId: resolvedPickupStopId, enRouteRatio }),
        },
      });

      // Update trip status to FILLING if first booking
      if (trip.status === 'SCHEDULED') {
        await tx.trip.update({ where: { id: tripId }, data: { status: 'FILLING' } });
      }

      return { booking, fareData, holdExpiry };
    },
    {
      isolationLevel: 'Serializable', // Prevent double-booking race conditions
      maxWait: 5000, // Wait up to 5s for the transaction to begin
      timeout: 10000, // Abort after 10s if the transaction hasn't completed
    },
  );
}

async function createRideGroup(tripId, userId, isCoverAll = false) {
  // Wrap in serializable transaction to eliminate TOCTOU race between check and insert.
  // Without this, concurrent calls could both see no existing group and both create one,
  // violating the unique constraint or creating duplicate groups.
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.rideGroup.findUnique({ where: { tripId } });
      if (existing) return existing;

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h — matches generateInvite
      return tx.rideGroup.create({
        data: { tripId, leadPassengerId: userId, isCoverAll, expiresAt },
      });
    },
    { isolationLevel: 'Serializable', maxWait: 3000, timeout: 5000 },
  );
}

async function cancelBooking(bookingId, userId, { reason, note } = {}) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { status: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  // Guest bookings have userId=null — allow cancellation by any authenticated user.
  // Authenticated user bookings still require ownership.
  if (booking.userId !== null && booking.userId !== userId) throw new ForbiddenError();
  if (booking.paymentStatus === 'PAID') {
    throw new AppError('Cannot cancel a paid booking here. Contact support.', 400, 'BOOKING_PAID');
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', seatNumber: null },
  });

  // If this was the last active booking on the trip and the trip hasn't started,
  // revert the trip status back to SCHEDULED so it still shows up in search
  try {
    const activeCount = await prisma.booking.count({
      where: {
        tripId: booking.tripId,
        status: { not: 'CANCELLED' },
      },
    });
    if (activeCount === 0 && booking.trip?.status === 'FILLING') {
      await prisma.trip.update({
        where: { id: booking.tripId },
        data: { status: 'SCHEDULED' },
      });
    }
  } catch (_) {
    // Non-blocking
  }

  return updated;
}

async function getUserBookings(userId, page = 1, limit = 20, status) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;
  const where = { userId };
  if (status) {
    // Support comma-separated statuses: "CONFIRMED,SEAT_HELD,BOARDED"
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      where.status = statuses[0];
    } else if (statuses.length > 1) {
      where.status = { in: statuses };
    }
  }
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        trip: {
          include: {
            route: true,
            driver: { select: { name: true, profilePhoto: true } },
            vehicle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);

  // Fetch passenger ratings (how driver rated each passenger) in a separate
  // query — Booking model has no direct Prisma relation to PassengerRating,
  // so we join on userId + tripId manually.
  let enrichedBookings = bookings;
  if (bookings.length > 0) {
    const tripIds = [...new Set(bookings.map(b => b.tripId))];
    const userIds = [...new Set(bookings.map(b => b.userId).filter(Boolean))];
    const passengerRatings = userIds.length > 0 && tripIds.length > 0
      ? await prisma.passengerRating.findMany({
          where: { userId: { in: userIds }, tripId: { in: tripIds } },
          select: { userId: true, tripId: true, stars: true },
        })
      : [];
    const ratingMap = new Map(
      passengerRatings.map(r => [`${r.userId}:${r.tripId}`, r.stars])
    );
    enrichedBookings = bookings.map(b => ({
      ...b,
      passengerRating: b.userId ? (ratingMap.get(`${b.userId}:${b.tripId}`) ?? null) : null,
    }));
  }

  return { bookings: enrichedBookings, total, page: Math.max(1, parseInt(page) || 1), totalPages: Math.ceil(total / take) };
}

async function getBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      trip: { include: { route: true, driver: { select: { name: true, profilePhoto: true } } } },
    },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();
  return booking;
}

async function rateBooking(userId, bookingId, { rating, comment }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { include: { driver: { select: { name: true, fcmToken: true } } } }, user: { select: { name: true } } }
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError('Not authorized');

  const stars = Number(rating);
  if (isNaN(stars) || stars < 1 || stars > 5) {
    throw new AppError('Stars must be an integer between 1 and 5', 400);
  }

  const driverRating = await prisma.driverRating.upsert({
    where: {
      userId_tripId: {
        userId,
        tripId: booking.tripId,
      }
    },
    update: {
      stars,
      comment: comment ?? undefined,
    },
    create: {
      driverId: booking.trip.driverId,
      userId,
      tripId: booking.trip.id,
      stars,
      comment,
    }
  });

  // ── Push notification to driver ───────────────────────────────────
  setImmediate(async () => {
    try {
      const pushService = require('../../services/push.service');
      const riderName = booking.user?.name || 'A rider';
      const starEmoji = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'][stars] || '⭐';
      if (booking.trip?.driver?.fcmToken) {
        await pushService.sendPush(
          booking.trip.driver.fcmToken,
          `🚀 New rating: ${stars}/5`,
          `${riderName} rated you ${starEmoji}`,
          { type: 'DRIVER_RATING', tripId: booking.tripId, stars: String(stars) },
        );
      }
    } catch (err) {
      // Non-blocking
    }
  });

  return driverRating;
}

async function applyPromoCode(userId, bookingId, code) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: true }
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.userId !== userId) throw new ForbiddenError();
    if (booking.paymentStatus === 'PAID') {
      throw new AppError('Cannot apply promo to a paid booking', 400);
    }
    if (booking.promotionId) {
      throw new AppError('Booking already has a promo code applied', 400);
    }

    const promo = await tx.promotion.findUnique({ where: { code } });
    if (!promo) throw new NotFoundError('Promotion');
    if (!promo.active || promo.expiry < new Date()) {
      throw new AppError('Promotion is inactive or expired', 400);
    }
    if (promo.maxRedemptions != null && promo.usageCount >= promo.maxRedemptions) {
      throw new AppError('Promo code has reached its usage limit', 400);
    }

    // Calculate discount
    let discount = (booking.fareAmount * promo.discountPercent) / 100;
    if (discount > promo.maxDiscount) {
      discount = promo.maxDiscount;
    }

    const newFare = Math.max(0, booking.fareAmount - discount);

    const [updatedBooking] = await Promise.all([
      tx.booking.update({
        where: { id: bookingId },
        data: { promotionId: promo.id, fareAmount: newFare },
      }),
      tx.promotion.update({
        where: { id: promo.id },
        data: { usageCount: { increment: 1 } },
      }),
    ]);

    return { booking: updatedBooking, discountApplied: discount };
  });
}

async function getActiveBooking(userId) {
  const booking = await prisma.booking.findFirst({
    where: {
      userId,
      status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
      trip: { status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] } },
    },
    include: {        trip: {
          include: {
            route: true,
            driver: { select: { name: true, profilePhoto: true } }, // phone intentionally excluded — use contact relay
            vehicle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return booking ?? null;
}

async function tipDriver(userId, bookingId, { amount, phone }) {
  const { v4: uuidv4 } = require('uuid');
  const paystack = require('../payments/paystack.client');

  if (!amount || amount <= 0) throw new AppError('Tip amount must be greater than 0', 400);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, trip: { include: { driver: { select: { fcmToken: true } } } } },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.userId !== userId) throw new ForbiddenError();

    const reference = `eyego_tip_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const email = booking.user?.email || `${booking.user.phone}@eyego.app`;
    const payPhone = phone || booking.user.phone;

    const result = await paystack.initiateMomoCharge({
      email,
      amount,
      phone: payPhone,
      method: booking.paymentMethod || 'MOMO_MTN',
      reference,
      metadata: { bookingId, userId, type: 'TIP' },
    });

    await tx.paymentTransaction.create({
      data: {
        bookingId,
        userId: booking.userId,
        amount,
        status: 'INTENT',
        paystackRef: reference,
        gatewayResponse: 'TIP',
      },
    });

    // ── Push notification to driver ───────────────────────────────────
    setImmediate(async () => {
      try {
        const pushService = require('../../services/push.service');
        if (booking.trip?.driver?.fcmToken) {
          const driver = await prisma.driver.findUnique({
            where: { id: booking.trip.driverId },
            select: { name: true },
          });
          const riderName = booking.user?.name || 'A rider';
          await pushService.sendPush(
            booking.trip.driver.fcmToken,
            `💰 ${riderName} sent you a tip!`,
            `GHS ${Number(amount).toFixed(2)} tip received for trip #${booking.tripId.slice(0, 8)}`,
            { type: 'TIP', bookingId, amount: String(amount) },
          );
        }
      } catch (err) {
        // Non-blocking
      }
    });

    return { reference, ...result };
  });
}

async function submitDispute(userId, bookingId, { type, description }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { shortId: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

  const subject = `Dispute — ${type} — Booking #${bookingId.slice(0, 8)}`;

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId,
        subject,
        status: 'OPEN',
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: userId,
        senderRole: 'USER',
        text: `Issue type: ${type}\n\nDescription: ${description || 'No description provided.'}`,
      },
    });

    return ticket;
  });
}

async function generateInvite(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { trip: { select: { id: true, status: true, maxSeats: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');

  // Upsert: create group if it doesn't exist, otherwise return existing
  const group = await prisma.rideGroup.upsert({
    where: { tripId: booking.tripId },
    update: {},
    create: {
      tripId: booking.tripId,
      leadPassengerId: userId,
      shareToken: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  const inviteLink = `${env.APP_URL}/invite/${group.shareToken}`;
  return { inviteToken: group.shareToken, inviteLink };
}

// Regenerate a new share token for an existing ride group (token rotation).
// This invalidates the old invite link — any previously shared link will
// stop working. Useful if the old token was leaked or compromised.
async function regenerateInvite(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { trip: { select: { id: true, group: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.trip.group) {
    // No group exists yet — delegate to generateInvite instead of erroring
    return generateInvite(bookingId, userId);
  }

  const group = await prisma.rideGroup.update({
    where: { id: booking.trip.group.id },
    data: {
      shareToken: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const inviteLink = `${env.APP_URL}/invite/${group.shareToken}`;
  return { inviteToken: group.shareToken, inviteLink };
}

async function getGroup(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: {
      trip: {
        include: {
          group: true,
          bookings: {
            where: { status: { notIn: ['CANCELLED'] } },
            include: { user: { select: { id: true, name: true, profilePhoto: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!booking) throw new NotFoundError('Booking');

  const group = booking.trip.group;
  const inviteLink = group ? `${env.APP_URL}/invite/${group.shareToken}` : '';

  const members = booking.trip.bookings
    .filter(b => b.userId !== userId) // exclude the requesting user (shown as "You")
    .map(b => ({
      bookingId: b.id,
      passengerName: b.user?.name ?? b.guestName ?? 'Passenger',
      avatarUrl: b.user?.profilePhoto ?? null,
      seatNumber: b.seatNumber,
      joinedAt: b.createdAt.toISOString(),
    }));

  return {
    id: group?.id ?? '',
    inviteToken: group?.shareToken ?? '',
    inviteLink,
    hostBookingId: bookingId,
    members,
    maxSize: booking.trip.maxSeats,
  };
}

async function joinGroup(shareToken) {
  const group = await prisma.rideGroup.findUnique({
    where: { shareToken },
    // BUGFIX: the Route model field is `destinationName`, not `destName`. The old
    // select referenced a non-existent field, so Prisma threw on every call and
    // EVERY joiner saw "Invalid Link" — the join flow was fully broken. We also
    // include the coords + baseFare/seat fields the join screen renders.
    include: {
      trip: {
        include: { route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } } },
      },
    },
  });
  if (!group) throw new NotFoundError('Invite link is invalid');
  if (group.expiresAt < new Date()) throw new AppError('This invite link has expired', 410, 'INVITE_EXPIRED');

  return { tripId: group.tripId, trip: group.trip };
}

module.exports = { bookSeat, normalizePaymentMethod, createRideGroup, generateInvite, regenerateInvite, getGroup, joinGroup, cancelBooking, getUserBookings, getBooking, rateBooking, applyPromoCode, getActiveBooking, tipDriver, submitDispute };
