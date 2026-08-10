'use strict';

const env = require('../config/env');
const logger = require('./logger');

/**
 * THE ORIGIN THIS API IS ACTUALLY REACHABLE AT.
 *
 * Share links (`/invite/:token`, `/track/:shortId`) used to be built from the
 * static `APP_URL` env var. During a sideload build the API is reached at
 * whatever tunnel/preview origin that run was given — so every link handed to
 * a rider pointed at a host the recipient's browser could not resolve, and the
 * shared ride was unopenable.
 *
 * So: remember the origin of real incoming requests and build links from that,
 * falling back to `APP_URL` before any request has been seen (a link minted by
 * a cron job at boot, say).
 *
 * Only proxy headers a trusted proxy set are honoured — Express populates
 * `req.protocol`/`req.hostname` from `X-Forwarded-*` only when `trust proxy`
 * is enabled, so an attacker cannot poison this by sending their own Host
 * header unless the deployment is already misconfigured.
 */

let observedOrigin = null;

const normalise = (url) => (url || '').replace(/\/+$/, '');

/**
 * Express middleware. Records the origin of each request.
 */
function rememberPublicOrigin(req, _res, next) {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    // Take the first value — proxies chain these as comma-separated lists.
    const origin = `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
    if (origin !== observedOrigin) {
      observedOrigin = origin;
      logger.info(`Public origin for share links is now ${origin}`);
    }
  }
  next();
}

/**
 * Base URL for anything a human will open in a browser.
 *
 * Pass `req` when you have one — it is exact. Without it, the last observed
 * origin is used, then `APP_URL`.
 */
function publicBaseUrl(req) {
  if (req) {
    const host = req.get?.('x-forwarded-host') || req.get?.('host');
    if (host) {
      const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
      return normalise(`${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`);
    }
  }
  return normalise(observedOrigin || env.APP_URL);
}

const inviteUrl = (shareToken, req) => `${publicBaseUrl(req)}/invite/${shareToken}`;
const trackingUrl = (shortId, req) => `${publicBaseUrl(req)}/track/${shortId}`;

module.exports = { rememberPublicOrigin, publicBaseUrl, inviteUrl, trackingUrl };
