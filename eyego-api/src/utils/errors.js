'use strict';

// A 4xx thrown without a code went out as code "INTERNAL_ERROR" (48 call sites),
// which reads to a client as a server fault.
const CODE_FOR_STATUS = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 402: 'PAYMENT_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 410: 'GONE', 413: 'PAYLOAD_TOO_LARGE', 422: 'UNPROCESSABLE', 429: 'TOO_MANY_REQUESTS',
};

class AppError extends Error {
  constructor(message, statusCode = 500, code = CODE_FOR_STATUS[statusCode] ?? 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, errors = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class PaymentError extends AppError {
  constructor(message) {
    super(message, 402, 'PAYMENT_ERROR');
  }
}

class SeatTakenError extends AppError {
  constructor() {
    super('This seat has already been booked', 409, 'SEAT_TAKEN');
  }
}

class InsufficientWalletError extends AppError {
  constructor() {
    super('Insufficient wallet balance', 402, 'INSUFFICIENT_WALLET');
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PaymentError,
  SeatTakenError,
  InsufficientWalletError,
};
