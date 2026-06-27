'use strict';

const { Router } = require('express');
const controller = require('./wallet.controller');
const { authenticateDriver, requireActiveDriver } = require('../../middleware/driverAuth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();

router.use(authenticateDriver);

router.get('/', controller.getWallet);
router.get('/balance', controller.getBalance);
router.get('/transactions', controller.getTransactions);

router.post(
  '/topup',
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least GHS 1'),
  validate,
  controller.topUp
);

router.post(
  '/withdraw',
  requireActiveDriver,
  body('amount').isFloat({ min: 20 }).withMessage('Minimum withdrawal is GHS 20'),
  validate,
  controller.withdraw
);

// Payout account management
router.get('/payout-account', controller.getPayoutAccount);
router.patch(
  '/payout-account',
  body('type').isIn(['bank', 'momo']),
  validate,
  controller.updatePayoutAccount
);

module.exports = router;
