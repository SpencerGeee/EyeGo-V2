'use strict';

const questsService = require('./quests.service');
const { ok } = require('../../utils/response');

const listActiveQuests = async (req, res) => {
  const driverId = req.user?.userId;
  const quests = await questsService.listActiveQuestsForDriver(driverId);
  ok(res, { quests });
};

const listQuestHistory = async (req, res) => {
  const driverId = req.user?.userId;
  const history = await questsService.listQuestHistoryForDriver(driverId);
  ok(res, { history });
};

module.exports = { listActiveQuests, listQuestHistory };
