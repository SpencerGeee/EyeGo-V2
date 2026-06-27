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

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 100,
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
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('otp'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many OTP requests. Please wait 1 hour.' },
  keyGenerator: (req) => req.body?.phone || req.ip,
  // Skip all limits in dev — avoids blocking repeated test flows
  skip: () => isDev,
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('payment'),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many payment attempts.' },
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

module.exports = {
  defaultLimiter,
  authLimiter,
  otpLimiter,
  paymentLimiter,
  paymentInitiateLimiter,
  bookingCreateLimiter,
};
