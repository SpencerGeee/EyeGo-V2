'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const settings = require('../../config/settings');
const { ok } = require('../../utils/response');
const { authenticateAny } = require('../../middleware/auth');

/**
 * What the apps are allowed to know about the platform's configuration.
 *
 * This is the half of "change it without an app-store release" that lives on the
 * phone: fares, the seat-hold window, the wallet minimum, the support number and
 * an announcement banner all come from here, so changing them in the console
 * changes what the app shows on its next foreground.
 *
 * `settings.publicConfig()` is an EXPLICIT allow-list — adding an internal knob
 * to the registry can never leak it to a device. Authenticated because there is
 * no reason for it to be open, and cached for a minute at the edge because it
 * changes rarely and is polled by every app launch.
 */
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/public', authenticateAny, limiter, (req, res) => {
  res.set('cache-control', 'public, max-age=60');
  ok(res, settings.publicConfig());
});

/**
 * The release gate. UNAUTHENTICATED, and that is the entire point.
 *
 * `/public` above needs a token, which is fine for fares and seat-hold windows.
 * It is useless for the two questions an app has to answer BEFORE it can sign
 * anybody in:
 *
 *   - "am I too old to be trusted?" — a build old enough to be refused may also
 *     be old enough that its refresh flow no longer works, so requiring a valid
 *     token to learn it must upgrade is circular.
 *   - "is the platform down?" — a maintenance screen that only logged-in users
 *     can see is not a maintenance screen.
 *
 * It exposes nothing that is not already public knowledge: a minimum version,
 * a store link, and whether maintenance is on. Rate-limited on the same bucket
 * as the rest of this router because it is polled at every cold start.
 */
router.get('/client', limiter, (req, res) => {
  const appVersion = require('../../utils/app-version');
  const app = appVersion.appFromRequest(req) || (req.query.app === 'driver' ? 'driver' : 'rider');
  const platform = appVersion.platformFromRequest(req)
    || (req.query.platform === 'ios' ? 'ios' : 'android');

  const gate = appVersion.releaseGateFor(app, platform);

  // 30s rather than the 60s above: this is the switch you flip during an
  // incident, and a minute of staleness is a minute of an app you are trying
  // to stop still working.
  res.set('cache-control', 'public, max-age=30');
  ok(res, {
    app,
    platform,
    minVersion: gate.minVersion || null,
    storeUrl: gate.storeUrl,
    upgradeRequired: appVersion.isUnsupported(req),
    maintenance: gate.maintenance,
    maintenanceMessage: gate.maintenance ? gate.maintenanceMessage : null,
  });
});

module.exports = router;
