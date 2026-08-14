'use strict';

const { Router } = require('express');
const controller = require('./wallet.controller');
const { authenticateDriver, requireActiveDriver } = require('../../middleware/driverAuth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const idempotency = require('../../middleware/idempotency');

const router = Router();

router.use(authenticateDriver);

router.get('/', controller.getWallet);
router.get('/balance', controller.getBalance);
router.get('/transactions', controller.getTransactions);

router.post(
  '/topup',
  idempotency, // safe retries: same Idempotency-Key never double-credits
  // PESEWAS. The old validator asked for cedis (`amount`, isFloat min 1) while
  // the service asserted integer pesewas, so the two disagreed about the unit
  // and no request could satisfy both. 100 pesewas = ₵1, the same floor.
  body('amountPesewas')
    .isInt({ min: 100 })
    .withMessage('The smallest top-up is GH₵1'),
  body('method')
    .optional()
    .isIn(['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO'])
    .withMessage('Choose a mobile money network'),
  validate,
  controller.topUp
);

router.post(
  '/withdraw',
  requireActiveDriver,
  idempotency, // safe retries: same Idempotency-Key never double-withdraws
  body('amountPesewas')
    .isInt({ min: 1 })
    .withMessage('Enter how much you want to withdraw'),
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
