'use strict';

const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const sentry = require('../config/sentry');

/** Mirrors the transient set in config/database.js — see the note there. */
const DB_UNREACHABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/**
 * Every Prisma client error class. A raw Prisma error's `.message` is not a
 * sentence — it is a multi-line dump of the failed invocation, the model, the
 * arguments and the SQL. Recognising the class is more reliable than pattern
 * matching the text, but we check both, because a Prisma error that has been
 * re-thrown or wrapped loses its constructor name and keeps its message.
 */
const PRISMA_ERROR_NAMES = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
]);

const isPrismaError = (err) =>
  PRISMA_ERROR_NAMES.has(err?.name) ||
  PRISMA_ERROR_NAMES.has(err?.constructor?.name) ||
  (typeof err?.message === 'string' && err.message.includes('Invalid `prisma.'));

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

  /**
   * A USER NEVER SEES A DATABASE ERROR. NOT EVEN OUTSIDE PRODUCTION.
   *
   * This used to send `err.message` straight to the client whenever
   * `NODE_ENV !== 'production'`, and that is how a rider cancelling a trip was
   * shown a Prisma statement instead of "your trip was cancelled": the cancel
   * threw an unmapped Prisma error, and a raw Prisma `.message` is the whole
   * failed invocation — model, arguments, SQL and all — as its text.
   *
   * The environment check was the wrong axis. Whether a message is safe to show
   * a user has nothing to do with where the server is running; it depends on
   * whether a human wrote it. `AppError` messages are authored for display and
   * are marked `isOperational`, so they pass through unchanged in every
   * environment. Anything else gets a sentence, and the real text goes to the
   * logger and Sentry above, which is where a developer was going to look
   * anyway. It also closes the information leak this had on any non-production
   * deployment — staging included.
   */
  const safeMessage = (() => {
    if (err.isOperational && typeof message === 'string' && message) return message;
    if (isPrismaError(err)) {
      // Something in the write went wrong in a way we have not mapped. Say so
      // plainly; the action did NOT take effect, which is what the user needs.
      return "We couldn't complete that just now. Please try again.";
    }
    if (statusCode >= 500) return 'An unexpected error occurred. Please try again.';
    return typeof message === 'string' && message ? message : 'Request could not be completed';
  })();

  const body = {
    success: false,
    code: isPrismaError(err) && code === 'INTERNAL_ERROR' ? 'DB_WRITE_FAILED' : code,
    message: safeMessage,
  };

  if (errors) body.errors = errors;

  /**
   * Structured context for a refusal the client has to RENDER rather than just
   * display — the under-minimum departure sheet needs the seat counts, not a
   * sentence to parse them out of.
   *
   * Operational errors only, for the same reason `safeMessage` exists: an
   * `AppError`'s `details` were authored for a client, and anything else's
   * internals are nobody's business.
   */
  if (err.isOperational && err.details && typeof err.details === 'object') {
    body.details = err.details;
  }

  res.status(statusCode).json(body);
};

module.exports = errorHandler;
