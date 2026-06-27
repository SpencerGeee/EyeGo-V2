'use strict';

const prisma = require('../../config/database');
const { NotFoundError, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/**
 * List active quests with the driver's current progress for each.
 */
async function listActiveQuestsForDriver(driverId) {
  const now = new Date();

  const quests = await prisma.driverQuest.findMany({
    where: {
      isActive: true,
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
    orderBy: { periodEnd: 'asc' },
  });

  // Fetch progress for each quest for this driver
  const progresses = await prisma.driverQuestProgress.findMany({
    where: {
      driverId,
      questId: { in: quests.map((q) => q.id) },
    },
  });

  const progressMap = new Map(progresses.map((p) => [p.questId, p]));

  return quests.map((quest) => {
    const prog = progressMap.get(quest.id);
    return {
      ...quest,
      progress: prog
        ? { current: prog.current, completed: prog.completed, rewardedAt: prog.rewardedAt }
        : { current: 0, completed: false, rewardedAt: null },
    };
  });
}

/**
 * List completed quest history for a driver (rewarded quests).
 */
async function listQuestHistoryForDriver(driverId) {
  const completed = await prisma.driverQuestProgress.findMany({
    where: { driverId, completed: true, rewardedAt: { not: null } },
    include: { quest: true },
    orderBy: { rewardedAt: 'desc' },
    take: 50,
  });

  return completed.map((p) => ({
    questId: p.questId,
    title: p.quest.title,
    description: p.quest.description,
    type: p.quest.type,
    target: p.quest.target,
    rewardAmount: p.quest.rewardAmount,
    current: p.current,
    rewardedAt: p.rewardedAt,
  }));
}

/**
 * Increment progress for a driver on matching active quests.
 * Called from within an existing $transaction (share the tx context).
 * If current >= target, marks completed and credits the driver wallet.
 */
async function incrementProgress(driverId, type, amount, tx) {
  if (!driverId || !type || amount <= 0) return;

  const now = new Date();

  const quests = await tx.driverQuest.findMany({
    where: {
      isActive: true,
      type,
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
  });

  for (const quest of quests) {
    // Upsert progress row (the upsert returns the row with current already incremented)
    const progress = await tx.driverQuestProgress.upsert({
      where: { questId_driverId: { questId: quest.id, driverId } },
      update: { current: { increment: amount } },
      create: { questId: quest.id, driverId, current: amount },
    });

    // Check if target met and not yet rewarded
    if (progress.current >= quest.target && !progress.completed) {
      // Credit wallet
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { walletBalance: true },
      });
      const balanceBefore = driver?.walletBalance ?? 0;

      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { increment: quest.rewardAmount } },
      });

      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'QUEST_BONUS',
          amount: quest.rewardAmount,
          description: `Quest bonus: ${quest.title}`,
          balanceBefore,
          balanceAfter: balanceBefore + quest.rewardAmount,
        },
      });

      // Mark progress as completed
      await tx.driverQuestProgress.update({
        where: { questId_driverId: { questId: quest.id, driverId } },
        data: { completed: true, rewardedAt: now },
      });

      logger.info(`Quest ${quest.id} completed for driver ${driverId}, bonus ${quest.rewardAmount} credited`);
    }
  }
}

module.exports = { listActiveQuestsForDriver, listQuestHistoryForDriver, incrementProgress };
