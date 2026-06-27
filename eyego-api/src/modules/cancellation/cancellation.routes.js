'use strict';

const { Router } = require('express');
const controller = require('./cancellation.controller');
const authenticate = require('../../middleware/auth');

const router = Router();

router.use(authenticate);

// GET /v1/cancellation/:bookingId/fee — get cancellation fee estimate
router.get('/:bookingId/fee', controller.getCancellationFee);

// POST /v1/cancellation/:bookingId/cancel — cancel with fee calculation
router.post('/:bookingId/cancel', controller.cancelBookingWithFee);

module.exports = router;
