'use strict';

const { Router } = require('express');
const authenticate = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const prisma = require('../../config/database');

const router = Router();

router.use(authenticate);

// Derive notifications from booking history — no separate Notification model needed
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);

  try {
    const bookings = await prisma.booking.findMany({
      where: { userId },
      include: {
        trip: {
          include: {
            route: { select: { originName: true, destinationName: true } },
            driver: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    const notifications = bookings.flatMap((b) => {
      const dest = b.trip?.route?.destinationName ?? 'destination';
      const driver = b.trip?.driver?.name ?? 'your driver';
      const items = [];

      if (b.status === 'COMPLETED') {
        items.push({
          id: `${b.id}:completed`,
          type: 'booking',
          title: 'Ride completed',
          body: `Your trip to ${dest} with ${driver} is complete. How was it?`,
          read: true,
          createdAt: b.updatedAt || b.createdAt,
          bookingId: b.id,
          tripId: b.tripId,
        });
      } else if (b.paymentStatus === 'PAID' && b.status !== 'CANCELLED') {
        items.push({
          id: `${b.id}:paid`,
          type: 'payment',
          title: 'Payment confirmed',
          body: `GHS ${b.fareAmount?.toFixed(2) ?? '—'} paid. Seat #${b.seatNumber} on your trip to ${dest}.`,
          read: false,
          createdAt: b.updatedAt || b.createdAt,
          bookingId: b.id,
          tripId: b.tripId,
        });
      } else if (['CONFIRMED', 'SEAT_HELD', 'BOARDED'].includes(b.status)) {
        items.push({
          id: `${b.id}:confirmed`,
          type: 'booking',
          title: 'Seat booked!',
          body: `Seat #${b.seatNumber} on your trip to ${dest} is confirmed.`,
          read: false,
          createdAt: b.createdAt,
          bookingId: b.id,
          tripId: b.tripId,
        });
      } else if (b.status === 'CANCELLED') {
        items.push({
          id: `${b.id}:cancelled`,
          type: 'booking',
          title: 'Booking cancelled',
          body: `Your booking for the trip to ${dest} was cancelled.`,
          read: true,
          createdAt: b.updatedAt || b.createdAt,
          bookingId: b.id,
          tripId: b.tripId,
        });
      }

      return items;
    });

    // Sort by most recent
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    ok(res, { notifications, total: notifications.length, page: 1, totalPages: 1 });
  } catch (err) {
    ok(res, { notifications: [], total: 0, page: 1, totalPages: 1 });
  }
});

router.get('/unread-count', async (req, res) => {
  const userId = req.user.userId;
  try {
    // Count bookings with active/paid status as "unread"
    const count = await prisma.booking.count({
      where: {
        userId,
        status: { in: ['CONFIRMED', 'SEAT_HELD', 'BOARDED'] },
        paymentStatus: 'PAID',
      },
    });
    ok(res, { count });
  } catch {
    ok(res, { count: 0 });
  }
});

// These are no-ops since we derive from bookings (no stored read state needed)
router.patch('/:id/read', (req, res) => {
  ok(res, null, 'Marked as read');
});

router.patch('/read-all', (req, res) => {
  ok(res, { updated: 0 }, 'All marked as read');
});

module.exports = router;
