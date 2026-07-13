'use strict';

const { Router } = require('express');
const controller = require('./quests.controller');
const { authenticateDriver } = require('../../middleware/driverAuth');

const router = Router();

router.use(authenticateDriver);

// GET /v1/quests — list active quests with driver progress
router.get('/', controller.listActiveQuests);

// GET /v1/quests/history — completed/rewarded quests
router.get('/history', controller.listQuestHistory);

// POST /v1/quests/:questId/claim — credit wallet for a completed quest
router.post('/:questId/claim', controller.claimQuest);

module.exports = router;
