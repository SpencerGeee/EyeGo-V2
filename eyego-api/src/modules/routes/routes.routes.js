'use strict';

const { Router } = require('express');
const controller = require('./routes.controller');

const router = Router();

router.get('/', controller.listRoutes);
router.get('/quick', controller.getQuickRoutes);
router.get('/:id', controller.getRoute);
router.get('/:id/stops', controller.getStops);

module.exports = router;
