'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
// How long a reservation (statusCode: 0 placeholder) can sit before we treat
// it as abandoned rather than genuinely in-flight. A request that crashes,
// times out, or hits a dev-server restart between reserving the key and
// calling res.json() leaves the row stuck at statusCode 0 forever — and
// since clients intentionally reuse a STABLE key per booking+method for
// retries, every future attempt with that same key hit this stuck row and
// got replayed as a broken response (res.status(0) is not a valid HTTP
// status), permanently blocking that booking from ever paying. 2 minutes is
// far longer than any real request should take, so it still catches true
// concurrent double-submits while self-healing from crashes.
const STALE_RESERVATION_MS = 2 * 60 * 1000;

// Idempotency middleware for unsafe POST endpoints (e.g. payment initiation).
//
// Clients send an `Idempotency-Key` header (a per-attempt UUID). The first
// request with a given (userId, endpoint, key) runs normally and its JSON
// response is persisted. Any retry with the same key short-circuits and returns
// the stored response verbatim — so a flaky network or double-tap can't trigger
// a second charge.
//
// Concurrency: we reserve the key with a unique row BEFORE running the handler.
// If a second request races in while the first is still in-flight, the unique
// constraint rejects it and we return 409 rather than processing twice.
function idempotency(req, res, next) {
  const key = req.header('Idempotency-Key');
  // Optional: requests without a key fall through unprotected (backward compatible).
  if (!key) return next();

  const userId = req.user?.userId || req.user?.id || 'anonymous';
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

  (async () => {
    // 1) Return a cached response if we have one (and it hasn't expired).
    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: { userId, endpoint, key } },
    });

    if (existing) {
      if (existing.statusCode === 0) {
        // Still a reservation placeholder — the original request never got as
        // far as res.json(). Genuinely in-flight (very recent) → reject as a
        // duplicate concurrent submit. Older than the window → the original
        // request crashed/restarted before responding; clear it and let this
        // one run fresh instead of replaying an invalid statusCode-0 response.
        const ageMs = Date.now() - existing.createdAt.getTime();
        if (ageMs < STALE_RESERVATION_MS) {
          return res.status(409).json({
            success: false,
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: 'A request with this Idempotency-Key is already being processed.',
          });
        }
        await prisma.idempotencyKey
          .delete({ where: { userId_endpoint_key: { userId, endpoint, key } } })
          .catch(() => {});
      } else if (existing.expiresAt > new Date()) {
        let body;
        try {
          body = JSON.parse(existing.responseBody);
        } catch {
          body = existing.responseBody;
        }
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(existing.statusCode).json(body);
      } else {
        // Expired — remove and let the handler run fresh.
        await prisma.idempotencyKey
          .delete({ where: { userId_endpoint_key: { userId, endpoint, key } } })
          .catch(() => {});
      }
    }

    // 2) Reserve the key. A unique-violation here means a concurrent request is
    //    already processing this exact key → reject the duplicate.
    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          userId,
          endpoint,
          statusCode: 0, // placeholder until the handler responds
          responseBody: '',
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({
          success: false,
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'A request with this Idempotency-Key is already being processed.',
        });
      }
      throw err;
    }

    // 3) Wrap res.json so we persist the real response once the handler finishes.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Fire-and-forget: never block the response on the store write.
      prisma.idempotencyKey
        .update({
          where: { userId_endpoint_key: { userId, endpoint, key } },
          data: { statusCode: res.statusCode || 200, responseBody: JSON.stringify(body) },
        })
        .catch((e) => logger.warn('Failed to persist idempotent response', { error: e.message }));
      return originalJson(body);
    };

    return next();
  })().catch(next);
}

module.exports = idempotency;
