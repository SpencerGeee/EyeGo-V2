'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { AuthError } = require('../utils/errors');

// Constant-time comparison so response timing can't be used to guess the
// secret byte-by-byte. Hash both sides first so lengths always match
// (timingSafeEqual throws on unequal buffer lengths, which itself leaks).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const authenticateAdmin = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !safeEqual(secret, env.ADMIN_SECRET_KEY)) {
    throw new AuthError('Invalid admin credentials');
  }
  // No per-admin accounts yet (shared secret only) — accept an optional
  // caller-supplied identity header so audit logs are attributable instead
  // of a meaningless hardcoded 'admin' string. Falls back to 'admin' if
  // the caller doesn't send one.
  req.admin = { userId: req.headers['x-admin-name'] || 'admin' };
  next();
};

module.exports = authenticateAdmin;
