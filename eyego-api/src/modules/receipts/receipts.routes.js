'use strict';

const { Router } = require('express');
const cancellationService = require('../cancellation/cancellation.service');
const authenticate = require('../../middleware/auth');
const { ok } = require('../../utils/response');

const router = Router();

router.use(authenticate);

// GET /v1/receipts — list all receipts for user
router.get('/', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await cancellationService.getUserReceipts(
    req.user.userId,
    Number(page),
    Number(limit),
  );
  ok(res, result);
});

// GET /v1/receipts/:bookingId — get receipt for a specific booking
router.get('/:bookingId', async (req, res) => {
  const receipt = await cancellationService.getReceipt(
    req.params.bookingId,
    req.user.userId,
  );
  ok(res, { receipt });
});

module.exports = router;
