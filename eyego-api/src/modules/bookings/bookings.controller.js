'use strict';

const { formatGhs, assertPesewas, percentOf } = require('../../utils/money');

const bookingsService = require('./bookings.service');
const { ok, created } = require('../../utils/response');
const { AppError } = require('../../utils/errors');

const updatePickup = async (req, res) => {
  const { lat, lng, address } = req.body;
  // Validated (validate.js runs express-validator checks before this handler) — lat/lng must
  // be finite numbers if present, so a malformed request 400s instead of writing NaN into
  // the booking's fareAmountPesewas/commissionAmountPesewas.
  const booking = await bookingsService.recomputeBookingAddons(req.params.bookingId, req.user.userId, {
    pickupLat: lat != null ? Number(lat) : undefined,
    pickupLng: lng != null ? Number(lng) : undefined,
    pickupAddress: address,
  });

  /**
   * THE DRIVER IS THE PERSON THIS CHANGE IS ABOUT.
   *
   * BUGFIX ("i chose to update the pickup point to my selected one, but it's not
   * showing on the driver app that a new pickup point has been selected by the
   * rider, so the driver knows to go to the updated pickup point").
   *
   * This handler recomputed the fare and returned 200, and that was the whole of
   * it — no socket frame, no push, nothing written to any channel the driver app
   * listens on. The rider moved their pickup, was charged the new deviation
   * surcharge for it, and the driver kept navigating to the old point. The money
   * side of the feature was wired and the operational side was not.
   *
   * Three deliveries, deliberately: the seat frame carries the new booking rows
   * so the driver's passenger list repaints; the named event is the announcement
   * (the seat frame is silent by design); and the push covers a driver whose app
   * is backgrounded, which is most of the time while they are driving.
   */
  try {
    const prisma = require('../../config/database');
    const publisher = require('../../services/trip-events.publisher');
    const full = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      select: {
        tripId: true,
        seatNumber: true,
        pickupLat: true,
        pickupLng: true,
        pickupAddress: true,
        user: { select: { name: true } },
        trip: { select: { driverId: true, driver: { select: { fcmToken: true } } } },
      },
    });

    if (full?.tripId) {
      publisher.publishSeatUpdate(full.tripId).catch(() => {});

      const io = req.app.get('io');
      const who = full.user?.name ?? 'A passenger';
      const where = full.pickupAddress ?? 'a new pickup point';
      if (io && full.trip?.driverId) {
        io.of('/driver').to(`driver:${full.trip.driverId}`).emit('trip:pickup_changed', {
          tripId: full.tripId,
          bookingId: req.params.bookingId,
          seatNumber: full.seatNumber ?? null,
          passengerName: who,
          pickupLat: full.pickupLat ?? null,
          pickupLng: full.pickupLng ?? null,
          pickupAddress: full.pickupAddress ?? null,
        });
      }
      if (full.trip?.driver?.fcmToken) {
        require('../../services/push.service')
          .sendPush(
            full.trip.driver.fcmToken,
            'Pickup point changed',
            `${who} is now waiting at ${where}`,
            { type: 'PICKUP_CHANGED', tripId: full.tripId },
          )
          .catch(() => {});
      }
    }
  } catch {
    // Never fail the rider's own update because a notification could not go out.
  }

  ok(res, booking);
};

const updateHeavyCargo = async (req, res) => {
  const { heavyCargo } = req.body;
  const booking = await bookingsService.recomputeBookingAddons(req.params.bookingId, req.user.userId, {
    heavyCargo: !!heavyCargo,
  });
  ok(res, booking);
};

const bookSeat = async (req, res) => {
  const tripId = req.params.tripId || req.params.id || req.body.tripId;
  let { seatNumber } = req.body;
  if (!seatNumber && req.body.seatId) {
    seatNumber = parseInt(req.body.seatId.toString().replace('seat-', ''), 10);
  }
  const { pickupStopId, paymentMethod, guestName, guestPhone, pickupLat, pickupLng, pickupAddress } = req.body;
  // A group-hub joiner's own pickup point (differs from the trip's main pickup) — null
  // when boarding at the trip's own pickup, the common case.
  const joinerPickup = pickupLat != null && pickupLng != null ? { lat: pickupLat, lng: pickupLng, address: pickupAddress ?? null } : null;
  const result = await bookingsService.bookSeat(req.user.userId, tripId, seatNumber, pickupStopId ?? null, paymentMethod ?? null, guestName ?? null, guestPhone ?? null, joinerPickup);

  // Emit real-time seat update to passengers and driver
  try {
    const io = req.app.get('io');
    if (io) {
      const prisma = require('../../config/database');
      const publisher = require('../../services/trip-events.publisher');
      // One publisher, so the frame carries the booking rows the driver screen
      // actually reads and not just the rider's seat map — see the note on
      // `publishSeatUpdate`. Not awaited: the rider's response should not wait
      // on a broadcast.
      publisher.publishSeatUpdate(tripId).catch(() => {});
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { driverId: true, driver: { select: { fcmToken: true } } },
      });
      if (trip?.driverId) {
        const who =
          result?.booking?.guestName ||
          result?.booking?.user?.name ||
          guestName ||
          'A passenger';
        const seat = result?.booking?.seatNumber ?? seatNumber ?? null;

        /**
         * AND ON A PHONE THAT IS NOT IN THE DRIVER'S HAND.
         *
         * The socket frame below only lands if the app is foregrounded and
         * connected — which for a driver waiting on passengers is the minority
         * case, and is never true on the same handset the rider just booked
         * from. A push is the only path that survives a suspended app.
         */
        if (trip.driver?.fcmToken) {
          require('../../services/push.service')
            .sendPush(
              trip.driver.fcmToken,
              'New passenger',
              seat != null ? `${who} booked seat ${seat}` : `${who} booked a seat`,
              { type: 'PASSENGER_JOINED', tripId },
            )
            .catch(() => {});
        }

        /**
         * TELL THE DRIVER SOMEBODY JUST GOT ON.
         *
         * BUGFIX ("when I booked using an invite the driver got a popup saying
         * someone just paid, but when I book directly from the suggested trip
         * card nothing happens — it just shows on the driver side"). Both halves
         * were accurate. The invite flow ends in a payment, and payment
         * settlement calls `notifyRideConfirmed` → `passengerJoined`. A direct
         * booking settles later or not at all (cash), so the only thing this
         * path ever emitted was `trip:seat_update` — a silent data frame whose
         * entire job is to refresh a seat map. The seat quietly changed colour
         * and nothing announced it.
         *
         * A named event rather than a second push: the driver is holding the
         * phone in this scenario, and the payment push still fires later when
         * the money actually arrives. Two banners for "reserved" and "paid" is
         * two real events, not a duplicate.
         */
        io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:passenger_joined', {
          tripId,
          seatNumber: seat,
          passengerName: who,
        });
      }
    }
  } catch (err) {
    // Non-blocking
  }

  created(res, result, 'Seat held for 10 minutes. Complete payment to confirm.');
};

const createGroup = async (req, res) => {
  const tripId = req.params.tripId || req.params.id;
  const { isCoverAll } = req.body;
  const group = await bookingsService.createRideGroup(tripId, req.user.userId, isCoverAll);
  ok(res, { group });
};

const cancelBooking = async (req, res) => {
  const { reason, note } = req.body || {};
  const result = await bookingsService.cancelBooking(req.params.bookingId, req.user.userId, { reason, note });
  ok(res, null, 'Booking cancelled');
};

const getUserBookings = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const result = await bookingsService.getUserBookings(req.user.userId, Number(page), Number(limit), status);
  ok(res, result);
};

const getBooking = async (req, res) => {
  const booking = await bookingsService.getBooking(req.params.bookingId, req.user.userId);
  ok(res, { booking });
};

const rateBooking = async (req, res) => {
  const rating = await bookingsService.rateBooking(req.user.userId, req.params.bookingId, req.body);
  ok(res, { rating }, 'Rating submitted successfully');
};

const applyPromoCode = async (req, res) => {
  const result = await bookingsService.applyPromoCode(req.user.userId, req.params.bookingId, req.body.code);
  ok(res, result, 'Promo code applied successfully');
};

const getActiveBooking = async (req, res) => {
  const booking = await bookingsService.getActiveBooking(req.user.userId);
  ok(res, { booking });
};

const tipDriver = async (req, res) => {
  /**
   * THREE NAMES FOR ONE NUMBER, AND NO TIP EVER WENT THROUGH.
   *
   * BUGFIX. The client sends `{ amountPesewas }` (bookings.api.ts `tip`), this
   * read `amount`, and `bookingsService.tipDriver` destructures `amountPesewas`
   * — so it received `{ amount: NaN }`, the service saw `amountPesewas:
   * undefined`, and `assertPesewas` threw on every single tip. The `parseFloat`
   * was the second half of the same mistake: it treats the value as CEDIS,
   * while every money column and every guard downstream is integer pesewas, so
   * even a correctly-named `5.50` would have been rejected as fractional.
   *
   * One name, one unit, no coercion. `amount` is still accepted so an installed
   * build that sends the old key keeps working — but read as pesewas, which is
   * what any client sending that key was already sending.
   */
  const { amountPesewas, amount, phone } = req.body || {};
  const result = await bookingsService.tipDriver(req.user.userId, req.params.bookingId, {
    amountPesewas: amountPesewas ?? amount,
    phone,
  });
  ok(res, result, 'Tip payment initiated');
};

const validatePromoCode = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ success: false, message: 'code is required' });
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const promo = await prisma.promotion.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.active || promo.expiry < new Date()) {
      return ok(res, { valid: false, message: 'Promo code is invalid or expired' });
    }
    if (promo.discountPercent < 0 || promo.discountPercent > 100) {
      throw new AppError('Invalid promo configuration', 500);
    }
    ok(res, {
      valid: true,
      code: promo.code,
      discountPercent: promo.discountPercent,
      maxDiscountPesewas: promo.maxDiscountPesewas,
      message: `${promo.discountPercent}% off (up to ${formatGhs(promo.maxDiscountPesewas)})`,
    });
  } finally {
    await prisma.$disconnect();
  }
};

const submitDispute = async (req, res) => {
  const { type, description } = req.body;
  const result = await bookingsService.submitDispute(req.user.userId, req.params.bookingId, { type, description });
  ok(res, { ticket: result }, 'Dispute submitted. We will review it within 24 hours.');
};

const generateInvite = async (req, res) => {
  const result = await bookingsService.generateInvite(req.params.bookingId, req.user.userId);
  ok(res, result);
};

const regenerateInvite = async (req, res) => {
  const result = await bookingsService.regenerateInvite(req.params.bookingId, req.user.userId);
  ok(res, result, 'New invite link generated. Old link invalidated.');
};

const getGroup = async (req, res) => {
  const result = await bookingsService.getGroup(req.params.bookingId, req.user.userId);
  ok(res, result);
};

const joinGroup = async (req, res) => {
  const result = await bookingsService.joinGroup(req.params.shareToken);
  ok(res, result);
};

module.exports = { bookSeat, createGroup, cancelBooking, getUserBookings, getBooking, rateBooking, applyPromoCode, validatePromoCode, getActiveBooking, tipDriver, submitDispute, generateInvite, regenerateInvite, getGroup, joinGroup, updatePickup, updateHeavyCargo };
