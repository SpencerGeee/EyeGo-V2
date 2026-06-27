'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AuthError } = require('../utils/errors');
const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Shared JWT blacklist check — DRY helper used by both passenger and driver auth.
 * Queries Redis for a revoked token. Gracefully skips the check if Redis is down.
 */
async function checkJwtBlacklist(token) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (decoded.jti) {
    try {
      const revoked = await redis.get(`jwt:blacklist:${decoded.jti}`);
      if (revoked) throw new AuthError('Token has been revoked');
    } catch (err) {
      if (err instanceof AuthError) throw err;
      logger.warn('[auth] Redis blacklist check failed (non-blocking):', err.message);
    }
  }
  return decoded;
}

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('No token provided');
  }

  const token = authHeader.split(' ')[1];
  const decoded = await checkJwtBlacklist(token);

  if (decoded.role !== 'PASSENGER') {
    throw new AuthError('Invalid token role');
  }

  req.user = decoded;
  next();
};

/**
 * Middleware for Driver JWT authentication.
 * Verifies token with blacklist check, accepts only DRIVER role.
 */
const authenticateDriver = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('No token provided');
  }

  const token = authHeader.split(' ')[1];
  const decoded = await checkJwtBlacklist(token);

  if (decoded.role !== 'DRIVER') {
    throw new AuthError('Invalid token role');
  }

  req.user = decoded;
  next();
};

/**
 * Blacklist an access token until it naturally expires.
 * Call this on logout. No-op if Redis is unavailable.
 */
const blacklistToken = async (token) => {
  if (!token) return;
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (!decoded?.jti || !decoded?.exp) return;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(`jwt:blacklist:${decoded.jti}`, '1', 'EX', ttl);
    }
  } catch (err) {
    logger.warn('[auth] Failed to blacklist token (possibly tampered):', err.message);
  }
};

module.exports = authenticate;
module.exports.authenticateDriver = authenticateDriver;
module.exports.blacklistToken = blacklistToken;
