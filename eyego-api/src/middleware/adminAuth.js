'use strict';

const env = require('../config/env');
const { AuthError } = require('../utils/errors');

const authenticateAdmin = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== env.ADMIN_SECRET_KEY) {
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
