'use strict';

/**
 * Admin console authentication.
 *
 * Primary path: a Bearer `admin_access` JWT that resolves to a real AdminUser
 * row, re-read on every request so a disable or a role change takes effect at
 * once instead of riding out the token's lifetime.
 *
 * Legacy path: the original shared `x-admin-secret`. Kept ONLY so the old
 * vanilla SPA in eyego-api/public keeps working through the switchover to
 * apps/admin, and it now grants a clearly-labelled pseudo-identity rather than
 * pretending to be a person. Turn it off with ADMIN_LEGACY_SECRET=false the
 * moment the old console is retired — while it is on, one leaked string is
 * still full superadmin access with no attribution.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const env = require('../config/env');
const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { AuthError } = require('../utils/errors');
const { ADMIN_ROLES, PUBLIC_SELECT } = require('../modules/admin/adminAuth.service');

// Constant-time comparison so response timing can't be used to guess the
// secret byte-by-byte. Hash both sides first so lengths always match
// (timingSafeEqual throws on unequal buffer lengths, which itself leaks).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * OFF IN PRODUCTION UNLESS SOMEBODY ASKS FOR IT IN WRITING.
 *
 * This used to default to `true` everywhere, which meant a production deploy
 * that simply did not mention `ADMIN_LEGACY_SECRET` shipped with one shared
 * string granting full, unattributable SUPERADMIN — no AdminUser row, no audit
 * actor, no way to revoke it short of a redeploy. That is the wrong default for
 * a live platform, and it is the kind of wrong default nobody notices, because
 * everything works.
 *
 * Same shape as `PAYMENTS_SIMULATED` in config/env.js: the convenient behaviour
 * is the default OUTSIDE production and the safe behaviour is the default IN it,
 * with an explicit env var able to override either way for the switchover
 * window. `ADMIN_LEGACY_SECRET=true` in production still works — it just has to
 * be a decision someone made.
 */
const LEGACY_ENABLED =
  env.ADMIN_LEGACY_SECRET != null
    ? String(env.ADMIN_LEGACY_SECRET) === 'true'
    : env.NODE_ENV !== 'production';

/** The identity the legacy shared secret maps to. Never a real AdminUser row. */
const LEGACY_ADMIN = Object.freeze({
  id: null,
  email: 'legacy-shared-secret',
  name: 'Legacy console (shared secret)',
  role: 'SUPERADMIN',
  isLegacy: true,
});

async function assertNotRevoked(decoded) {
  if (!decoded.jti) return;
  try {
    const revoked = await redis.get(`jwt:blacklist:${decoded.jti}`);
    if (revoked) throw new AuthError('Token has been revoked');
  } catch (err) {
    if (err instanceof AuthError) throw err;
    logger.warn(`[adminAuth] Redis blacklist check failed (non-blocking): ${err.message}`);
  }
}

const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      throw new AuthError(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid admin token');
    }

    // A rider token carries type 'access' and role PASSENGER; without this it
    // would verify against the same secret and pass straight into the console.
    if (decoded.type !== 'admin_access' || !ADMIN_ROLES.includes(decoded.role)) {
      throw new AuthError('Invalid admin token');
    }

    await assertNotRevoked(decoded);

    const admin = await prisma.adminUser.findUnique({
      where: { id: decoded.adminId },
      select: PUBLIC_SELECT,
    });
    if (!admin) throw new AuthError('Admin account no longer exists');
    if (!admin.isActive) throw new AuthError('This account has been disabled');

    // Trust the row, not the token, for the role. A token minted before a
    // demotion still says the old role.
    req.admin = { ...admin, tokenId: decoded.tokenId, userId: admin.id };
    return next();
  }

  const secret = req.headers['x-admin-secret'];
  if (secret) {
    if (!LEGACY_ENABLED) {
      throw new AuthError('Shared-secret admin access is disabled. Sign in to the console.');
    }
    if (!safeEqual(secret, env.ADMIN_SECRET_KEY)) {
      throw new AuthError('Invalid admin credentials');
    }
    logger.warn(`[adminAuth] legacy shared-secret access to ${req.method} ${req.originalUrl} from ${req.ip}`);
    req.admin = { ...LEGACY_ADMIN, userId: LEGACY_ADMIN.email };
    return next();
  }

  throw new AuthError('No admin credentials provided');
};

module.exports = authenticateAdmin;
module.exports.LEGACY_ENABLED = LEGACY_ENABLED;
