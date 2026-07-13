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

const claimQuest = async (req, res) => {
  const driverId = req.user?.userId;
  const result = await questsService.claimQuestReward(driverId, req.params.questId);
  ok(res, result, `GHS ${result.rewardAmount.toFixed(2)} claimed for ${result.title}`);
};

module.exports = { listActiveQuests, listQuestHistory, claimQuest };
