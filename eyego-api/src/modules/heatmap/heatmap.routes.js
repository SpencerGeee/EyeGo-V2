'use strict';

const { Router } = require('express');
const controller = require('./heatmap.controller');
const { authenticateDriver } = require('../../middleware/driverAuth');

const router = Router();

// GET /v1/heatmap — demand heat map cells (driver-auth only)
router.get('/', authenticateDriver, controller.getDemand);

module.exports = router;
