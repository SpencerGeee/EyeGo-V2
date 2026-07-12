'use strict';

const express = require('express');
const { Router } = require('express');
const controller = require('./payments.controller');
const authenticate = require('../../middleware/auth');
const { paymentInitiateLimiter } = require('../../middleware/rateLimiter');
const idempotency = require('../../middleware/idempotency');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();

// Webhook — no auth, needs raw body (captured in app.js before json parser)
router.post('/webhook', controller.webhook);

router.post(
  '/initiate',
  authenticate,
  paymentInitiateLimiter,
  idempotency, // safe retries: same Idempotency-Key never charges twice
  body('bookingId').notEmpty().withMessage('bookingId is required'),
  body('savedCardId').optional().isString(),
  validate,
  controller.initiatePayment
);

router.post('/verify/:reference', authenticate, controller.verifyPayment);

module.exports = router;
