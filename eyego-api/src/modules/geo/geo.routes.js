'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./geo.controller');
const { authenticateAny } = require('../../middleware/auth');

const router = Router();

/**
 * Typeahead fires on every keystroke (debounced client-side), so this needs a
 * far higher ceiling than the default API limiter — but still a ceiling, since
 * every call spends Mapbox quota.
 */
const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many location lookups, slow down.' },
});

router.use(authenticateAny, geoLimiter);

router.get('/search', controller.search);
router.get('/reverse', controller.reverse);
router.get('/route', controller.route);

module.exports = router;
