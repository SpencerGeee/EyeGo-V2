'use strict';

const redis = require('../config/redis');
const { notifications: pushNotifications } = require('../services/push.service');
const logger = require('../utils/logger');

const TRIP_ROOM = (tripId) => `trip:${tripId}`;
const LOCATION_CHANNEL = (driverId) => `driver:${driverId}:location`;

// Shared Redis subscriber for all passenger sockets
const sharedSubscriber = redis.duplicate();
const driverToTrips = new Map(); // driverId -> Set of tripIds
const driverSubCount = new Map(); // driverId -> total socket count

let isSharedSubscriberInitialized = false;

module.exports = function registerPassengerSocket(io, passengerNamespace) {
  if (!isSharedSubscriberInitialized) {
    isSharedSubscriberInitialized = true;
    sharedSubscriber.on('message', (channel, message) => {
      try {
        const parts = channel.split(':');
        const driverId = parts[1];
        const location = JSON.parse(message);
        
        const tripIds = driverToTrips.get(driverId);
        if (tripIds) {
          for (const tripId of tripIds) {
            passengerNamespace.to(TRIP_ROOM(tripId)).emit('driver:location', { driverId, ...location });
          }
        }
      } catch (err) {
        logger.error('Error processing driver location message:', err);
      }
    });
  }

  passengerNamespace.on('connection', (socket) => {
    const userId = socket.userId;
    logger.info(`Passenger connected: ${userId}`);

    // Join user-specific room so driver can send private messages
    socket.join(`user:${userId}`);

    let subscribedDriverId = null;
    let subscribedTripId = null;

    const cleanupSubscription = () => {
      if (subscribedDriverId) {
        const count = (driverSubCount.get(subscribedDriverId) || 0) - 1;
        if (count <= 0) {
          driverSubCount.delete(subscribedDriverId);
          driverToTrips.delete(subscribedDriverId);
          sharedSubscriber.unsubscribe(LOCATION_CHANNEL(subscribedDriverId)).catch(err => logger.error('Failed to unsubscribe:', err));
        } else {
          driverSubCount.set(subscribedDriverId, count);
          // Clean up tripId from the set if no sockets are left in the room
          const room = passengerNamespace.adapter.rooms.get(TRIP_ROOM(subscribedTripId));
          if (!room || room.size === 0) {
            const tripIds = driverToTrips.get(subscribedDriverId);
            if (tripIds) {
              tripIds.delete(subscribedTripId);
            }
          }
        }
        subscribedDriverId = null;
        subscribedTripId = null;
      }
    };

    // ── Join a trip room (for seat + status updates) ──────
    socket.on('passenger:join_trip_room', async ({ tripId, driverId, lastMessageTimestamp }) => {
      // Security Validation: Ensure passenger has a booking OR the trip is publicly open for booking
      try {
        const prisma = require('../config/database');
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { status: true, bookings: { select: { userId: true, status: true } } }
        });

        if (!trip) {
          socket.emit('error', { message: 'Trip not found', code: 'NOT_FOUND' });
          return;
        }

        const isPubliclyBooking = ['SCHEDULED', 'FILLING'].includes(trip.status);
        const hasBooking = trip.bookings.some(
          b => b.userId === userId && b.status !== 'CANCELLED'
        );

        if (!isPubliclyBooking && !hasBooking) {
          logger.warn(`Unauthorized access attempt: Passenger ${userId} trying to join trip room ${tripId} which is in status ${trip.status}`);
          socket.emit('error', { message: 'Not authorized for this trip room' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize passenger room join:', err);
        socket.emit('error', { message: 'Server authorization error', code: 'INTERNAL_ERROR' });
        return;
      }

      socket.join(TRIP_ROOM(tripId));
      logger.debug(`Passenger ${userId} joined trip room ${tripId}`);

      // Fetch and send chat message history
      // Includes all public messages + private messages addressed to this user
      try {
        const prisma = require('../config/database');
        const baseWhere = {
          tripId,
          OR: [
            { isPrivate: false },
            { senderId: userId },
            { recipientId: userId },
          ],
        };
        // Only send messages newer than lastMessageTimestamp on reconnects to
        // avoid re-delivering the full history on every reconnect.
        const where = lastMessageTimestamp
          ? { ...baseWhere, timestamp: { gt: new Date(lastMessageTimestamp) } }
          : baseWhere;
        const history = await prisma.message.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: 100,
        });
        socket.emit('chat:history', history.map(h => ({
          senderId: h.senderId,
          senderName: h.senderName,
          senderRole: h.senderRole,
          seatNumber: h.seatNumber,
          text: h.text,
          isPrivate: h.isPrivate ?? false,
          recipientId: h.recipientId,
          timestamp: h.timestamp.toISOString(),
        })));
      } catch (err) {
        logger.error('Failed to fetch chat history:', err);
      }

      // Subscribe to driver location via shared Redis subscriber
      if (driverId && driverId !== subscribedDriverId) {
        cleanupSubscription();

        subscribedDriverId = driverId;
        subscribedTripId = tripId;

        const count = (driverSubCount.get(driverId) || 0) + 1;
        driverSubCount.set(driverId, count);

        let tripIds = driverToTrips.get(driverId);
        if (!tripIds) {
          tripIds = new Set();
          driverToTrips.set(driverId, tripIds);
          sharedSubscriber.subscribe(LOCATION_CHANNEL(driverId)).catch(err => logger.error('Failed to subscribe:', err));
        }
        tripIds.add(tripId);
      }
    });

    socket.on('passenger:leave_trip_room', ({ tripId }) => {
      socket.leave(TRIP_ROOM(tripId));

      if (subscribedTripId === tripId) {
        cleanupSubscription();
      }
    });

    // ── Typing indicators ────────────────────────────────────────
    socket.on('chat:typing_start', ({ tripId }) => {
      if (!tripId || !userId) return;
      // Broadcast to driver and other passengers (exclude sender)
      socket.to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: userId,
        senderRole: 'PASSENGER',
        isTyping: true,
      });
      io.of('/driver').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: userId,
        senderRole: 'PASSENGER',
        isTyping: true,
      });
    });

    socket.on('chat:typing_stop', ({ tripId }) => {
      if (!tripId || !userId) return;
      socket.to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: userId,
        senderRole: 'PASSENGER',
        isTyping: false,
      });
      io.of('/driver').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: userId,
        senderRole: 'PASSENGER',
        isTyping: false,
      });
    });

    // ── Chat messages ──────────────────────────────────────────
    socket.on('chat:send', async ({ tripId, text, timestamp }) => {
      if (!tripId || !text) return;

      // Security Validation: Ensure sender has an active booking on this trip
      let booking = null;
      try {
        const prisma = require('../config/database');
        booking = await prisma.booking.findFirst({
          where: { tripId, userId, status: { not: 'CANCELLED' } },
          select: { seatNumber: true, id: true },
        });
        if (!booking) {
          logger.warn(`Unauthorized chat attempt: Passenger ${userId} tried sending message in trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
      } catch (err) {
        logger.error('Failed to validate chat sender authorization:', err);
        return;
      }

      const seatNumber = booking?.seatNumber ?? null;
      let senderName = '';
      try {
        const prisma = require('../config/database');
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) senderName = user.name;

        // Persist message in database with seat context
        await prisma.message.create({
          data: {
            tripId,
            senderId: userId,
            senderName,
            senderRole: 'PASSENGER',
            seatNumber,
            bookingId: booking?.id,
            isPrivate: false,
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          }
        });
      } catch (err) {
        logger.error('Failed to persist chat message:', err);
      }

      // Broadcast to both passenger and driver namespaces
      const messagePayload = {
        senderId: userId,
        senderName,
        senderRole: 'PASSENGER',
        seatNumber,
        text,
        isPrivate: false,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Direct echo to sender — guarantees delivery even if passenger:join_trip_room
      // hasn't resolved yet (async Prisma auth in that handler creates a race window).
      socket.emit('chat:message', messagePayload);

      // Broadcast to all clients in the trip room on passenger namespace
      passengerNamespace.to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);

      // Broadcast to driver namespace in the trip room
      io.of('/driver').to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);

      // Push notification to driver if they're not in the socket room
      try {
        const prisma = require('../config/database');
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driver: { select: { fcmToken: true } } },
        });
        if (trip?.driver?.fcmToken) {
          pushNotifications.chatMessage(trip.driver.fcmToken, senderName, text, tripId);
        }
      } catch (err) {
        logger.warn('Failed to send chat push to driver:', err.message);
      }
    });

    // ── Private chat (rider → the trip's driver) ──────────────────
    // Mirrors the driver-side chat:private_send so the rider's Private tab can
    // hold a 1-on-1 thread with the driver. recipientId is optional — it always
    // resolves to the trip's driver.
    socket.on('chat:private_send', async ({ tripId, text, recipientId, timestamp }) => {
      if (!tripId || !text) return;
      const clean = typeof text === 'string'
        ? text.trim().replace(/<[^>]*>/g, '').slice(0, 500)
        : '';
      if (!clean) return;

      try {
        const prisma = require('../config/database');
        // Sender must have an active booking on this trip
        const booking = await prisma.booking.findFirst({
          where: { tripId, userId, status: { not: 'CANCELLED' } },
          select: { id: true, seatNumber: true },
        });
        if (!booking) {
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driverId: true },
        });
        const driverId = recipientId || trip?.driverId;
        if (!driverId) {
          socket.emit('error', { message: 'No driver assigned to this trip', code: 'NO_DRIVER' });
          return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        const senderName = user?.name ?? '';

        await prisma.message.create({
          data: {
            tripId,
            senderId: userId,
            senderName,
            senderRole: 'PASSENGER',
            seatNumber: booking.seatNumber ?? null,
            bookingId: booking.id,
            isPrivate: true,
            recipientId: driverId,
            text: clean,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
        });

        const payload = {
          senderId: userId,
          senderName,
          senderRole: 'PASSENGER',
          seatNumber: booking.seatNumber ?? null,
          text: clean,
          isPrivate: true,
          recipientId: driverId,
          timestamp: timestamp || new Date().toISOString(),
        };

        // Deliver to the driver's personal room + echo to the sending rider
        io.of('/driver').to(`driver:${driverId}`).emit('chat:private_message', payload);
        socket.emit('chat:private_message', payload);

        // Push to the driver if they have an FCM token
        try {
          const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { fcmToken: true } });
          if (driver?.fcmToken) {
            pushNotifications.chatMessage(driver.fcmToken, senderName, clean, tripId);
          }
        } catch (err) {
          logger.warn('Failed to send private chat push to driver:', err.message);
        }
      } catch (err) {
        logger.error('Failed to handle passenger private chat send:', err);
      }
    });

    // ── Read receipts ────────────────────────────────────────────
    socket.on('chat:read', async ({ tripId, messageIds }) => {
      if (!tripId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      // Security: verify this passenger has a booking on this trip
      try {
        const prisma = require('../config/database');
        const booking = await prisma.booking.findFirst({
          where: { tripId, userId, status: { not: 'CANCELLED' } },
          select: { id: true },
        });
        if (!booking) {
          logger.warn(`Unauthorized read receipt: Passenger ${userId} not on trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized', code: 'UNAUTHORIZED' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize read receipt:', err);
        return;
      }

      try {
        const prisma = require('../config/database');

        // Mark all specified messages as read (only if they're not already read)
        await prisma.message.updateMany({
          where: {
            id: { in: messageIds },
            tripId,
            senderId: { not: userId },  // only mark messages FROM OTHERS as read
            readAt: null,
          },
          data: { readAt: new Date() },
        });

        // Find the senders of these messages to notify them
        const updatedMessages = await prisma.message.findMany({
          where: { id: { in: messageIds }, tripId, readAt: { not: null } },
          select: { id: true, senderId: true },
        });

        // Group by sender and emit read receipts to each sender
        const senderGroups = new Map();
        for (const msg of updatedMessages) {
          if (!senderGroups.has(msg.senderId)) senderGroups.set(msg.senderId, []);
          senderGroups.get(msg.senderId).push(msg.id);
        }

        // Emit read receipt back to the reader (for UI update)
        socket.emit('chat:read_receipt', { tripId, messageIds: updatedMessages.map(m => m.id), readBy: userId });

        // Notify actual senders via their user rooms
        for (const [senderId, ids] of senderGroups) {
          io.of('/passenger').to(`user:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: userId,
          });
          io.of('/driver').to(`driver:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: userId,
          });
        }
      } catch (err) {
        logger.error('Failed to process read receipt:', err);
      }
    });

    // ── Payment confirmed ── bridge to driver namespace ────────────
    socket.on('passenger:payment_confirmed', async ({ bookingId, tripId }) => {
      logger.info(`Payment confirmed: Passenger ${userId} for trip ${tripId}`);

      // Notify all sockets in the driver namespace within the trip room
      io.of('/driver').to(TRIP_ROOM(tripId)).emit('passenger:payment_confirmed', {
        bookingId,
        tripId,
      });

      // Also emit a status change so the rider tracking screen can update
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:status_change', {
        tripId,
        status: 'PAYMENT_CONFIRMED',
      });
    });

    // ── Safety location stream ── persisted + relayed to admin during SOS ──
    // The rider SOS screen streams live coordinates here every 10s. Previously
    // there was no handler, so the passenger's position during an emergency was
    // silently dropped. We persist a lightweight SosEvent trail and publish to the
    // admin live-locations channel so the ops console can follow the rider.
    socket.on('safety:location', async ({ tripId, latitude, longitude }) => {
      try {
        if (!tripId || typeof latitude !== 'number' || typeof longitude !== 'number') return;
        const prisma = require('../config/database');
        await prisma.sosEvent.create({
          data: { tripId, userId, lat: latitude, lng: longitude },
        });
        const adminPayload = JSON.stringify({
          type: 'sos_location',
          tripId,
          userId,
          lat: latitude,
          lng: longitude,
          timestamp: Date.now(),
        });
        await redis.publish('admin:sos_locations', adminPayload).catch(() => {});
      } catch (err) {
        logger.error(`safety:location persist failed for ${userId}:`, err);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Passenger disconnected: ${userId}`);
      cleanupSubscription();
    });

    socket.on('error', (err) => logger.error(`Passenger socket error ${userId}:`, err));
  });
};
