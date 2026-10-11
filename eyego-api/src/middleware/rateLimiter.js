'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const redis = require('../config/redis');

// Treat missing NODE_ENV as development (local dev servers often omit it)
const isDev = !env.NODE_ENV || env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

/**
 * Create a Redis-backed rate-limit store so limits are shared across multiple
 * server instances. Falls back to the default in-memory store if rate-limit-redis
 * is not installed or Redis is unavailable.
 */
function makeStore(prefix) {
  // Skip Redis-backed rate limiting in development/test — limits are already
  // extremely high (10K) and the InMemoryRedis fallback does not support
  // rate-limit-redis's sendCommand API. The built-in memory store is sufficient.
  if (isDev) return undefined;
  try {
    const { RedisStore } = require('rate-limit-redis');
    return new RedisStore({
      sendCommand: (...args) => redis.sendCommand(args),
      prefix: `rl:${prefix}:`,
    });
  } catch {
    // rate-limit-redis not installed or Redis unavailable — use memory store
    return undefined;
  }
}

/**
 * WHO the global budget belongs to: a signed-in user, else the IP.
 *
 * It was 100 requests per 15 minutes per IP for everything. An online driver's
 * home screen alone polls every 10 s (90 per window) next to several 15–20 s
 * polls, and Ghanaian carriers put many phones behind one CGNAT address — so in
 * production drivers would have been 429'd within minutes, and riders on the
 * same network with them. Dev mode (10 000) hid it. The token is verified, so a
 * forged one cannot mint a fresh bucket per request.
 */
const jwt = require('jsonwebtoken');
function whoIsAsking(req) {
  if (req.rateKey) return req.rateKey;
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      const d = jwt.verify(h.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      if (d?.userId) return (req.rateKey = `u:${d.userId}`);
      // Console staff: every admin request reaches us from the console SERVER's
      // one address, so keyed by IP the whole team shared a single budget.
      if (d?.adminId) return (req.rateKey = `a:${d.adminId}`);
    } catch { /* expired or forged: counted against the IP */ }
  }
  return (req.rateKey = `ip:${req.ip}`);
}

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // ~1.6 req/s sustained per signed-in user; anonymous traffic stays per IP.
  max: (req) => (isDev ? 10000 : whoIsAsking(req).startsWith('ip:') ? 300 : 1500),
  keyGenerator: whoIsAsking,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('default'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('auth'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many auth attempts, please try again in 15 minutes.' },
  skipSuccessfulRequests: true,
  // Per NUMBER when there is one: per IP, ten typos anywhere on a carrier's
  // shared (CGNAT) address locked everyone behind it out of signing in. The
  // OTP service already locks a number after three wrong codes.
  keyGenerator: (req) => String(req.body?.phone ?? '').replace(/[^0-9]/g, '').slice(-9) || req.ip,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('otp'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many OTP requests. Please wait 1 hour.' },
  // The NUMBER, not the string: "024…", "+23324…" and "233 24…" are one
  // phone, and keying on the raw text gave each spelling its own 5 SMS.
  keyGenerator: (req) => String(req.body?.phone ?? '').replace(/\D/g, '').slice(-9) || req.ip,
  // Skip all limits in dev — avoids blocking repeated test flows
  skip: () => isDev,
});

/**
 * Every OTP request is a paid SMS. The per-number limit above stops one phone
 * being flooded; this stops one machine walking through thousands of numbers.
 */
// ponytail: one carrier IP fronts many phones (CGNAT); raise this if real
// sign-ups on a busy network start seeing it — the per-number cap is the main guard.
const otpIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('otp-ip'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many sign-in codes requested from this network. Please wait a while.' },
  skip: () => isDev,
});

/** Masked calls cost voice minutes; a call is a deliberate tap, not a loop. */
const callLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('contact-call'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many calls in a short time. Try the chat, or wait a few minutes.' },
  keyGenerator: (req) => req.user?.userId || req.ip,
  skip: () => isDev,
});

// Per-user limiter keyed by the authenticated user id (falls back to IP for
// unauthenticated edge cases). MUST be mounted AFTER the auth middleware so
// req.user is populated. Skipped in dev to keep test flows unblocked.
const paymentInitiateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('payment-initiate'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many payment attempts. Please wait a moment.' },
  keyGenerator: (req) => req.user?.userId || req.user?.id || req.ip,
  skip: () => isDev,
});

// Per-user limiter for seat booking. Prevents a single account from spamming
// seat holds across trips. Keyed by user id, mounted after auth.
const bookingCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('booking-create'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many booking attempts. Please slow down.' },
  keyGenerator: (req) => req.user?.userId || req.user?.id || req.ip,
  skip: () => isDev,
});

/**
 * The unauthenticated share/join endpoints.
 *
 * These are the only routes where guessing an identifier gets you somebody
 * else's live location and pickup address, so they get their own budget rather
 * than sharing the general 100-per-15-minutes pool. The window is generous
 * enough for a real page — it polls every few seconds for the length of a ride —
 * and far too small to walk the `shortId` keyspace.
 *
 * Keyed on IP, because by definition there is no user here.
 */
// The tracking page polls every 5 s (12/min per viewer); 60 left room for five
// viewers on one carrier address. Links are unguessable, so this bounds load, not discovery.
const publicShareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('public-share'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
});

module.exports = {
  whoIsAsking,
  defaultLimiter,
  authLimiter,
  otpLimiter,
  otpIpLimiter,
  callLimiter,
  paymentInitiateLimiter,
  bookingCreateLimiter,
  publicShareLimiter,
};
