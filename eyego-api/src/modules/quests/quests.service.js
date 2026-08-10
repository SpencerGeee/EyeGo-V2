'use strict';

const { formatGhs, fromCedis } = require('../../utils/money');

/**
 * What unit is this quest's `target`/`current` counted in?
 *
 * One table serves two kinds of goal, so the unit is data, not a constant. Any
 * screen or log line that renders a quest's numbers must ask this first —
 * rendering an EARNINGS target as a bare number prints "20000" for GH₵200.
 *
 * @returns {'PESEWAS'|'COUNT'}
 */
function questUnit(questType) {
  return questType === 'EARNINGS' ? 'PESEWAS' : 'COUNT';
}

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
      // The client cannot know whether `target`/`current` are rides or pesewas
      // from the numbers alone, so the unit ships with them. Without this the
      // Quests tab renders a GH₵200 earnings goal as "20000".
      unit: questUnit(quest.type),
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
    unit: questUnit(p.quest.type),
    target: p.quest.target,
    rewardAmountPesewas: p.quest.rewardAmountPesewas,
    current: p.current,
    rewardedAt: p.rewardedAt,
  }));
}

/**
 * Increment progress for a driver on matching active quests.
 *
 * `tx` is OPTIONAL and callers should usually omit it. Quest progress is
 * gamification, not money — nothing about a ride is wrong if it lands a moment
 * later — and running it inside the trip's interactive transaction meant N
 * sequential round trips to a cross-region database were charged against a 5s
 * transaction budget. That is what expired the transaction on "Mark as
 * arrived" and told the driver the trip could not be updated, on a tap whose
 * trip work had already succeeded.
 *
 * The per-quest work now runs concurrently rather than in a serial loop, so
 * the cost is one round trip's latency instead of one per active quest.
 */
async function incrementProgress(driverId, type, amount, tx = prisma) {
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

  await Promise.all(
    quests.map(async (quest) => {
      // Upsert progress row (the upsert returns the row with current already incremented)
      const progress = await tx.driverQuestProgress.upsert({
        where: { questId_driverId: { questId: quest.id, driverId } },
        update: { current: { increment: amount } },
        create: { questId: quest.id, driverId, current: amount },
      });

      // Target met — mark completed so the Quests tab can show a "Claim Reward"
      // button. The wallet is credited on-demand via claimQuestReward(), not
      // automatically here — the driver taps to claim, matching the reward
      // moment other quest/achievement UIs give.
      if (progress.current >= quest.target && !progress.completed) {
        await tx.driverQuestProgress.update({
          where: { questId_driverId: { questId: quest.id, driverId } },
          data: { completed: true },
        });

        logger.info(`Quest ${quest.id} completed for driver ${driverId} — awaiting claim`);
      }
    }),
  );
}

/**
 * Credit the driver's wallet for a completed-but-unclaimed quest.
 * Atomic conditional update (completed:true, rewardedAt:null in the WHERE
 * clause itself) so a double-tap or retry can never double-credit — same
 * pattern as wallet withdraw / send-money.
 */
async function claimQuestReward(driverId, questId) {
  const quest = await prisma.driverQuest.findUnique({ where: { id: questId } });
  if (!quest) throw new NotFoundError('Quest');

  const progress = await prisma.driverQuestProgress.findUnique({
    where: { questId_driverId: { questId, driverId } },
  });
  if (!progress || !progress.completed) {
    throw new AppError('Quest is not completed yet', 400, 'QUEST_NOT_COMPLETED');
  }
  if (progress.rewardedAt) {
    throw new AppError('Reward already claimed', 400, 'ALREADY_CLAIMED');
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.driverQuestProgress.updateMany({
      where: { questId, driverId, completed: true, rewardedAt: null },
      data: { rewardedAt: now },
    });
    if (claimed.count === 0) {
      throw new AppError('Reward already claimed', 400, 'ALREADY_CLAIMED');
    }

    const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { walletBalancePesewas: true } });
    const balanceBeforePesewas = driver?.walletBalancePesewas ?? 0;

    await tx.driver.update({
      where: { id: driverId },
      data: { walletBalancePesewas: { increment: quest.rewardAmountPesewas } },
    });

    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'QUEST_BONUS',
        amountPesewas: quest.rewardAmountPesewas,
        description: `Quest bonus: ${quest.title}`,
        balanceBeforePesewas,
        balanceAfterPesewas: balanceBeforePesewas + quest.rewardAmountPesewas,
      },
    });

    logger.info(`Quest ${questId} reward claimed by driver ${driverId}: ${formatGhs(quest.rewardAmountPesewas)}`);
    return { rewardAmountPesewas: quest.rewardAmountPesewas, title: quest.title };
  });
}

/**
 * Regenerate the standard daily/weekly quest set for the current period. Uses
 * fixed quest ids so this is a safe upsert to re-run on a schedule — previously
 * these rows only ever came from a one-time seed script with hardcoded dates, so
 * the Quests tab went permanently empty once those windows passed.
 */
async function regenerateStandardQuests() {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now); endOfWeek.setDate(endOfWeek.getDate() + 7);

  // `target`'s unit follows `type`: a COUNT of rides for RIDES_COUNT, PESEWAS
  // for EARNINGS. Written through `fromCedis` rather than as literal pesewas so
  // the numbers here still read as the amounts a human means — and so nobody
  // "tidies up" `fromCedis(100)` into `100` and turns a GH₵100 target into a
  // one-cedi one.
  const questData = [
    { id: 'q-rides-daily-3', title: 'Daily Driver', description: 'Complete 3 trips today to earn a bonus.', type: 'RIDES_COUNT', target: 3, rewardAmountPesewas: fromCedis(12), periodStart: startOfToday, periodEnd: endOfToday },
    { id: 'q-earn-daily-100', title: 'Earnings Sprint', description: 'Earn GHS 100 in net fares today for a bonus.', type: 'EARNINGS', target: fromCedis(100), rewardAmountPesewas: fromCedis(15), periodStart: startOfToday, periodEnd: endOfToday },
    { id: 'q-rides-week-25', title: 'Weekly Warrior', description: 'Complete 25 trips this week to unlock a reward.', type: 'RIDES_COUNT', target: 25, rewardAmountPesewas: fromCedis(40), periodStart: startOfToday, periodEnd: endOfWeek },
    { id: 'q-earn-week-500', title: 'Weekly Champion', description: 'Earn GHS 500 in net fares this week.', type: 'EARNINGS', target: fromCedis(500), rewardAmountPesewas: fromCedis(60), periodStart: startOfToday, periodEnd: endOfWeek },
  ];

  for (const q of questData) {
    await prisma.driverQuest.upsert({
      where: { id: q.id },
      update: { title: q.title, description: q.description, type: q.type, target: q.target, rewardAmountPesewas: q.rewardAmountPesewas, periodStart: q.periodStart, periodEnd: q.periodEnd, isActive: true },
      create: { ...q, isActive: true },
    });
  }

  logger.info(`Quest regeneration: refreshed ${questData.length} standard quests for current period`);
  return questData.length;
}

module.exports = { listActiveQuestsForDriver, listQuestHistoryForDriver, incrementProgress, regenerateStandardQuests, claimQuestReward, questUnit };
