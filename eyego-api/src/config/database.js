const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * THE GENERATED CLIENT MUST MATCH THE SCHEMA ON DISK. LOUDLY.
 *
 * A stale `node_modules/.prisma/client` is the single most expensive failure
 * this project has had, because it does not look like one failure — it looks
 * like eight unrelated bugs at once.
 *
 * `prisma migrate dev` applies migrations AND regenerates, so the columns are
 * really there and `migrate status` says "up to date". But pulling a branch
 * that added a field regenerates nothing: the DB is migrated by whoever ran the
 * migration, `nodemon` restarts on the source change, and the client still has
 * yesterday's field list. Prisma then rejects the field CLIENT-SIDE, before any
 * SQL is sent, with a `PrismaClientValidationError` — which is not a `P2xxx`
 * code, is not transient, and lands on the error middleware as a plain 500.
 *
 * `Booking.seats` did exactly this. It is selected in `TRIP_INCLUDE`, which is
 * the include on every trip snapshot, which is what every state transition
 * publishes — so ONE missing field 500'd requesting a ride, cancelling a ride,
 * ending a trip, reading the active ride, joining a trip and paying for a seat,
 * and each of those was reported as its own separate bug.
 *
 * Prisma copies the schema it generated from into the client directory, so the
 * two are comparable. Mismatch is fatal at boot rather than at the twentieth
 * request: a server that cannot serve a trip should not accept traffic and
 * pretend the failures are the rider's problem.
 */
function assertGeneratedClientIsCurrent() {
  const sourceSchema = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  // Prisma 5 writes the generated copy next to the client it produced.
  const generatedSchema = path.join(
    require.resolve('@prisma/client'),
    '..',
    '..',
    '.prisma',
    'client',
    'schema.prisma',
  );

  let source;
  let generated;
  try {
    source = fs.readFileSync(sourceSchema, 'utf8');
    generated = fs.readFileSync(generatedSchema, 'utf8');
  } catch {
    // Can't compare (a bundled deploy, an unusual layout). Never block boot on
    // the check itself — the check is a safety net, not a dependency.
    return;
  }

  // Whitespace-insensitive: line endings differ between the checked-out file
  // and the copy Prisma writes, and that difference means nothing.
  const normalise = (s) => s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (normalise(source) === normalise(generated)) return;

  const message =
    'Prisma client is STALE — it was generated from a different schema.prisma than the one on disk.\n' +
    '    Every query that touches a newly added field will fail with PrismaClientValidationError (a 500),\n' +
    '    including the trip snapshot used by requesting, cancelling, ending, joining and paying for a ride.\n' +
    '    Fix: run `npm run db:generate` (or just `npm run dev`, which now does it for you).';

  if (process.env.PRISMA_ALLOW_STALE_CLIENT === 'true') {
    logger.error(`${message}\n    Continuing anyway because PRISMA_ALLOW_STALE_CLIENT=true.`);
    return;
  }
  logger.error(message);
  throw new Error('Stale Prisma client — run `npm run db:generate`.');
}

assertGeneratedClientIsCurrent();

/**
 * Connection-level failures Neon hands us that are NOT the query's fault.
 *
 * `ep-…-pooler.neon.tech` is a serverless pooler in front of a compute that
 * suspends when idle and is torn down and replaced during maintenance. The
 * first query to land on a suspended or just-recycled endpoint fails with
 * P1001 ("Can't reach database server") after a second or two, and the second
 * query — issued once the compute is awake — succeeds. Without a retry that
 * transient becomes a 500 on whatever the rider happened to be doing, which is
 * exactly how `trip.findMany` ended up in the error log.
 *
 * P2024 is the pool itself: every connection checked out, none returned yet.
 * Also transient, also worth one more go.
 */
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [150, 600];

const isTransient = (err) =>
  TRANSIENT_CODES.has(err?.code) ||
  // Socket-level resets surface without a Prisma code at all.
  /Can't reach database server|Connection (reset|closed|terminated)|ECONNRESET|ETIMEDOUT/i.test(
    err?.message ?? '',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
  // The default interactive-transaction budget is 5s, and `arriveTrip` blew
  // through it doing trip + earnings + quest progress in one callback — the
  // transaction expired mid-flight and the driver saw "couldn't update the
  // trip" on a tap that had, in fact, half-succeeded. Long-running work has
  // since moved out of those callbacks (see quests.service), but the budget
  // stays generous so a slow cross-region round trip alone cannot expire one.
  transactionOptions: { timeout: 20_000, maxWait: 10_000 },
});

if (process.env.NODE_ENV === 'development') {
  base.$on('query', (e) => {
    logger.debug(`Prisma Query: ${e.query} — ${e.duration}ms`);
  });
}

base.$on('error', (e) => {
  logger.error('Prisma error:', e);
});

/**
 * Retry transient connectivity failures.
 *
 * Deliberately NOT applied inside interactive transactions: once the server
 * has dropped, that transaction is gone, and re-running one statement against
 * a dead transaction produces the misleading "transaction already closed"
 * error rather than the connection error that actually happened. Prisma runs
 * extensions on the transaction client too, so the guard is explicit.
 */
const prisma = base.$extends({
  query: {
    async $allOperations({ operation, model, args, query }) {
      let lastErr;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          return await query(args);
        } catch (err) {
          lastErr = err;
          const inTransaction = typeof this?.$transaction !== 'function';
          if (!isTransient(err) || inTransaction || attempt === MAX_ATTEMPTS - 1) throw err;
          logger.warn(
            `Prisma ${model ?? 'raw'}.${operation} hit a transient connection error (${err.code ?? 'no code'}) — retry ${attempt + 1}/${MAX_ATTEMPTS - 1}`,
          );
          await sleep(BACKOFF_MS[attempt] ?? 600);
        }
      }
      throw lastErr;
    },
  },
});

/**
 * Warm the pool at boot so the first real request does not pay for waking a
 * suspended Neon compute. Failure here is not fatal — the retry above covers
 * the request path — so it logs and moves on.
 */
base
  .$connect()
  .then(() => logger.info('Prisma connected'))
  .catch((err) => logger.warn(`Prisma warm-up connect failed (will retry per-query): ${err.message}`));

// The extended client is a Proxy — do not hang extra properties off it.
// `isTransient` is re-derived where the error handler needs it.
module.exports = prisma;
