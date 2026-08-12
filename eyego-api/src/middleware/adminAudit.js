'use strict';

/**
 * Audit trail for mutating admin actions.
 *
 * Hooks `res.on('finish')` rather than wrapping the handler, so the row is
 * written with the real status code and only after the response is settled.
 * A 4xx/5xx is still recorded — an attempted ban that was rejected is exactly
 * the kind of thing an audit trail exists to show — but it is stored with its
 * status so a failed attempt can never be mistaken for a completed action.
 *
 * The write itself is best-effort inside adminAuth.service.writeAuditLog: by
 * the time this runs the action has already happened, so a logging failure must
 * not be able to turn a successful response into an error.
 */

const adminAuthService = require('../modules/admin/adminAuth.service');

/**
 * @param {string} action stable machine name, e.g. "driver.approve"
 * @param {object} [opts]
 * @param {string} [opts.targetType] entity kind, e.g. "Driver"
 * @param {string} [opts.targetParam] req.params key holding the target id (default "id")
 */
function audit(action, { targetType, targetParam = 'id' } = {}) {
  return (req, res, next) => {
    // Snapshot what we need now: by the time 'finish' fires, Express may have
    // moved on and req.params of a nested router can be gone.
    const snapshot = {
      admin: req.admin,
      action,
      targetType: targetType || null,
      targetId: req.params?.[targetParam] || req.body?.[targetParam] || null,
      method: req.method,
      path: req.originalUrl,
      payload: req.body && Object.keys(req.body).length ? req.body : null,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    res.on('finish', () => {
      adminAuthService.writeAuditLog({ ...snapshot, statusCode: res.statusCode });
    });

    next();
  };
}

module.exports = { audit };
