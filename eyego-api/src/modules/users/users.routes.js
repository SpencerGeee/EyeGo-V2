'use strict';

const { Router } = require('express');
const controller = require('./users.controller');
const authenticate = require('../../middleware/auth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const multer = require('multer');

const router = Router();
const upload = multer();

router.use(authenticate);

router.get('/me', controller.getMe);

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
  validate,
  controller.createSavedPlace
);

router.delete('/me/saved-places/:placeId', controller.deleteSavedPlace);

module.exports = router;
