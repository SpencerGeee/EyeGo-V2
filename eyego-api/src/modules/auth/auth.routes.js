'use strict';

const { Router } = require('express');
const controller = require('./auth.controller');
const authenticate = require('../../middleware/auth');
const { authLimiter, otpLimiter } = require('../../middleware/rateLimiter');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();

// ─── Passenger ───────────────────────────────────────
router.post(
  '/request-otp',
  otpLimiter,
  body('phone').notEmpty().withMessage('Phone number is required'),
  validate,
  controller.requestOtp
);

router.post(
  '/verify-otp',
  authLimiter,
  body('phone').notEmpty(),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  validate,
  controller.verifyOtp
);

router.post(
  '/google',
  authLimiter,
  body('idToken').notEmpty().withMessage('ID token is required'),
  validate,
  controller.googleAuth
);

router.post(
  '/apple',
  authLimiter,
  body('idToken').notEmpty().withMessage('ID token is required'),
  validate,
  controller.appleAuth
);

router.post(
  '/refresh',
  body('refreshToken').notEmpty(),
  validate,
  controller.refresh
);

router.post('/logout', authenticate, controller.logout);

// ─── Driver ───────────────────────────────────────
router.post(
  '/driver/request-otp',
  otpLimiter,
  body('phone').notEmpty().withMessage('Phone number is required'),
  validate,
  controller.driverRequestOtp
);

router.post(
  '/driver/verify-otp',
  authLimiter,
  body('phone').notEmpty(),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  validate,
  controller.driverVerifyOtp
);

router.post(
  '/driver/refresh',
  body('refreshToken').notEmpty(),
  validate,
  controller.driverRefresh
);

module.exports = router;
