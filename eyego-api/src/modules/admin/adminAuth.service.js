'use strict';

/**
 * Admin console identity.
 *
 * Replaces the previous model, which was a single shared `x-admin-secret` plus
 * an unverified `x-admin-name` header. Consequences of that design, all of which
 * this module closes:
 *   - one credential for everybody, so revoking one person meant rotating all
 *   - no scoping: anyone who could read metrics could also ban users and
 *     publish OTA builds
 *   - the audit actor was whatever string the caller put in a header
 *
 * Tokens deliberately reuse JWT_ACCESS_SECRET / JWT_REFRESH_SECRET and the
 * shared RefreshToken table so rotation, revocation and the expiry sweep keep
 * exactly one implementation. Cross-surface replay is blocked two ways: the
 * rider/driver middleware requires role PASSENGER/DRIVER (an admin role can
 * never satisfy either), and this module requires `type === 'admin_access'`
 * (a rider token carries `type: 'access'`, so it cannot be replayed here).
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { AuthError, NotFoundError, AppError, ValidationError } = require('../../utils/errors');

const ADMIN_ROLES = ['SUPERADMIN', 'OPS', 'FINANCE', 'SUPPORT', 'VIEWER'];

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 7; // shorter than the 30d rider window: console access is higher blast-radius
const REFRESH_GRACE_MS = 20000; // see the replay-grace note in refresh()

/** Fields safe to return to the browser. Never includes passwordHash. */
const PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lastLoginIp: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
};

function signAdminTokens(adminId, role) {
  const tokenId = uuidv4();

  const accessToken = jwt.sign(
    { adminId, role, type: 'admin_access', tokenId },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRY, jwtid: uuidv4() }
  );

  const refreshToken = jwt.sign(
    { adminId, role, type: 'admin_refresh', tokenId },
    env.JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_DAYS}d` }
  );

  return { accessToken, refreshToken, tokenId };
}

async function storeAdminRefreshToken(adminId, role, tokenId) {
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenId, adminId, role, expiresAt },
  });
}

function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new ValidationError('Password must be at least 12 characters');
  }
  // Console accounts are few and long-lived, so a real composition rule is
  // cheap here in a way it would not be for consumer signup.
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ValidationError('Password must contain lower case, upper case and a digit');
  }
}

function normaliseEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new ValidationError('A valid email is required');
  }
  return email.trim().toLowerCase();
}

// ─── Login ────────────────────────────────────────────────────────

async function login({ email, password, ip, userAgent }) {
  const normalised = normaliseEmail(email);

  const admin = await prisma.adminUser.findUnique({ where: { email: normalised } });

  // Same generic error and a bcrypt comparison against a dummy hash whether or
  // not the account exists, so response timing and wording cannot be used to
  // enumerate which console emails are real.
  if (!admin) {
    await bcrypt.compare(String(password || ''), '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    throw new AuthError('Invalid email or password');
  }

  if (!admin.isActive) {
    throw new AuthError('This account has been disabled');
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const mins = Math.ceil((admin.lockedUntil - Date.now()) / 60000);
    throw new AuthError(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const valid = await bcrypt.compare(String(password || ''), admin.passwordHash);

  if (!valid) {
    const failedLoginCount = admin.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_LOGINS;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    logger.warn(`[adminAuth] failed login for ${normalised} (${failedLoginCount}/${MAX_FAILED_LOGINS}) from ${ip || 'unknown ip'}`);
    throw new AuthError('Invalid email or password');
  }

  const { accessToken, refreshToken, tokenId } = signAdminTokens(admin.id, admin.role);
  await storeAdminRefreshToken(admin.id, admin.role, tokenId);

  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip || null,
    },
    select: PUBLIC_SELECT,
  });

  await writeAuditLog({
    admin: updated,
    action: 'admin.login',
    targetType: 'AdminUser',
    targetId: admin.id,
    method: 'POST',
    path: '/api/admin/auth/login',
    statusCode: 200,
    ip,
    userAgent,
  });

  return { accessToken, refreshToken, admin: updated };
}

// ─── Refresh ──────────────────────────────────────────────────────

async function refresh(token) {
  if (!token) throw new AuthError('No refresh token provided');

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new AuthError('Invalid refresh token');
  }

  if (decoded.type !== 'admin_refresh') throw new AuthError('Invalid refresh token');

  const stored = await prisma.refreshToken.findUnique({ where: { tokenId: decoded.tokenId } });
  if (!stored || stored.adminId !== decoded.adminId) throw new AuthError('Invalid refresh token');
  if (stored.expiresAt < new Date()) throw new AuthError('Session expired. Sign in again.');

  // Replay grace, mirroring REFRESH_GRACE_MS in auth.service.js. The console's
  // middleware rotates on navigation, so two requests firing together can both
  // present the same refresh token; the second would otherwise see the row the
  // first just revoked and sign the admin out mid-click. A few seconds of reuse
  // is the accepted trade — outside the window a revoked token is still a hard
  // failure, so a genuinely stolen token does not stay usable.
  if (stored.revokedAt && Date.now() - stored.revokedAt.getTime() > REFRESH_GRACE_MS) {
    throw new AuthError('Session expired. Sign in again.');
  }

  // Re-read the account on every refresh. A role change, a disable, or a
  // deletion must take effect within one access-token lifetime rather than
  // riding on whatever the token claimed when it was minted.
  const admin = await prisma.adminUser.findUnique({
    where: { id: decoded.adminId },
    select: PUBLIC_SELECT,
  });
  if (!admin) throw new AuthError('Account no longer exists');
  if (!admin.isActive) throw new AuthError('This account has been disabled');

  // Only stamp revokedAt the first time. Re-stamping on each grace-window reuse
  // would slide the window forward indefinitely under steady traffic, so the
  // token would never actually expire.
  await prisma.refreshToken.updateMany({
    where: { tokenId: decoded.tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const { accessToken, refreshToken: nextRefresh, tokenId } = signAdminTokens(admin.id, admin.role);
  await storeAdminRefreshToken(admin.id, admin.role, tokenId);

  return { accessToken, refreshToken: nextRefresh, admin };
}

// ─── Logout ───────────────────────────────────────────────────────

async function logout(tokenId) {
  if (!tokenId) return;
  await prisma.refreshToken.updateMany({
    where: { tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Kills every live session for an admin. Used on disable, role change and password change. */
async function revokeAllSessions(adminId) {
  const { count } = await prisma.refreshToken.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

// ─── Password ─────────────────────────────────────────────────────

async function changePassword(adminId, { currentPassword, newPassword }) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw new NotFoundError('Admin not found');

  const valid = await bcrypt.compare(String(currentPassword || ''), admin.passwordHash);
  if (!valid) throw new AuthError('Current password is incorrect');

  assertPasswordStrength(newPassword);
  if (await bcrypt.compare(newPassword, admin.passwordHash)) {
    throw new ValidationError('New password must be different from the current one');
  }

  await prisma.adminUser.update({
    where: { id: adminId },
    data: {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      mustChangePassword: false,
    },
  });

  // Every other device holding a session for this account loses it. The one
  // doing the change keeps working because its refresh row is untouched only
  // if we exclude it — we do not, deliberately: a password change is the
  // action you take when you think something is compromised, so all sessions
  // including this one must be re-established.
  const revoked = await revokeAllSessions(adminId);
  return { revokedSessions: revoked };
}

// ─── Admin user management (SUPERADMIN only, enforced at the route) ──

async function listAdmins() {
  return prisma.adminUser.findMany({
    select: PUBLIC_SELECT,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
}

async function createAdmin({ email, name, password, role }, createdById) {
  const normalised = normaliseEmail(email);
  if (!name || String(name).trim().length < 2) throw new ValidationError('Name is required');
  if (!ADMIN_ROLES.includes(role)) {
    throw new ValidationError(`Role must be one of: ${ADMIN_ROLES.join(', ')}`);
  }
  assertPasswordStrength(password);

  const existing = await prisma.adminUser.findUnique({ where: { email: normalised } });
  if (existing) throw new AppError('An admin with that email already exists', 409);

  return prisma.adminUser.create({
    data: {
      email: normalised,
      name: String(name).trim(),
      role,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      mustChangePassword: true,
      createdById: createdById || null,
    },
    select: PUBLIC_SELECT,
  });
}

async function updateAdmin(adminId, { name, role, isActive }, actingAdminId) {
  const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!target) throw new NotFoundError('Admin not found');

  const data = {};
  if (name !== undefined) {
    if (!name || String(name).trim().length < 2) throw new ValidationError('Name is required');
    data.name = String(name).trim();
  }
  if (role !== undefined) {
    if (!ADMIN_ROLES.includes(role)) {
      throw new ValidationError(`Role must be one of: ${ADMIN_ROLES.join(', ')}`);
    }
    data.role = role;
  }
  if (isActive !== undefined) data.isActive = !!isActive;

  // You cannot demote or disable yourself. Without this an operator can lock
  // the whole organisation out of the console in one click, and there is no
  // second superadmin guaranteed to exist to undo it.
  if (adminId === actingAdminId) {
    if (data.role && data.role !== target.role) {
      throw new AppError('You cannot change your own role', 403);
    }
    if (data.isActive === false) {
      throw new AppError('You cannot disable your own account', 403);
    }
  }

  // Never allow the last active superadmin to stop being one.
  const losingSuperadmin =
    target.role === 'SUPERADMIN' &&
    ((data.role && data.role !== 'SUPERADMIN') || data.isActive === false);
  if (losingSuperadmin) {
    const remaining = await prisma.adminUser.count({
      where: { role: 'SUPERADMIN', isActive: true, id: { not: adminId } },
    });
    if (remaining === 0) {
      throw new AppError('There must be at least one active superadmin', 409);
    }
  }

  const updated = await prisma.adminUser.update({
    where: { id: adminId },
    data,
    select: PUBLIC_SELECT,
  });

  // A role downgrade or a disable must not wait for the old access token to
  // age out, so drop the sessions immediately.
  if (data.isActive === false || (data.role && data.role !== target.role)) {
    await revokeAllSessions(adminId);
  }

  return updated;
}

async function resetAdminPassword(adminId, newPassword) {
  const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!target) throw new NotFoundError('Admin not found');
  assertPasswordStrength(newPassword);

  await prisma.adminUser.update({
    where: { id: adminId },
    data: {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  const revoked = await revokeAllSessions(adminId);
  return { revokedSessions: revoked };
}

// ─── Audit log ────────────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'token', 'accesstoken',
  'refreshtoken', 'secret', 'fcmtoken', 'authorization', 'passwordhash',
]);

/** Strips credentials before anything is persisted or shown in the log UI. */
function redact(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Append-only write. Best-effort by design: an audit-log failure must never
 * turn a completed admin action into an error response, because the action has
 * already happened by the time this runs. Failures are logged loudly instead.
 */
async function writeAuditLog({
  admin, action, targetType, targetId, method, path, payload, statusCode, ip, userAgent,
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: admin?.id || null,
        adminEmail: admin?.email || 'unknown',
        adminRole: admin?.role || 'unknown',
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        method,
        path,
        payload: payload ? JSON.stringify(redact(payload)) : null,
        statusCode,
        ip: ip || null,
        userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
      },
    });
  } catch (err) {
    logger.error(`[adminAudit] FAILED to record "${action}" by ${admin?.email || 'unknown'}: ${err.message}`);
  }
}

async function getAuditLogs({ page = 1, limit = 50, adminId, action, targetId, from, to } = {}) {
  const take = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const where = {};
  if (adminId) where.adminId = adminId;
  if (action) where.action = { contains: String(action), mode: 'insensitive' };
  if (targetId) where.targetId = targetId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [data, total] = await Promise.all([
    prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return { data, total, page: Number(page) || 1, limit: take };
}

module.exports = {
  ADMIN_ROLES,
  PUBLIC_SELECT,
  login,
  refresh,
  logout,
  revokeAllSessions,
  changePassword,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  writeAuditLog,
  getAuditLogs,
  redact,
};
