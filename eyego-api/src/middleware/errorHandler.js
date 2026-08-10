'use strict';

const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const sentry = require('../config/sentry');

/** Mirrors the transient set in config/database.js — see the note there. */
const DB_UNREACHABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode = 500, message, code = 'INTERNAL_ERROR', errors } = err;

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this value already exists';
    code = 'DUPLICATE_ENTRY';
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
    code = 'NOT_FOUND';
  } else if (DB_UNREACHABLE_CODES.has(err.code)) {
    // The database went away — after the retries in config/database.js had
    // already had their turn. This is infrastructure, not a bug in the request,
    // and 503 tells the app's retry layer to try again rather than surfacing a
    // dead end to the rider.
    statusCode = 503;
    message = 'Service temporarily unavailable. Please try again.';
    code = 'DB_UNAVAILABLE';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }

  // Log non-operational errors as errors
  if (!err.isOperational || statusCode >= 500) {
    logger.error('Unhandled error:', {
      message: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      correlationId: req.correlationId,
    });

    // Report to Sentry (only genuine failures, not expected 4xx operational errors)
    sentry.captureException(err, {
      tags: { correlationId: req.correlationId, code },
      // The JWT payload's id field is `userId`; `id` was always undefined here.
      user: req.user ? { id: req.user.userId } : undefined,
      extra: { url: req.url, method: req.method },
    });
  }

  const body = {
    success: false,
    code,
    message: statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : message,
  };

  if (errors) body.errors = errors;

  res.status(statusCode).json(body);
};

module.exports = errorHandler;
