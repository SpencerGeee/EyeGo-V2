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

module.exports = router;
