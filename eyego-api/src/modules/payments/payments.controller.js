'use strict';

const paymentsService = require('./payments.service');
const { ok } = require('../../utils/response');

const initiatePayment = async (req, res) => {
  const { bookingId, phone, savedCardId, method } = req.body;
  const result = await paymentsService.initiatePayment({ userId: req.user.userId, bookingId, phone, savedCardId, method });
  const message =
    result.method === 'CASH'
      ? 'Booking confirmed. Pay your driver in cash on boarding.'
      : result.method === 'WALLET'
      ? 'Paid from your wallet. Booking confirmed.'
      : result.method === 'CARD'
      ? 'Opening secure card checkout...'
      : 'Payment initiated. Check your phone for the MoMo prompt.';
  ok(res, result, message);
};

const verifyPayment = async (req, res) => {
  const booking = await paymentsService.verifyPayment(req.params.reference, req.user.userId);
  
  // Emit real-time seat update to both passenger and driver namespace
  try {
    const io = req.app.get('io');
    if (io && booking && booking.tripId) {
      const tripsService = require('../trips/trips.service');
      const prismaVerify = require('../../config/database');
      const [seatMap, trip] = await Promise.all([
        tripsService.getSeatMap(booking.tripId),
        prismaVerify.trip.findUnique({ where: { id: booking.tripId }, select: { driverId: true } }),
      ]);
      const seatPayload = { tripId: booking.tripId, seatData: seatMap.seats };
      io.of('/passenger').to(`trip:${booking.tripId}`).emit('trip:seat_update', seatPayload);
      if (trip?.driverId) {
        io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:seat_update', seatPayload);
      }
    }
  } catch (err) {
    // Non-blocking
  }

  ok(res, { booking }, 'Payment verified');
};

// Raw body is needed for signature verification — set in app.js
const webhook = async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  await paymentsService.handleWebhook(req.rawBody, signature);

  // Parse the webhook event to emit real-time socket updates
  try {
    const event = JSON.parse(req.rawBody);
    if (event.event === 'charge.success') {
      const { reference, metadata } = event.data;
      const io = req.app.get('io');

      // Emit payment confirmation to the rider's personal room
      if (io && metadata?.userId) {
        io.of('/passenger').to(`user:${metadata.userId}`).emit('payment:confirmed', {
          reference,
          bookingId: metadata.bookingId,
          status: 'SUCCESS',
        });
      }

      // Also notify the driver about the payment
      if (io && metadata?.tripId && metadata?.bookingId) {
        const prismaWebhook = require('../../config/database');
        prismaWebhook.trip.findUnique({ where: { id: metadata.tripId }, select: { driverId: true } })
          .then((trip) => {
            if (trip?.driverId) {
              io.of('/driver').to(`driver:${trip.driverId}`).emit('payment:confirmed', {
                reference,
                bookingId: metadata.bookingId,
                tripId: metadata.tripId,
                status: 'SUCCESS',
              });
            }
          })
          .catch(() => {});
      }

      // Emit seat update if tripId is available
      if (io && metadata?.tripId) {
        const tripsService = require('../trips/trips.service');
        const prismaWebhook = require('../../config/database');
        const [seatMap, trip] = await Promise.all([
          tripsService.getSeatMap(metadata.tripId),
          prismaWebhook.trip.findUnique({ where: { id: metadata.tripId }, select: { driverId: true } }),
        ]);
        const seatPayload = { tripId: metadata.tripId, seatData: seatMap.seats };
        io.of('/passenger').to(`trip:${metadata.tripId}`).emit('trip:seat_update', seatPayload);
        if (trip?.driverId) {
          io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:seat_update', seatPayload);
        }
      }
    }
  } catch (err) {
    // Non-blocking — don't crash the webhook response
  }

  res.sendStatus(200);
};

module.exports = { initiatePayment, verifyPayment, webhook };
