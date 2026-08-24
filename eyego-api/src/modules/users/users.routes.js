'use strict';

const { Router } = require('express');
const controller = require('./users.controller');
const authenticate = require('../../middleware/auth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
// Configured allow-list + size cap. A bare `multer()` accepts any file of any
// size straight into process memory — see middleware/upload.js.
const { imageUpload: upload } = require('../../middleware/upload');

const router = Router();

router.use(authenticate);

router.get('/me', controller.getMe);

// "Is anything missing from my account?" — drives the rider app's completion
// prompt. Read-only and cheap; safe to call on every profile visit.
router.get('/me/account-checklist', controller.getAccountChecklist);

router.post('/avatar', upload.single('avatar'), controller.uploadAvatar);

router.patch(
  '/me',
  body('name').optional().notEmpty().trim(),
  body('preferredTier').optional().isIn(['ECO', 'COMFORT']),
  body('email').optional().isEmail(),
  body('businessMode').optional().isBoolean(),
  body('businessCompanyName').optional({ nullable: true }).trim(),
  body('businessTaxId').optional({ nullable: true }).trim(),
  body('businessExpenseEmail').optional({ nullable: true, checkFalsy: true }).isEmail(),
  validate,
  controller.updateMe
);

router.post(
  '/fcm-token',
  body('fcmToken').notEmpty(),
  validate,
  controller.updateFcmToken
);

router.delete('/me', controller.deleteMe);

router.get('/me/wallet', controller.getWalletAndPromos);
// Applied / available / already-used promotions for this rider, with expiry.
router.get('/me/promotions', controller.getPromotions);

router.post(
  '/me/support-tickets',
  body('subject').notEmpty(),
  body('message').notEmpty(),
  validate,
  controller.createSupportTicket
);

router.get('/me/support-tickets', controller.getSupportTickets);
router.get('/me/support-tickets/:ticketId', controller.getSupportTicket);

router.post(
  '/me/support-tickets/:ticketId/messages',
  body('text').notEmpty(),
  validate,
  controller.addTicketMessage
);

// ── Emergency contacts ───────────────────────────────────────────────
router.get('/me/emergency-contacts', controller.getEmergencyContacts);

router.put(
  '/me/emergency-contacts',
  body('contacts').isArray({ max: 3 }),
  body('contacts.*.name').notEmpty().trim(),
  body('contacts.*.phone').notEmpty().trim(),
  validate,
  controller.syncEmergencyContacts
);

// ── Notification preferences ─────────────────────────────────────────
router.get('/me/notifications', controller.getNotificationPreferences);

router.patch(
  '/me/notifications',
  body('driverArriving').optional().isBoolean(),
  body('tripStarted').optional().isBoolean(),
  body('tripCompleted').optional().isBoolean(),
  body('chatMessages').optional().isBoolean(),
  body('paymentConfirmations').optional().isBoolean(),
  body('promotions').optional().isBoolean(),
  body('newFeatures').optional().isBoolean(),
  body('safetyAlerts').optional().isBoolean(),
  validate,
  controller.updateNotificationPreferences
);

// ── App preferences (theme, etc) ─────────────────────────────────────
router.get('/me/preferences', controller.getPreferences);
router.patch('/me/preferences', controller.updatePreferences);

// ── Safety settings ──────────────────────────────────────────────────
router.get('/me/safety-settings', controller.getSafetySettings);

router.put(
  '/me/safety-settings',
  body('shareTrip').optional().isBoolean(),
  body('rideCheck').optional().isBoolean(),
  body('speedAlerts').optional().isBoolean(),
  body('nightSafety').optional().isBoolean(),
  validate,
  controller.updateSafetySettings
);

// Emergency insurance card — image upload, URL stored in the safetySettings
// JSON blob so GET /me/safety-settings returns it with no schema change.
router.post('/me/insurance', upload.single('card'), controller.uploadInsurance);

// ── Privacy settings ─────────────────────────────────────────────────
router.get('/me/privacy-settings', controller.getPrivacySettings);

router.put(
  '/me/privacy-settings',
  body('locationSharing').optional().isBoolean(),
  body('marketingNotifs').optional().isBoolean(),
  body('analytics').optional().isBoolean(),
  validate,
  controller.updatePrivacySettings
);

// ── Saved places ─────────────────────────────────────────────────────
router.get('/me/saved-places', controller.getSavedPlaces);

router.post(
  '/me/saved-places',
  body('label').notEmpty().trim(),
  body('address').notEmpty().trim(),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  body('icon').optional().isString().trim(),
  // Home and Work are SLOTS the rider chooses, not words we look for in the
  // label — see the long note on `createSavedPlace`. Anything else is a place
  // they can call whatever they like, and there may be any number of them.
  body('slot').optional({ nullable: true }).isIn(['HOME', 'WORK']),
  validate,
  controller.createSavedPlace
);

/**
 * Rename, re-pin, re-icon or re-slot an existing place.
 *
 * A list of freely-named places is only convenient if the names can be
 * corrected; the screen's only editing verb used to be Delete, so fixing a typo
 * in "Cyril's house" meant losing the pin and picking it again on a map.
 */
router.patch(
  '/me/saved-places/:placeId',
  body('label').optional().isString().trim().isLength({ min: 1, max: 60 }),
  body('address').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('lat').optional().isFloat({ min: -90, max: 90 }),
  body('lng').optional().isFloat({ min: -180, max: 180 }),
  body('icon').optional().isString().trim(),
  body('slot').optional({ nullable: true }).isIn(['HOME', 'WORK']),
  body('sortOrder').optional().isInt({ min: 0, max: 999 }),
  validate,
  controller.updateSavedPlace
);

router.delete('/me/saved-places/:placeId', controller.deleteSavedPlace);

module.exports = router;
