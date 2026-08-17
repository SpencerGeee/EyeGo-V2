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

/**
 * Connect to Postgres, tolerating a cold start.
 *
 * @param {number} attempts  how many tries before giving up for real
 */
async function connectWithRetry(attempts = 6) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await prisma.$connect();
      // Prove it can actually serve a query, not merely open a socket — a
      // waking serverless endpoint accepts the connection well before it will
      // answer anything.
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database connected');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      const waitMs = Math.min(1000 * i, 5000);
      logger.warn(
        `Database not ready (attempt ${i}/${attempts}): ${err.message.split('\n')[0]}. ` +
          `Retrying in ${waitMs}ms — a serverless endpoint may be waking up.`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// ── Startup ────────────────────────────────────────────────────────
async function start() {
  try {
    // Test DB connection, with retries.
    //
    // Serverless Postgres (Neon, Aurora Serverless, Supabase free) scales the
    // compute to zero when idle, so the FIRST connection after a quiet period
    // has to wake it — several seconds during which the endpoint is reachable
    // on TCP but refuses queries. Prisma reports that as P1001 "Can't reach
    // database server", which reads like a wrong host or a firewall and is
    // neither. One retry loop turns a confusing crash into a two-second pause.
    await connectWithRetry();

    // Redis is REQUIRED, and this gate runs before the listener binds so the
    // process never advertises readiness on a box that cannot reach it.
    //
    // It used to be "optional — degrades gracefully", which was false: the
    // in-memory fallback silently voided the payment double-charge lock and the
    // webhook dedup lock, and cannot be a Socket.IO adapter at all. Redis now
    // also holds dispatch cascade state and the driver supply index. A missing
    // Redis is a broken deploy, and it should look like one. See config/redis.js.
    await redis.assertReady();

    // ── Runtime settings ───────────────────────────────────────────────
    // Loads the admin-editable overrides (fares, commission, dispatch tuning)
    // and subscribes to live changes, so every instance prices rides the same
    // way. Deliberately BEFORE the listener binds: serving a request with env
    // defaults when an override exists would quote the wrong fare.
    await require('./config/settings').init();

    // ── Repair dirty Driver.status rows ────────────────────────────────
    // `Driver.status` is a free-form String and dispatch eligibility compares
    // it to the exact literal 'ACTIVE'. A row holding 'Active', 'ACTIVE ' or
    // the plausible-but-wrong 'APPROVED' therefore drops that driver out of the
    // pool silently — no error, no log, nothing to debug from. Writes are now
    // normalised at the edge (utils/driver-status.js), but rows already in the
    // database predate that, so they are repaired once here, before anything
    // can read them. Cheap and idempotent: a clean database updates nothing.
    await require('./services/driver-status-repair').run();

    // ── Durable timers ─────────────────────────────────────────────────
    // Requiring these modules is what registers their ScheduledTask handlers;
    // the worker must not start before they are loaded or a due task would be
    // marked FAILED for having "no handler".
    require('./services/dispatch-cascade.service');
    require('./modules/rides/rides.service');
    const scheduledTasks = require('./services/scheduled-task.service');
    // Sleeps until the next task is actually due rather than polling on a
    // fixed interval — see the note in scheduled-task.service.js. A once-a-
    // second poll never lets a serverless database idle.
    scheduledTasks.startWorker();

    // Stuck-trip alarms. Notices in minutes what the expiry sweep only cleans
    // up hours later, and — critically — alarms if the timer worker above
    // stops draining, which is the failure most likely to strand riders.
    require('./services/trip-health.service').start();

    // Presence expiry already drops a driver out of the dispatch pool. It said
    // nothing to the rider ALREADY IN THE CAR, who was left watching a frozen
    // puck with no way to tell a live position from a stale one. This tells
    // them — and tells them again when the signal comes back.
    require('./services/driver-link-watch.service').start();

    // ── Trip expiry sweep ──────────────────────────────────────────────
    // Expire stale trips that passed their departure time by more than
    // the expiry window. Runs on startup and every 6 hours thereafter.
    // Covers:
    //   - SCHEDULED/FILLING — trips that never got filled (24h past departure)
    //   - DRIVER_EN_ROUTE/IN_PROGRESS — abandoned trips (>48h without completion)
    // Delegated to services/trip-lifecycle.service.js — see the long note at the
    // top of that file. The sweep that used to live inline here ran every SIX
    // HOURS with 24 h/48 h windows and only touched `Trip.status`, which is why a
    // midnight trip was still live (and still resumable by the driver) the next
    // afternoon with its riders' seats never released. It now runs every five
    // minutes, uses journey-realistic windows, marks trips EXPIRED rather than
    // CANCELLED (so platform housekeeping stops counting against drivers'
    // cancellation rates), releases the bookings, and tells any connected app.
    const tripLifecycle = require('./services/trip-lifecycle.service');
    const runTripExpiry = async () => {
      try {
        // No `io` argument: expiry now publishes the standard `trip:event`
        // like every other status change, so both apps learn about it through
        // the one channel instead of a sweep-specific socket message.
        await tripLifecycle.expireStaleTrips();
      } catch (err) {
        logger.warn('Trip expiry sweep failed (non-blocking):', err.message);
      }
    };
    setImmediate(runTripExpiry);
    setInterval(runTripExpiry, 5 * 60 * 1000);

    // ── Seat hold expiry sweep ─────────────────────────────────────────
    // Cancel bookings stuck in SEAT_HELD (payment window expired) every 2 min.
    // Derives from the SAME knob that stamps holdExpiry (SEAT_HOLD_DURATION_MINUTES
    // in bookings.service), plus a 5-min grace so the sweep never races an
    // in-flight payment. Previously this read a separate SEAT_HOLD_MINUTES var,
    // so tuning the hold duration silently didn't move the sweep.
    const HOLD_MINUTES =
      parseInt(process.env.SEAT_HOLD_MINUTES, 10) || env.SEAT_HOLD_DURATION_MINUTES + 5;
    const runSeatHoldExpiry = async () => {
      try {
        const cutoff = new Date(Date.now() - HOLD_MINUTES * 60 * 1000);
        // `seatNumber: null` is not tidiness — it is the whole point. The
        // unique key is @@unique([tripId, seatNumber]) with no status in it, so
        // a CANCELLED row that keeps `seatNumber: 3` permanently blocks seat 3
        // on that trip: every later booker hits SeatTakenError on a seat the
        // app is drawing as free. bookSeat has always nulled it when it
        // releases a hold; this sweep did not, so every abandoned checkout
        // burned a seat for the life of the trip.
        const expired = await prisma.booking.updateMany({
          where: { status: 'SEAT_HELD', createdAt: { lt: cutoff } },
          data: { status: 'CANCELLED', seatNumber: null },
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
    // Overlap guard: a slow sweep (many due intents, each dispatching to nearby
    // drivers) must never be re-entered by the next tick, or the same intent
    // could be double-dispatched.
    let scheduledRideSweepRunning = false;
    const runScheduledRideDispatch = async () => {
      if (scheduledRideSweepRunning) return;
      scheduledRideSweepRunning = true;
      try {
        const { processed } = await tripsService.processScheduledRideIntents();
        if (processed > 0) {
          logger.info(`Scheduled ride dispatch: processed ${processed} due intent(s)`);
        }
      } catch (err) {
        logger.warn('Scheduled ride dispatch sweep failed (non-blocking):', err.message);
      } finally {
        scheduledRideSweepRunning = false;
      }
    };
    // Skip the whole worker under test to avoid touching the DB / spawning timers.
    if (env.NODE_ENV !== 'test') {
      setImmediate(runScheduledRideDispatch);
      setInterval(runScheduledRideDispatch, 60 * 1000);
    }

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
