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
/**
 * The period a quest belongs to, as a stable string.
 *
 * Daily is the calendar date; weekly is the ISO week, so a "this week" quest
 * runs Monday to Sunday and resets once, rather than sliding forward every time
 * the regenerator happens to run.
 */
function periodKey(date, cadence) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (cadence === 'DAILY') return `${y}-${m}-${d}`;
  // ISO week number.
  const t = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Monday 00:00 and Sunday 23:59:59.999 of the week `date` falls in. */
function isoWeekBounds(date) {
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(start.getDate() - (day - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * THE QUEST LADDER.
 *
 * Two shapes only — RIDES_COUNT and EARNINGS — because those are the two things
 * anything actually calls `incrementProgress` with. A quest of a type nobody
 * increments is a card that can never move, which is worse than not offering it.
 *
 * TIERED, AND DELIBERATELY SUPER-LINEAR. Each rung pays more per unit than the
 * one below it, so the marginal trip is worth most exactly where a driver is
 * deciding whether to stop:
 *
 *   3 trips  → GH₵12   (₵4.00 a trip)
 *   8 trips  → GH₵38   (₵4.75)
 *  14 trips  → GH₵80   (₵5.71)
 *
 * They STACK — a driver who reaches 14 has also completed 3 and 8, and claims
 * all three — so the ladder reads as "keep going" rather than "you missed it".
 * The earnings ladder does the same against net fares, and the weekly rungs pay
 * for consistency across days rather than for one heroic shift.
 */
const QUEST_LADDER = [
  // ── daily: volume ──
  { slug: 'rides-daily-3', cadence: 'DAILY', type: 'RIDES_COUNT', target: 3, rewardCedis: 12,
    title: 'Daily Driver', description: 'Complete 3 trips today.' },
  { slug: 'rides-daily-8', cadence: 'DAILY', type: 'RIDES_COUNT', target: 8, rewardCedis: 38,
    title: 'Full Shift', description: 'Complete 8 trips today — pays more per trip than the first three.' },
  { slug: 'rides-daily-14', cadence: 'DAILY', type: 'RIDES_COUNT', target: 14, rewardCedis: 80,
    title: 'Road Warrior', description: 'Complete 14 trips today. Stacks with Daily Driver and Full Shift.' },

  // ── daily: money ──
  { slug: 'earn-daily-100', cadence: 'DAILY', type: 'EARNINGS', targetCedis: 100, rewardCedis: 15,
    title: 'Earnings Sprint', description: 'Take home GH₵100 in net fares today.' },
  { slug: 'earn-daily-250', cadence: 'DAILY', type: 'EARNINGS', targetCedis: 250, rewardCedis: 48,
    title: 'Big Day', description: 'Take home GH₵250 in net fares today.' },

  // ── weekly: consistency is what these pay for ──
  { slug: 'rides-week-25', cadence: 'WEEKLY', type: 'RIDES_COUNT', target: 25, rewardCedis: 45,
    title: 'Weekly Warrior', description: 'Complete 25 trips between Monday and Sunday.' },
  { slug: 'rides-week-60', cadence: 'WEEKLY', type: 'RIDES_COUNT', target: 60, rewardCedis: 140,
    title: 'Weekly Legend', description: 'Complete 60 trips this week. Stacks with Weekly Warrior.' },
  { slug: 'earn-week-500', cadence: 'WEEKLY', type: 'EARNINGS', targetCedis: 500, rewardCedis: 65,
    title: 'Weekly Champion', description: 'Take home GH₵500 in net fares this week.' },
  { slug: 'earn-week-1200', cadence: 'WEEKLY', type: 'EARNINGS', targetCedis: 1200, rewardCedis: 190,
    title: 'Top Earner', description: 'Take home GH₵1,200 in net fares this week.' },
];

/**
 * Refresh the standard quest set for the current period.
 *
 * BUGFIX ("the daily driver bonus doesn't reset — it says 10/3 rides and the
 * bonus has already been paid").
 *
 * This used FIXED ids (`q-rides-daily-3`) and simply moved the window forward
 * on each run. But progress lives in `DriverQuestProgress`, keyed on
 * `(questId, driverId)` — so re-pointing the same id at a new day carried
 * yesterday's `current`, yesterday's `completed` and, fatally, yesterday's
 * `rewardedAt` into it. A driver who did ten trips and claimed their bonus on
 * Monday opened the tab on Tuesday to "10/3" and a reward already taken, and
 * could never earn that bonus again. The daily quest was daily in name only.
 *
 * The id now carries the period, so every day and every ISO week is a genuinely
 * new quest row with no progress attached. Yesterday's row survives untouched,
 * which is what makes the History tab real rather than a reconstruction, and
 * expired rows are deactivated so the active list stays the current period only.
 */
async function regenerateStandardQuests() {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const week = isoWeekBounds(now);

  const questData = QUEST_LADDER.map((q) => {
    const daily = q.cadence === 'DAILY';
    return {
      id: `q-${q.slug}:${periodKey(now, q.cadence)}`,
      title: q.title,
      description: q.description,
      type: q.type,
      // `target`'s unit follows `type`: a COUNT of rides for RIDES_COUNT,
      // PESEWAS for EARNINGS. Written through `fromCedis` rather than as literal
      // pesewas so the numbers above still read as the amounts a human means.
      target: q.type === 'EARNINGS' ? fromCedis(q.targetCedis) : q.target,
      rewardAmountPesewas: fromCedis(q.rewardCedis),
      periodStart: daily ? startOfToday : week.start,
      periodEnd: daily ? endOfToday : week.end,
    };
  });

  for (const q of questData) {
    await prisma.driverQuest.upsert({
      where: { id: q.id },
      // The update is a no-op for period fields on purpose — an id belongs to
      // exactly one window, so re-running the regenerator inside the same day
      // must not move the goalposts under a driver who is halfway up a rung.
      update: {
        title: q.title,
        description: q.description,
        type: q.type,
        target: q.target,
        rewardAmountPesewas: q.rewardAmountPesewas,
        isActive: true,
      },
      create: { ...q, isActive: true },
    });
  }

  /**
   * Retire everything whose window has closed, AND the legacy fixed-id rows.
   *
   * The old scheme's ids (`q-rides-daily-3`, `q-earn-week-500`, …) carry no
   * period, so they are already sitting in the database pointed at today's
   * window with a full set of poisoned progress rows behind them — the very
   * "10/3 rides, already claimed" the period-keyed ids exist to prevent. They
   * will never be upserted again, so nothing retires them on its own and they
   * would go on being listed as active forever. Named explicitly rather than
   * matched by pattern: this is a one-time migration of four known rows, and a
   * pattern that also matched a future id would silently disable live quests.
   */
  const LEGACY_QUEST_IDS = [
    'q-rides-daily-3',
    'q-earn-daily-100',
    'q-rides-week-25',
    'q-earn-week-500',
  ];
  const retired = await prisma.driverQuest.updateMany({
    where: {
      isActive: true,
      OR: [{ periodEnd: { lt: now } }, { id: { in: LEGACY_QUEST_IDS } }],
    },
    data: { isActive: false },
  });

  logger.info(
    `Quest regeneration: ${questData.length} quests live for ${periodKey(now, 'DAILY')}, ` +
      `${retired.count} expired quests retired`,
  );
  return questData.length;
}

module.exports = { listActiveQuestsForDriver, listQuestHistoryForDriver, incrementProgress, regenerateStandardQuests, claimQuestReward, questUnit, periodKey, isoWeekBounds, QUEST_LADDER };
