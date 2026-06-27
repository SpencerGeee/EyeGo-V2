'use strict';

const redis = require('../config/redis');
const prisma = require('../config/database');
const { isWithinGhana, getDirections } = require('../services/mapbox.service');
const { completeTrip } = require('../modules/trips/trips.service');
const pubSub = require('../graphql/pubsub');
const { notifications: pushNotifications, sendMulticastPush, sendPush } = require('../services/push.service');
const { haversineMeters, distanceToPolyline } = require('../utils/geo');
const logger = require('../utils/logger');
const env = require('../config/env');

const LOCATION_UPDATE_CHANNEL = (driverId) => `driver:${driverId}:location`;
const TRIP_ROOM = (tripId) => `trip:${tripId}`;
const ETA_FALLBACK_SPEED_KPH = parseInt(process.env.ETA_FALLBACK_SPEED_KPH) || 30;

// ── ETA throttle config ────────────────────────────────────────────────────────
const ETA_INTERVAL_MS = 10_000;   // minimum ms between ETA calculations per driver
const ETA_DISTANCE_M  = 50;       // also recalculate if driver moved > 50 m

// Per-driver ETA cache: driverId → { tripId, destLat, destLng, lastCalcAt, lastLat, lastLng }
const etaCache = new Map();

// ── Ride-check / route-deviation safety (Phase 3B) ───────────────────────────────
// Per-driver safety state.  Keyed by driverId, cleaned up on disconnect.
//   { tripId, lastLat, lastLng, lastSpeed, stoppedSince, lastCheckAt }
const safetyState = new Map();

// Thresholds (with env overrides for testing)
const DEVIATION_THRESHOLD_M = env.DEVIATION_THRESHOLD_M ?? 350;
const STOPPED_THRESHOLD_MS  = (env.STOPPED_THRESHOLD_SEC ?? 180) * 1000;
const SAFETY_CHECK_COOLDOWN_MS = (env.SAFETY_CHECK_COOLDOWN_SEC ?? 300) * 1000;

// Key used to flag that we already have a safety check pending for this trip.
const SAFETY_PENDING = new Set();


module.exports = function registerDriverSocket(io, driverNamespace) {
  driverNamespace.on('connection', async (socket) => {
    const driverId = socket.userId;
    logger.info(`Driver connected: ${driverId}`);

    // Join driver-specific room
    socket.join(`driver:${driverId}`);

    // Auto-rejoin trip room if driver has an active trip (handles socket reconnects)
    try {
      const activeTrip = await prisma.trip.findFirst({
        where: {
          driverId: driverId,
          // Include SCHEDULED/FILLING — the boarding phase where chat is most used.
          // Without these, a reconnect during boarding left the driver out of the
          // trip room and dropped inbound chat messages.
          status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (activeTrip) {
        const tripRoom = TRIP_ROOM(activeTrip.id);
        socket.join(tripRoom);
        logger.debug(`Driver ${driverId} auto-rejoined trip room ${activeTrip.id} on reconnect`);
        // BUGFIX: Skip chat history fetch on auto-rejoin to avoid duplicate messages.
        // The driver:join_tracking handler (fired separately on reconnect) already
        // fetches and sends chat history. Fetching here too causes duplicates.
        // Socket join alone is sufficient to receive new messages.
      }
    } catch (err) {
      logger.error('Failed to auto-rejoin trip room on driver reconnect:', err);
    }

    // ── Location update (fires every ~3s from app) ──────────
    socket.on('driver:location_update', async ({ lat, lng, heading = 0, speed = 0 }) => {
      if (!lat || !lng) return;

      // Per-socket throttle: max one location update per 2s
      const now = Date.now();
      if (socket._lastLocationUpdate && now - socket._lastLocationUpdate < 2000) return;
      socket._lastLocationUpdate = now;

      // Validate coordinates are in Ghana (controlled by GEO_VALIDATION_ENABLED env var).
      // BUGFIX: Previously used NODE_ENV !== 'development' which meant any staging/preview
      // env with NODE_ENV=development bypassed geofencing. Now uses dedicated env var.
      const geoValidationEnabled = env.GEO_VALIDATION_ENABLED !== 'false';
      if (geoValidationEnabled && !isWithinGhana(lat, lng)) {
        socket.emit('error', { message: 'Location outside Ghana', code: 'INVALID_LOCATION' });
        return;
      }

      // Update DB (throttled — only if moved significantly)
      try {
        await prisma.driver.update({
          where: { id: driverId },
          data: { currentLat: lat, currentLng: lng, currentHeading: heading },
        });
      } catch (err) { logger.debug('[DriverSocket] Non-critical DB location update error:', err?.message ?? err); }

      const locationPayload = JSON.stringify({ lat, lng, heading, speed, timestamp: Date.now() });

      // Publish to Redis — all passenger sockets subscribed to this driver will receive it
      await redis.publish(LOCATION_UPDATE_CHANNEL(driverId), locationPayload);

      // Also publish to admin update channel for Live Map
      // Include driver metadata so admin knows who this is
      const adminPayload = JSON.stringify({
        driverId,
        lat, lng, heading, speed,
        timestamp: Date.now(),
      });
      await redis.publish('admin:driver_locations', adminPayload).catch(() => {});

      // Register driver in geo-set so dispatch can find nearby online drivers
      await redis.geoadd('drivers:online', lng, lat, driverId).catch(() => {});

      // ── ETA calculation (throttled) ──────────────────────────────────────────
      // Only hit Mapbox when the driver has moved enough OR enough time has passed.
      const cache = etaCache.get(driverId) || {};
      const msSinceLast = now - (cache.lastCalcAt || 0);
      const mSinceLast = cache.lastLat != null
        ? haversineMeters(lat, lng, cache.lastLat, cache.lastLng)
        : Infinity;

      if (msSinceLast >= ETA_INTERVAL_MS || mSinceLast >= ETA_DISTANCE_M) {
        // Resolve destination — use cache if available, otherwise hit DB
        let { tripId, destLat, destLng } = cache;

        if (!tripId || destLat == null) {
          try {
            const activeTrip = await prisma.trip.findFirst({
              where: {
                driverId,
                status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] },
              },
              select: {
                id: true,
                route: { select: { destLat: true, destLng: true } },
              },
            });

            if (activeTrip) {
              tripId  = activeTrip.id;
              destLat = activeTrip.route?.destLat;
              destLng = activeTrip.route?.destLng;
            }
          } catch (err) {
            logger.warn(`ETA: DB lookup failed for driver ${driverId}: ${err.message}`);
          }
        }

        if (tripId && destLat != null && destLng != null) {
          try {
            let directions;
            if (!env.MAPBOX_SECRET_TOKEN || env.MAPBOX_SECRET_TOKEN === 'placeholder') {
              // Dev/Fallback: use route virtual stops for a realistic polyline
              // instead of a straight line. Builds waypoints from origin → stops → destination.
              let waypoints = [[lng, lat]];
              try {
                const activeTrip = await prisma.trip.findFirst({
                  where: { id: tripId, driverId },
                  select: {
                    route: {
                      select: {
                        destLat: true, destLng: true,
                        virtualStops: {
                          where: { isActive: true },
                          orderBy: { sequence: 'asc' },
                          select: { lat: true, lng: true },
                        },
                      },
                    },
                  },
                });
                if (activeTrip?.route?.virtualStops?.length) {
                  // Driver hasn't passed each stop yet — include all stops as waypoints
                  waypoints = [
                    [lng, lat],
                    ...activeTrip.route.virtualStops.map(s => [s.lng, s.lat]),
                    [destLng, destLat],
                  ];
                } else {
                  waypoints.push([destLng, destLat]);
                }
              } catch (_) {
                waypoints.push([destLng, destLat]);
              }

              const meters = haversineMeters(lat, lng, destLat, destLng);
              const distanceKm = (meters / 1000) * 1.35; // 1.35x winding road multiplier
              // Use speed with traffic: 25 km/h for urban driving (more realistic than 30)
              const trafficSpeed = ETA_FALLBACK_SPEED_KPH * 0.85;
              const durationMin = (distanceKm / Math.max(trafficSpeed, 5)) * 60.0;
              
              directions = {
                durationMin,
                distanceKm,
                geometry: {
                  type: 'LineString',
                  coordinates: waypoints,
                },
              };
            } else {
              directions = await getDirections(lng, lat, destLng, destLat);
            }

            const { durationMin, distanceKm, geometry } = directions;

            const etaPayload = {
              tripId,
              etaMinutes:  Math.round(durationMin),
              distanceKm:  Math.round(distanceKm * 10) / 10,
              message:     durationMin < 2 ? 'Arriving now' : `${Math.round(durationMin)} min away`,
              geometry,    // GeoJSON LineString — rider map draws the real route
            };

            // Emit to both passenger (rider tracking) AND driver (driver tracking) namespaces
            io.of('/passenger')
              .to(TRIP_ROOM(tripId))
              .emit('trip:eta', etaPayload);

            driverNamespace
              .to(TRIP_ROOM(tripId))
              .emit('trip:eta', etaPayload);

            etaCache.set(driverId, {
              tripId, destLat, destLng,
              lastCalcAt: now,
              lastLat: lat,
              lastLng: lng,
            });

            // ── Ride-check / route-deviation safety (Phase 3B) ────────────
            // Only run for IN_PROGRESS trips (driver has departed).
            try {
              const tripStatus = await prisma.trip.findUnique({
                where: { id: tripId },
                select: { status: true },
              });
              if (tripStatus?.status === 'IN_PROGRESS') {
                const polyline = geometry?.coordinates;
                const sState = safetyState.get(driverId) || { tripId, lastLat: lat, lastLng: lng, lastSpeed: speed, stoppedSince: null, lastCheckAt: 0 };

                // 1) Route deviation check (only if we have a polyline)
                if (polyline && polyline.length >= 2) {
                  const distM = distanceToPolyline(lat, lng, polyline);
                  if (distM > DEVIATION_THRESHOLD_M) {
                    emitSafetyCheck(io, tripId, 'route_deviation');
                  }
                }

                // 2) Stopped-too-long check
                const currentSpeed = speed || 0;
                const movedSignificantly = haversineMeters(lat, lng, sState.lastLat, sState.lastLng) > 10;

                if (currentSpeed < 1 && !movedSignificantly) {
                  // Driver appears stopped
                  if (!sState.stoppedSince) {
                    sState.stoppedSince = now;
                  } else if (now - sState.stoppedSince >= STOPPED_THRESHOLD_MS) {
                    emitSafetyCheck(io, tripId, 'stopped_too_long');
                    sState.stoppedSince = now; // reset timer to avoid repeated checks
                  }
                } else {
                  sState.stoppedSince = null;
                }

                sState.lastLat = lat;
                sState.lastLng = lng;
                sState.lastSpeed = currentSpeed;
                safetyState.set(driverId, sState);
              }
            } catch (err) {
              logger.debug('[DriverSocket] Non-blocking safety check error:', err?.message ?? err);
            }
          } catch (err) {
            logger.warn(`ETA: Mapbox directions failed for driver ${driverId}: ${err.message}`);
            // Don't update cache — will retry on next eligible location update
          }
        }
      }
    });

/** Emit a safety check to the passenger namespace, debounced per trip. */
function emitSafetyCheck(io, tripId, reason) {
  if (SAFETY_PENDING.has(tripId)) return; // debounce — one active check per trip
  SAFETY_PENDING.add(tripId);

  io.of('/passenger').to(TRIP_ROOM(tripId)).emit('safety:check', {
    tripId,
    reason,
    timestamp: Date.now(),
  });

  // Auto-clear after cooldown so repeated checks can fire if driver stays off-route.
  setTimeout(() => SAFETY_PENDING.delete(tripId), SAFETY_CHECK_COOLDOWN_MS);
}

    // ── Join trip room (for tracking screen socket reconnections) ──
    socket.on('driver:join_tracking', async ({ tripId }) => {
      if (tripId) {
        socket.join(TRIP_ROOM(tripId));
        logger.debug(`Driver ${driverId} joined tracking room ${tripId}`);

        // Send chat history so the driver sees past messages
        // Includes all public messages + private threads involving this driver
        try {
          const history = await prisma.message.findMany({
            where: {
              tripId,
              OR: [
                { isPrivate: false },
                { isPrivate: null },
                { senderId: driverId },
                { recipientId: driverId },
              ],
            },
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
          logger.error('Failed to fetch chat history for driver:', err);
        }
      }
    });

    // ── Trip events ─────────────────────────────────────────
    socket.on('driver:trip_started', async ({ tripId }) => {
      socket.join(TRIP_ROOM(tripId));
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:status_change', {
        tripId,
        status: 'DRIVER_EN_ROUTE',
      });
      pubSub.publish(`TRIP_STATUS:${tripId}`, {
        tripId,
        status: 'DRIVER_EN_ROUTE',
        driverLat: null,
        driverLng: null,
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('driver:trip_departed', async ({ tripId }) => {
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:status_change', {
        tripId,
        status: 'IN_PROGRESS',
      });
      pubSub.publish(`TRIP_STATUS:${tripId}`, {
        tripId,
        status: 'IN_PROGRESS',
        driverLat: null,
        driverLng: null,
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('driver:arrived', async ({ tripId }) => {
      // Persist trip + booking completion in DB so rider Past tab and trip count update
      try {
        await completeTrip(tripId);
      } catch (err) {
        logger.error('Failed to complete trip in DB:', err);
      }

      // Clear ETA cache — trip is over
      etaCache.delete(driverId);

      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:status_change', {
        tripId,
        status: 'COMPLETED',
      });
    });

    // ── Typing indicators ────────────────────────────────────
    socket.on('chat:typing_start', ({ tripId }) => {
      if (!tripId) return;
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: driverId,
        senderName: 'Driver',
        senderRole: 'DRIVER',
        isTyping: true,
      });
    });

    socket.on('chat:typing_stop', ({ tripId }) => {
      if (!tripId) return;
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: driverId,
        senderRole: 'DRIVER',
        isTyping: false,
      });
    });

    // ── Chat messages (global broadcast to trip room) ─────────
    // BUGFIX: Server-side chat input sanitization — enforce length limit and trim.
    // Strips only HTML tags (not angle brackets in content like "2 < 3 km").
    const MAX_CHAT_LENGTH = 500;
    function sanitizeChatText(raw) {
      if (typeof raw !== 'string') return '';
      return raw.trim().replace(/<[^>]*>/g, '').slice(0, MAX_CHAT_LENGTH);
    }

    socket.on('chat:send', async ({ tripId, text, timestamp }) => {
      if (!tripId || !text) return;
      text = sanitizeChatText(text);
      if (!text) return;

      // Security: verify this driver is actually assigned to this trip
      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driverId: true },
        });
        if (!trip || trip.driverId !== driverId) {
          logger.warn(`Unauthorized chat attempt: Driver ${driverId} not assigned to trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize driver chat send:', err);
        return;
      }

      let senderName = '';
      try {
        const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
        if (driver) senderName = driver.name;

        await prisma.message.create({
          data: {
            tripId,
            senderId: driverId,
            senderName,
            senderRole: 'DRIVER',
            isPrivate: false,
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
        });
      } catch (err) {
        logger.error('Failed to persist driver chat message:', err);
      }

      const messagePayload = {
        senderId: driverId,
        senderName,
        senderRole: 'DRIVER',
        text,
        isPrivate: false,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Direct echo to sender — guarantees the driver sees their own message even
      // if their socket hasn't (re)joined the trip room yet (symmetry with the
      // passenger chat:send handler).
      socket.emit('chat:message', messagePayload);

      driverNamespace.to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);

      // Push notification to passengers who may be in the background
      try {
        const bookings = await prisma.booking.findMany({
          where: { tripId, status: { in: ['CONFIRMED', 'SEAT_HELD', 'BOARDED', 'PAID'] } },
          select: { user: { select: { fcmToken: true } } },
        });
        const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
        if (tokens.length > 0) {
          sendMulticastPush(tokens, `💬 ${senderName}`, text.length > 80 ? text.slice(0, 77) + '…' : text, { type: 'CHAT_MESSAGE', tripId });
        }
      } catch (err) {
        logger.warn('Failed to send chat push to passengers:', err.message);
      }
    });

    // ── Private chat (driver → specific rider) ─────────────────
    socket.on('chat:private_send', async ({ tripId, text, recipientId, timestamp }) => {
      if (!tripId || !text || !recipientId) return;
      text = sanitizeChatText(text);
      if (!text) return;

      // Security: verify this driver is assigned to the trip AND the recipient has a booking
      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driverId: true },
        });
        if (!trip || trip.driverId !== driverId) {
          logger.warn(`Unauthorized private chat attempt: Driver ${driverId} not assigned to trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
        const recipientBooking = await prisma.booking.findFirst({
          where: { tripId, userId: recipientId, status: { not: 'CANCELLED' } },
          select: { id: true },
        });
        if (!recipientBooking) {
          logger.warn(`Unauthorized private chat: Driver ${driverId} tried messaging non-passenger ${recipientId}`);
          socket.emit('error', { message: 'Recipient not found on this trip', code: 'RECIPIENT_NOT_FOUND' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize driver private chat:', err);
        return;
      }

      let senderName = '';
      try {
        const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
        if (driver) senderName = driver.name;

        await prisma.message.create({
          data: {
            tripId,
            senderId: driverId,
            senderName,
            senderRole: 'DRIVER',
            isPrivate: true,
            recipientId,
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
        });
      } catch (err) {
        logger.error('Failed to persist private chat message:', err);
      }

      const messagePayload = {
        senderId: driverId,
        senderName,
        senderRole: 'DRIVER',
        text,
        isPrivate: true,
        recipientId,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Deliver only to the specific rider + echo back to driver
      io.of('/passenger').to(`user:${recipientId}`).emit('chat:private_message', messagePayload);
      socket.emit('chat:private_message', messagePayload);

      // Push notification to that rider only
      try {
        const booking = await prisma.booking.findFirst({
          where: { tripId, userId: recipientId },
          select: { user: { select: { fcmToken: true } } },
        });
        if (booking?.user?.fcmToken) {
          await sendPush(booking.user.fcmToken, `💬 ${senderName}`, text.length > 80 ? text.slice(0, 77) + '…' : text, { type: 'PRIVATE_CHAT', tripId });
        }
      } catch (err) {
        logger.warn('Failed to send private chat push:', err.message);
      }
    });

    // ── Read receipts ────────────────────────────────────────────
    socket.on('chat:read', async ({ tripId, messageIds }) => {
      if (!tripId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      try {
        // BUGFIX: Removed redundant prisma require — already imported at top of module

        // Mark all specified messages as read (only if they're not already read)
        await prisma.message.updateMany({
          where: {
            id: { in: messageIds },
            tripId,
            senderId: { not: driverId },  // only mark messages FROM OTHERS as read
            readAt: null,
          },
          data: { readAt: new Date() },
        });

        // Find the senders of these messages to notify them
        const updatedMessages = await prisma.message.findMany({
          where: { id: { in: messageIds }, tripId, readAt: { not: null } },
          select: { id: true, senderId: true },
        });

        // Emit read receipt back to the reader (for UI update)
        socket.emit('chat:read_receipt', { tripId, messageIds: updatedMessages.map(m => m.id), readBy: driverId });

        // Group by sender and notify each sender
        const senderGroups = new Map();
        for (const msg of updatedMessages) {
          if (!senderGroups.has(msg.senderId)) senderGroups.set(msg.senderId, []);
          senderGroups.get(msg.senderId).push(msg.id);
        }

        for (const [senderId, ids] of senderGroups) {
          io.of('/driver').to(`driver:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: driverId,
          });
          io.of('/passenger').to(`user:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: driverId,
          });
        }
      } catch (err) {
        logger.error('Failed to process read receipt:', err);
      }
    });

    socket.on('driver:seat_updated', async ({ tripId, seatData }) => {
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:seat_update', {
        tripId,
        seatData,
      });
    });

    socket.on('disconnect', async () => {
      logger.info(`Driver disconnected: ${driverId}`);
      etaCache.delete(driverId);
      safetyState.delete(driverId); // clean up safety check state
      try {
        await prisma.driver.update({ where: { id: driverId }, data: { isOnline: false } });
      } catch (err) {
        logger.warn(`Failed to set driver ${driverId} offline on disconnect: ${err.message}`);
      }
    });

    socket.on('error', (err) => logger.error(`Driver socket error ${driverId}:`, err));
  });
};
