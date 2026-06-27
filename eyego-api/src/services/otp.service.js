'use strict';

const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');

const OTP_EXPIRY_SECONDS = 10 * 60; // 10 minutes
const OFFLINE_OTP_EXPIRY_SECONDS = 15 * 60; // 15 minutes
const MAX_ATTEMPTS = 3;
const LOCK_DURATION_SECONDS = 30 * 60; // 30 minutes

// Cryptographically secure OTP generation (avoids Math.random bias)
function generateOtp(length = 6) {
  const max = Math.pow(10, length);
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

// Dev-only store: bypasses unstable Redis proxy in local development
const devStore = new Map(); // key → { otp, expiresAt }

async function storeOtp(phone) {
  const otp = generateOtp(6);

  if (env.NODE_ENV === 'development') {
    devStore.set(`otp:${phone}`, { otp, expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000 });
    return otp;
  }

  const key = `otp:${phone}`;
  const lockKey = `otp:lock:${phone}`;

  const isLocked = await redis.get(lockKey);
  if (isLocked) {
    const ttl = await redis.ttl(lockKey);
    throw Object.assign(new Error('Too many failed attempts. Try again later.'), {
      statusCode: 429,
      code: 'OTP_LOCKED',
      lockTtl: ttl,
    });
  }

  await redis.set(key, JSON.stringify({ otp, attempts: 0 }), 'EX', OTP_EXPIRY_SECONDS);
  return otp;
}

async function verifyOtp(phone, inputOtp) {
  if (env.NODE_ENV === 'development') {
    const entry = devStore.get(`otp:${phone}`);
    if (!entry || entry.expiresAt < Date.now()) {
      devStore.delete(`otp:${phone}`);
      throw Object.assign(new Error('OTP expired or not found. Please request a new one.'), {
        statusCode: 400,
        code: 'OTP_EXPIRED',
      });
    }
    if (entry.otp !== inputOtp) {
      throw Object.assign(new Error('Invalid OTP.'), {
        statusCode: 400,
        code: 'OTP_INVALID',
      });
    }
    devStore.delete(`otp:${phone}`);
    return true;
  }

  const key = `otp:${phone}`;
  const lockKey = `otp:lock:${phone}`;

  // Atomic check-and-increment via Lua — prevents concurrent requests from both
  // seeing attempts=0 and both succeeding (TOCTOU race condition).
  // Returns: "EXPIRED" | "LOCKED" | "INVALID:<remaining>" | "OK"
  const luaScript = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 'EXPIRED' end
    local data = cjson.decode(raw)
    if data.attempts >= tonumber(ARGV[2]) then
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
      return 'LOCKED'
    end
    if data.otp ~= ARGV[1] then
      data.attempts = data.attempts + 1
      local remaining = tonumber(ARGV[2]) - data.attempts
      local ttl = redis.call('TTL', KEYS[1])
      if ttl > 0 then
        redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ttl)
      else
        redis.call('SET', KEYS[1], cjson.encode(data))
      end
      if remaining <= 0 then
        redis.call('DEL', KEYS[1])
        redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
        return 'LOCKED'
      end
      return 'INVALID:' .. remaining
    end
    redis.call('DEL', KEYS[1])
    return 'OK'
  `;

  const result = await redis.eval(
    luaScript, 2, key, lockKey,
    inputOtp, String(MAX_ATTEMPTS), String(LOCK_DURATION_SECONDS)
  );

  if (result === 'EXPIRED') {
    throw Object.assign(new Error('OTP expired or not found. Please request a new one.'), {
      statusCode: 400, code: 'OTP_EXPIRED',
    });
  }
  if (result === 'LOCKED') {
    throw Object.assign(new Error('Too many failed attempts. Your account is locked for 30 minutes.'), {
      statusCode: 429, code: 'OTP_LOCKED',
    });
  }
  if (typeof result === 'string' && result.startsWith('INVALID:')) {
    const remaining = parseInt(result.split(':')[1], 10);
    throw Object.assign(new Error(`Invalid OTP. ${remaining} attempt(s) remaining.`), {
      statusCode: 400, code: 'OTP_INVALID', remaining,
    });
  }

  return true;
}

function generateOfflineOtp() {
  return generateOtp(4);
}

function offlineOtpExpiry() {
  return new Date(Date.now() + OFFLINE_OTP_EXPIRY_SECONDS * 1000);
}

module.exports = { storeOtp, verifyOtp, generateOfflineOtp, offlineOtpExpiry };
