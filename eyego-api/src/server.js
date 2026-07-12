'use strict';

const http = require('http');
const app = require('./app');
const initSocketServer = require('./sockets');
const env = require('./config/env');
const logger = require('./utils/logger');
const prisma = require('./config/database');
const redis = require('./config/redis');

const server = http.createServer(app);

// Attach Socket.io
const io = initSocketServer(server);

// Make io accessible in request handlers if needed
app.set('io', io);

// ── Startup ────────────────────────────────────────────────────────
async function start() {
  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('Database connected');

    // Test Redis (optional — rate limiting & caching degrade gracefully without it)
    try {
      await redis.ping();
      logger.info('Redis connected');
    } catch (err) {
      logger.warn('Redis unavailable — continuing without it:', err.message);
    }

    // ── Trip expiry sweep ──────────────────────────────────────────────
    // Expire stale trips that passed their departure time by more than
    // the expiry window. Runs on startup and every 6 hours thereafter.
    // Covers:
    //   - SCHEDULED/FILLING — trips that never got filled (24h past departure)
    //   - DRIVER_EN_ROUTE/IN_PROGRESS — abandoned trips (>48h without completion)
    const runTripExpiry = async () => {
      try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

        const stale = await prisma.trip.updateMany({
          where: {
            OR: [
              { status: { in: ['SCHEDULED', 'FILLING'] }, departureTime: { lt: oneDayAgo } },
              { status: { in: ['DRIVER_EN_ROUTE', 'IN_PROGRESS'] }, updatedAt: { lt: twoDaysAgo } },
            ],
          },
          data: { status: 'CANCELLED' },
        });
        if (stale.count > 0) {
          logger.info(`Trip expiry sweep: cancelled ${stale.count} stale trip(s)`);
        }
      } catch (err) {
        logger.warn('Trip expiry sweep failed (non-blocking):', err.message);
      }
    };
    setImmediate(runTripExpiry);
    setInterval(runTripExpiry, 6 * 60 * 60 * 1000);

    // ── Seat hold expiry sweep ─────────────────────────────────────────
    // Cancel bookings stuck in SEAT_HELD (payment window expired) every 2 min
    // BUGFIX: Made configurable via env var with 15 min default
    const HOLD_MINUTES = parseInt(process.env.SEAT_HOLD_MINUTES, 10) || 15;
    const runSeatHoldExpiry = async () => {
      try {
        const cutoff = new Date(Date.now() - HOLD_MINUTES * 60 * 1000);
        const expired = await prisma.booking.updateMany({
          where: { status: 'SEAT_HELD', createdAt: { lt: cutoff } },
          data: { status: 'CANCELLED' },
        });
        if (expired.count > 0) {
          logger.info(`Seat hold expiry: released ${expired.count} held seat(s)`);
        }
      } catch (err) {
        logger.warn('Seat hold expiry sweep failed (non-blocking):', err.message);
      }
    };
    setImmediate(runSeatHoldExpiry);
    setInterval(runSeatHoldExpiry, 2 * 60 * 1000);

    // ── IdempotencyKey cleanup sweep ───────────────────────────────────
    // Delete expired idempotency keys daily to prevent unbounded table growth.
    const runIdempotencyCleanup = async () => {
      try {
        const result = await prisma.idempotencyKey.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        if (result.count > 0)
          logger.info(`IdempotencyKey cleanup: deleted ${result.count} expired rows`);
      } catch (err) {
        logger.warn('IdempotencyKey cleanup failed (non-blocking):', err.message);
      }
    };
    setImmediate(runIdempotencyCleanup);
    setInterval(runIdempotencyCleanup, 24 * 60 * 60 * 1000);

    // ── Scheduled-ride dispatcher ────────────────────────────────────
    // Converts ScheduledRideIntent rows into a real Booking (or a live on-demand
    // dispatch request) as their scheduled time approaches. Previously nothing
    // ever read this table after creation.
    const tripsService = require('./modules/trips/trips.service');
    const runScheduledRideDispatch = async () => {
      try {
        const { processed } = await tripsService.processScheduledRideIntents();
        if (processed > 0) {
          logger.info(`Scheduled ride dispatch: processed ${processed} due intent(s)`);
        }
      } catch (err) {
        logger.warn('Scheduled ride dispatch sweep failed (non-blocking):', err.message);
      }
    };
    setImmediate(runScheduledRideDispatch);
    setInterval(runScheduledRideDispatch, 2 * 60 * 1000);

    // ── Unanswered dispatch offer expiry ─────────────────────────────
    // Admin's assignDriverToTrip sets a trip to FILLING with a driver-facing
    // countdown, but nothing previously enforced that expiry server-side —
    // an ignored offer left the trip stuck with a phantom driver assignment.
    const adminService = require('./modules/admin/admin.service');
    const runDispatchOfferExpiry = async () => {
      try {
        const reverted = await adminService.expireUnansweredDispatchOffers();
        if (reverted > 0) {
          logger.info(`Dispatch offer expiry: reverted ${reverted} unanswered offer(s)`);
        }
      } catch (err) {
        logger.warn('Dispatch offer expiry sweep failed (non-blocking):', err.message);
      }
    };
    setImmediate(runDispatchOfferExpiry);
    setInterval(runDispatchOfferExpiry, 60 * 1000);

    // ── Driver quest regeneration ────────────────────────────────────
    // DriverQuest rows previously only came from a one-time seed script with
    // hardcoded date windows — the Quests tab went permanently empty once those
    // windows passed. Re-run the same upsert daily to keep today's/this week's
    // quests current.
    const questsService = require('./modules/quests/quests.service');
    const runQuestRegeneration = async () => {
      try {
        await questsService.regenerateStandardQuests();
      } catch (err) {
        logger.warn('Quest regeneration failed (non-blocking):', err.message);
      }
    };
    setImmediate(runQuestRegeneration);
    setInterval(runQuestRegeneration, 24 * 60 * 60 * 1000);

    server.listen(env.PORT, () => {
      logger.info(`EyeGo API running on port ${env.PORT} (${env.NODE_ENV})`);
      logger.info(`Health: http://localhost:${env.PORT}/health`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}. Gracefully shutting down...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await prisma.$disconnect();
    await redis.quit();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after configurable timeout (default 30s)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

start();
