const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

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
