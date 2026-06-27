'use strict';

/**
 * Send a successful response
 */
const ok = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send a created response
 */
const created = (res, data = null, message = 'Created') => {
  return ok(res, data, message, 201);
};

/**
 * Send a paginated response
 */
const paginated = (res, data, meta) => {
  return res.status(200).json({
    success: true,
    data,
    meta,
  });
};

/**
 * Send an error response
 */
const error = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { ok, created, paginated, error };
