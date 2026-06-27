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

module.exports = router;
