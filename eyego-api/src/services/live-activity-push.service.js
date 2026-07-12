'use strict';

/**
 * Direct-to-APNs client for iOS Live Activity (ActivityKit) updates.
 *
 * This is DELIBERATELY separate from push.service.js (Firebase/FCM). Live
 * Activities are updated over HTTP/2 straight to Apple's push gateway using
 * a JWT signed with an APNs Auth Key — Firebase/FCM cannot deliver
 * `apns-push-type: liveactivity` payloads, so this bypasses Firebase
 * entirely, exactly like Uber/Bolt do.
 *
 * Setup required (see env.js for the full checklist):
 *   APNS_AUTH_KEY            — contents of the .p8 key from Apple Developer
 *   APNS_KEY_ID               — the key's ID (Apple Developer → Keys)
 *   APNS_TEAM_ID               — your Apple Developer Team ID
 *   APNS_LIVE_ACTIVITY_TOPIC   — widget extension bundle id, e.g.
 *                                 "com.eyego.rider.LiveActivity"
 *   APNS_ENVIRONMENT           — 'sandbox' (dev/TestFlight-via-Xcode) or
 *                                 'production' (TestFlight/App Store)
 *
 * Until those are set, every call below is a no-op (logged once) so the
 * rest of the app keeps working — same graceful-degradation pattern as
 * push.service.js for Firebase.
 */

const http2 = require('http2');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

const APNS_HOST = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

let cachedToken = null; // { token, signedAt }
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000; // Apple allows up to 1h; refresh at 50m

function apnsReady() {
  return Boolean(env.APNS_AUTH_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_LIVE_ACTIVITY_TOPIC);
}

let warnedOnce = false;
function warnNotConfigured() {
  if (warnedOnce) return;
  warnedOnce = true;
  logger.warn(
    'APNs Live Activity push skipped — not configured. Set APNS_AUTH_KEY, ' +
    'APNS_KEY_ID, APNS_TEAM_ID, APNS_LIVE_ACTIVITY_TOPIC in .env to enable ' +
    'Live Activity lock-screen updates. See env.js for how to obtain these ' +
    'from your Apple Developer account.'
  );
}

/** ES256 JWT bearer token for the `authorization` header, per Apple's provider-token auth. */
function getBearerToken() {
  const now = Date.now();
  if (cachedToken && now - cachedToken.signedAt < TOKEN_MAX_AGE_MS) {
    return cachedToken.token;
  }

  const privateKey = (env.APNS_AUTH_KEY || '').replace(/\\n/g, '\n');
  const token = jwt.sign(
    {
      iss: env.APNS_TEAM_ID,
      iat: Math.floor(now / 1000),
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: env.APNS_KEY_ID,
      },
    }
  );

  cachedToken = { token, signedAt: now };
  return token;
}

/**
 * Send one Live Activity push to a single device push token via raw HTTP/2.
 * `event` is one of 'update' | 'end'; `contentState` mirrors the Swift
 * ContentState shape defined in apps/rider/targets/live-activity.
 *
 * Resolves to true on a 200 from Apple, false otherwise (never throws —
 * push failures must never break trip-status handling upstream).
 */
async function sendLiveActivityPush(pushToken, { event, contentState, dismissalDate, alert, staleDate } = {}) {
  if (!apnsReady()) {
    warnNotConfigured();
    return false;
  }
  if (!pushToken) return false;

  const host = APNS_HOST[env.APNS_ENVIRONMENT] || APNS_HOST.sandbox;

  const payload = {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event, // 'update' | 'end'
      'content-state': contentState || {},
      ...(staleDate ? { 'stale-date': staleDate } : {}),
      ...(dismissalDate ? { 'dismissal-date': dismissalDate } : {}),
      ...(alert ? { alert } : {}),
    },
  };
  const body = Buffer.from(JSON.stringify(payload));

  return new Promise((resolve) => {
    let client;
    try {
      client = http2.connect(host);
    } catch (err) {
      logger.warn('APNs: failed to open HTTP/2 connection', { error: err.message });
      resolve(false);
      return;
    }

    client.on('error', (err) => {
      logger.warn('APNs: HTTP/2 connection error', { error: err.message });
      resolve(false);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      authorization: `bearer ${getBearerToken()}`,
      'apns-topic': env.APNS_LIVE_ACTIVITY_TOPIC,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    let status = null;
    let responseBody = '';

    req.on('response', (headers) => {
      status = headers[':status'];
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { responseBody += chunk; });
    req.on('end', () => {
      client.close();
      if (status === 200) {
        resolve(true);
      } else {
        logger.warn('APNs: Live Activity push rejected', { status, body: responseBody, pushTokenPrefix: pushToken.slice(0, 12) });
        resolve(false);
      }
    });
    req.on('error', (err) => {
      logger.warn('APNs: request error', { error: err.message });
      client.close();
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/** Convenience wrapper: push an in-progress content-state update. */
function pushUpdate(pushToken, contentState, opts = {}) {
  return sendLiveActivityPush(pushToken, { event: 'update', contentState, ...opts });
}

/** Convenience wrapper: push the final content-state and end the activity. */
function pushEnd(pushToken, contentState, opts = {}) {
  // dismissalDate defaults to "now" so the Activity is removed promptly
  // instead of lingering on the lock screen for up to 4h (Apple's default).
  const dismissalDate = opts.dismissalDate ?? Math.floor(Date.now() / 1000);
  return sendLiveActivityPush(pushToken, { event: 'end', contentState, dismissalDate });
}

module.exports = { apnsReady, sendLiveActivityPush, pushUpdate, pushEnd };
