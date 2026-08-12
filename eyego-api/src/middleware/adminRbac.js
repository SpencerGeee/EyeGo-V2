'use strict';

/**
 * Role-based access control for the admin console.
 *
 * Enforced here, on the server, because the Next.js middleware in apps/admin
 * only decides what to *render*. Anyone can call the API directly, so a check
 * that lives solely in the frontend is decoration.
 *
 * SUPERADMIN implicitly satisfies every requirement — listing it in each call
 * would be noise that eventually gets forgotten somewhere.
 */

const { ForbiddenError } = require('../utils/errors');

const ROLE = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  OPS: 'OPS',
  FINANCE: 'FINANCE',
  SUPPORT: 'SUPPORT',
  VIEWER: 'VIEWER',
});

/**
 * @param {...string} allowed roles permitted to proceed
 */
function requireRole(...allowed) {
  const permitted = new Set([ROLE.SUPERADMIN, ...allowed]);

  return (req, res, next) => {
    const role = req.admin?.role;
    if (!role) throw new ForbiddenError('Not authenticated as an admin');
    if (!permitted.has(role)) {
      throw new ForbiddenError(
        `Your role (${role}) cannot perform this action. Required: ${allowed.join(' or ')}.`
      );
    }
    next();
  };
}

/**
 * Blocks every write for read-only roles. Applied as a blanket guard so a newly
 * added mutating route is denied to VIEWER by default rather than being open
 * until someone remembers to annotate it.
 */
function denyReadOnlyWrites(req, res, next) {
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (isWrite && req.admin?.role === ROLE.VIEWER) {
    throw new ForbiddenError('Your role is read-only.');
  }
  next();
}

module.exports = { requireRole, denyReadOnlyWrites, ROLE };
