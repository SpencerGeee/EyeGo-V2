'use strict';

const crypto = require('crypto');
const prisma = require('../config/database');
const settings = require('../config/settings');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const { formatGhs } = require('../utils/money');

/**
 * ── RIDER → RIDER REFERRALS ──────────────────────────────────────────────────
 *
 * The Referral / ReferralBonus tables existed and nothing wrote them; the
 * promotions screen even said so. Now: every rider has a code; a new rider
 * redeems it (within NEW_ACCOUNT_DAYS of signing up, before their first
 * completed ride); after that first completed, paid ride BOTH get
 * REFERRAL_REWARD_PESEWAS in ride credits. Zero turns the programme off.
 *
 * Fraud guards: one referral per invitee (Referral.inviteeId is unique), no
 * self-referral (same account or same phone), only new accounts, rewarded once
 * (`bonusClaimed` flips inside the paying transaction).
 */
const NEW_ACCOUNT_DAYS = 30;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to misread

const reward = () => Number(settings.get('REFERRAL_REWARD_PESEWAS') ?? 0);

function mint(name) {
  const stem = String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'EYEGO';
  const tail = Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${stem}${tail}`;
}

/** This rider's code (minted on first read) and how it is doing. */
async function getReferral(userId) {
  let user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, referralCode: true } });
  for (let i = 0; !user.referralCode && i < 5; i += 1) {
    try {
      user = await prisma.user.update({ where: { id: userId }, data: { referralCode: mint(user.name) }, select: { name: true, referralCode: true } });
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // unique clash — try another
    }
  }
  const [invited, earned, mine] = await Promise.all([
    prisma.referral.count({ where: { inviterId: userId } }),
    prisma.referralBonus.aggregate({ where: { userId, status: 'CLAIMED' }, _sum: { amountPesewas: true } }),
    prisma.referral.findUnique({ where: { inviteeId: userId }, select: { bonusClaimed: true } }),
  ]);
  return {
    code: user.referralCode,
    rewardPesewas: reward(),
    invited,
    earnedPesewas: earned._sum.amountPesewas ?? 0,
    // Whether this rider was referred, and whether that reward has landed.
    redeemed: mine ? { rewarded: mine.bonusClaimed } : null,
  };
}

/** A new rider enters a friend's code. */
async function redeem(userId, rawCode) {
  if (!(reward() > 0)) throw new AppError('Referrals are paused right now.', 409, 'REFERRALS_OFF');
  const code = String(rawCode ?? '').trim().toUpperCase();
  const [me, inviter] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, phone: true, createdAt: true } }),
    code ? prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, phone: true, name: true } }) : null,
  ]);
  if (!inviter) throw new AppError('That code isn’t valid.', 404, 'REFERRAL_NOT_FOUND');
  if (inviter.id === me.id || inviter.phone === me.phone) throw new AppError('You can’t use your own code.', 400, 'SELF_REFERRAL');
  if (Date.now() - me.createdAt.getTime() > NEW_ACCOUNT_DAYS * 86_400_000) {
    throw new AppError('Referral codes are for new riders.', 409, 'NOT_NEW');
  }
  const rides = await prisma.booking.count({ where: { userId, status: 'COMPLETED' } });
  if (rides > 0) throw new AppError('Referral codes have to be used before your first ride.', 409, 'NOT_NEW');
  try {
    await prisma.referral.create({ data: { inviterId: inviter.id, inviteeId: userId } });
  } catch (err) {
    if (err?.code === 'P2002') throw new AppError('You’ve already used a referral code.', 409, 'ALREADY_REFERRED');
    throw err;
  }
  return { inviterName: inviter.name, rewardPesewas: reward() };
}

/**
 * After a trip completes: any of these riders on their first completed, paid
 * ride with an unclaimed referral → both sides are paid. Idempotent: the claim
 * flips `bonusClaimed` with a guarded updateMany inside the paying transaction.
 */
async function rewardFirstRides(userIds) {
  const amount = reward();
  if (!(amount > 0) || !userIds?.length) return 0;
  const pending = await prisma.referral.findMany({
    where: { inviteeId: { in: [...new Set(userIds)] }, bonusClaimed: false },
    select: { id: true, inviterId: true, inviteeId: true },
  });
  const riderWallet = require('./rider-wallet.service');
  const push = require('./push.service');
  let paid = 0;
  for (const r of pending) {
    const paidRides = await prisma.booking.count({ where: { userId: r.inviteeId, status: 'COMPLETED', paymentStatus: 'PAID' } });
    if (paidRides < 1) continue;
    const done = await prisma.$transaction(async (tx) => {
      const claim = await tx.referral.updateMany({ where: { id: r.id, bonusClaimed: false }, data: { bonusClaimed: true } });
      if (claim.count !== 1) return false;
      for (const userId of [r.inviterId, r.inviteeId]) {
        await riderWallet.record({ userId, type: 'REFERRAL', amountPesewas: amount, description: 'Referral reward', tx });
        await tx.paymentTransaction.create({ data: { userId, amountPesewas: amount, status: 'SUCCESS', gatewayResponse: 'REFERRAL_BONUS' } });
        await tx.referralBonus.create({ data: { referralId: r.id, userId, amountPesewas: amount, status: 'CLAIMED', claimedAt: new Date() } });
      }
      return true;
    });
    if (!done) continue;
    paid += 1;
    const users = await prisma.user.findMany({ where: { id: { in: [r.inviterId, r.inviteeId] } }, select: { id: true, fcmToken: true } });
    for (const u of users) {
      push
        .sendPush(u.fcmToken, 'Referral reward', `${formatGhs(amount)} in ride credits is in your wallet. Thanks for riding with a friend.`, { type: 'REFERRAL_REWARD' })
        .catch(() => {});
    }
  }
  if (paid) logger.info(`[referral] rewarded ${paid} referral(s)`);
  return paid;
}

module.exports = { getReferral, redeem, rewardFirstRides, mint };
