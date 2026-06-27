'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AuthError, ForbiddenError } = require('../utils/errors');
const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const authenticateDriver = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('No token provided');
  }

  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });

  if (decoded.role !== 'DRIVER') {
    throw new AuthError('Invalid token role');
  }

  // Check JWT blacklist in Redis (degrades gracefully if Redis is unavailable)
  if (decoded.jti) {
    try {
      const revoked = await redis.get(`jwt:blacklist:${decoded.jti}`);
      if (revoked) throw new AuthError('Token has been revoked');
    } catch (err) {
      if (err instanceof AuthError) throw err;
      logger.warn('[driverAuth] Redis blacklist check failed (non-blocking):', err.message);
    }
  }

  // Verify driver is still ACTIVE
  const driver = await prisma.driver.findUnique({ where: { id: decoded.userId } });
  if (!driver) throw new AuthError('Driver account not found');
  if (driver.status === 'SUSPENDED') throw new ForbiddenError('Your account has been suspended');

  req.user = { ...decoded, status: driver.status };
  next();
};

const requireActiveDriver = (req, res, next) => {
  if (req.user.status !== 'ACTIVE') {
    throw new ForbiddenError('Your account is pending review. You cannot perform this action yet.');
  }
  next();
};

module.exports = { authenticateDriver, requireActiveDriver };
