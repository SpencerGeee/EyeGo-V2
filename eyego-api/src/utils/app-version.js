'use strict';

/**
 * COMPARING APP VERSIONS, AND DECIDING WHETHER A BUILD IS STILL SERVED.
 *
 * A native build already installed on a phone cannot be recalled. Removing the
 * store listing stops new installs and nothing else; an OTA update cannot reach
 * a build whose JavaScript crashes before the update check runs. The one lever
 * that always works is the server declining to talk to it.
 *
 * So: clients send `x-eyego-app` and `x-eyego-version`, this compares the
 * version against the operator's minimum, and `requireSupportedClient` refuses
 * write routes with 426 Upgrade Required.
 */

/**
 * Semver-ish compare. Returns <0, 0 or >0.
 *
 * Deliberately tolerant, because the input is a header from a client we have
 * already decided we do not trust: missing segments count as 0, non-numeric
 * segments count as 0, and any pre-release suffix is ignored ("1.2.0-beta.3"
 * compares equal to "1.2.0"). A build labelled with a pre-release tag is either
 * an internal build, which should not be gated out mid-test, or a store build
 * whose tag is cosmetic.
 */
function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? '')
      .trim()
      .split('-')[0]
      .split('.')
      .map((n) => {
        const i = parseInt(n, 10);
        return Number.isFinite(i) ? i : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length, 3);

  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** 'rider' | 'driver' | null, from the header, allow-listed rather than trusted. */
function appFromRequest(req) {
  const raw = String(req.headers['x-eyego-app'] || '').toLowerCase();
  return raw === 'rider' || raw === 'driver' ? raw : null;
}

function versionFromRequest(req) {
  return String(req.headers['x-eyego-version'] || '').trim();
}

function platformFromRequest(req) {
  const raw = String(req.headers['x-eyego-platform'] || '').toLowerCase();
  return raw === 'ios' || raw === 'android' ? raw : null;
}

/**
 * What the operator requires of this app right now.
 *
 * `settings` is required lazily: this module is loaded by app.js while the
 * settings registry is still being wired, and requiring it at module scope
 * makes a cycle.
 */
function releaseGateFor(app, platform) {
  const settings = require('../config/settings');
  const key = app === 'driver' ? 'DRIVER' : 'RIDER';
  const plat = platform === 'ios' ? 'IOS' : 'ANDROID';

  return {
    minVersion: String(settings.get(`MIN_SUPPORTED_VERSION_${key}`) || '').trim(),
    storeUrl: String(settings.get(`STORE_URL_${key}_${plat}`) || '').trim() || null,
    maintenance: settings.get('MAINTENANCE_MODE') === true,
    maintenanceMessage: String(settings.get('MAINTENANCE_MESSAGE') || '').trim(),
  };
}

/**
 * True when this request comes from a build older than the operator's minimum.
 *
 * FAILS OPEN in two cases, both deliberate:
 *   - no minimum is configured (the gate is off, which is the default)
 *   - the client sent no version (an older build that predates the header, or
 *     a non-app caller such as the admin console or a test script)
 *
 * The second is the uncomfortable one, and it is still right: refusing every
 * unidentified caller would break the console and every existing installed
 * build the moment this shipped. The gate earns its keep against the builds
 * that come AFTER it, which is the only population it can ever protect.
 */
function isUnsupported(req) {
  const app = appFromRequest(req);
  if (!app) return false;

  const version = versionFromRequest(req);
  if (!version) return false;

  const { minVersion } = releaseGateFor(app, platformFromRequest(req));
  if (!minVersion) return false;

  return compareVersions(version, minVersion) < 0;
}

/**
 * Express middleware. Mount on the routers that change state; leave reads open
 * so a stale client can still show a trip in progress while it tells its user
 * to update. Someone mid-ride on an old build must not be cut off from seeing
 * where their driver is.
 */
function requireSupportedClient(req, res, next) {
  if (!isUnsupported(req)) return next();

  const app = appFromRequest(req);
  const gate = releaseGateFor(app, platformFromRequest(req));

  return res.status(426).json({
    success: false,
    message: 'This version of the app is no longer supported. Please update to continue.',
    code: 'UPGRADE_REQUIRED',
    data: {
      minVersion: gate.minVersion,
      yourVersion: versionFromRequest(req),
      storeUrl: gate.storeUrl,
    },
  });
}

module.exports = {
  compareVersions,
  appFromRequest,
  versionFromRequest,
  platformFromRequest,
  releaseGateFor,
  isUnsupported,
  requireSupportedClient,
};
