'use strict';

const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');

const socketAuth = (role) => async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (decoded.role !== role) return next(new Error('Invalid token role'));

    // Check JWT blacklist in Redis (degrades gracefully if Redis is unavailable)
    if (decoded.jti) {
      try {
        const revoked = await redis.get(`jwt:blacklist:${decoded.jti}`);
        if (revoked) return next(new Error('Token has been revoked'));
      } catch (err) {
        logger.warn('[socketAuth] Redis blacklist check failed (non-blocking):', err.message);
      }
    }

    socket.userId = decoded.userId;
    socket.role = decoded.role;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
};

module.exports = socketAuth;
