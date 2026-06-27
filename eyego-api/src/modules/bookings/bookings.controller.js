'use strict';

const bookingsService = require('./bookings.service');
const { ok, created } = require('../../utils/response');
const { AppError } = require('../../utils/errors');

const bookSeat = async (req, res) => {
  const tripId = req.params.tripId || req.params.id || req.body.tripId;
  let { seatNumber } = req.body;
  if (!seatNumber && req.body.seatId) {
    seatNumber = parseInt(req.body.seatId.toString().replace('seat-', ''), 10);
  }
  const { pickupStopId, paymentMethod, guestName, guestPhone } = req.body;
  const result = await bookingsService.bookSeat(req.user.userId, tripId, seatNumber, pickupStopId ?? null, paymentMethod ?? null, guestName ?? null, guestPhone ?? null);

  // Emit real-time seat update to passengers and driver
  try {
    const io = req.app.get('io');
    if (io) {
      const tripsService = require('../trips/trips.service');
      const prisma = require('../../config/database');
      const [seatMap, trip] = await Promise.all([
        tripsService.getSeatMap(tripId),
        prisma.trip.findUnique({ where: { id: tripId }, select: { driverId: true } }),
      ]);
      const seatPayload = { tripId, seatData: seatMap.seats };
      io.of('/passenger').to(`trip:${tripId}`).emit('trip:seat_update', seatPayload);
      if (trip?.driverId) {
        io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:seat_update', seatPayload);
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
  const { amount, phone } = req.body;
  const result = await bookingsService.tipDriver(req.user.userId, req.params.bookingId, { amount: parseFloat(amount), phone });
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
      maxDiscount: promo.maxDiscount,
      message: `${promo.discountPercent}% off (up to GHS ${promo.maxDiscount.toFixed(2)})`,
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

module.exports = { bookSeat, createGroup, cancelBooking, getUserBookings, getBooking, rateBooking, applyPromoCode, validatePromoCode, getActiveBooking, tipDriver, submitDispute, generateInvite, regenerateInvite, getGroup, joinGroup };
