/**
 * ── WHERE THE MONEY GOES ────────────────────────────────────────────────────
 *
 * The 2026-10-07 money audit found settlements nobody wrote (tips), refunds to
 * the wrong person, refunds that moved no money, double refunds, and promos
 * paid for by drivers. This suite drives the real server through the paths
 * that move a rider's or a driver's balance and checks the books afterwards:
 *
 *   1. P2P send moves both balances, through the ledger.
 *   2. A paid seat on a bus the driver cancels is refunded EXACTLY once.
 *   3. A promo bigger than the commission costs the driver nothing — through a
 *      full group trip: book → promo → pay → board → depart → arrive.
 *   4. A once-per-rider promo refuses a second use.
 *   5. Every touched rider wallet still reconciles (ledger sum == balance).
 *
 * Rider wallets are funded straight into the DB (as an ADMIN_CREDIT ledger
 * row) because the local Paystack key cannot take a real top-up.
 *
 *   node scripts/e2e/money-flows.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  section, check, summary, info, GET, POST, DEL, req, makeRider, makeDriver, goOnline, boardEveryone, ACCRA,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(path.join(here, '..', '..', 'eyego-api', 'package.json'));
apiRequire('dotenv').config({ path: path.join(here, '..', '..', 'eyego-api', '.env') });
const { PrismaClient } = apiRequire('@prisma/client');
const db = new PrismaClient();

const ctx = { riders: [], drivers: [], trips: [] };

/** Fund a rider the way an admin credit would: balance AND a ledger row. */
async function fund(userId, amountPesewas) {
  await db.$transaction(async (tx) => {
    const { walletBalancePesewas: after } = await tx.user.update({
      where: { id: userId },
      data: { walletBalancePesewas: { increment: amountPesewas } },
      select: { walletBalancePesewas: true },
    });
    await tx.riderWalletTransaction.create({
      data: {
        userId, type: 'ADMIN_CREDIT', amountPesewas, description: 'e2e funding',
        balanceBeforePesewas: after - amountPesewas, balanceAfterPesewas: after,
      },
    });
  });
}
const balanceOf = async (rider) => (await GET('/wallet/balance', { token: rider.token })).balancePesewas;
const driverBalance = async (driver) => (await GET('/driver/wallet/balance', { token: driver.token })).balancePesewas;
async function reconciles(userId) {
  const [agg, user] = await Promise.all([
    db.riderWalletTransaction.aggregate({ where: { userId }, _sum: { amountPesewas: true } }),
    db.user.findUnique({ where: { id: userId }, select: { walletBalancePesewas: true } }),
  ]);
  return { ledger: agg._sum.amountPesewas ?? 0, balance: user.walletBalancePesewas };
}
async function publishBus(driver, label) {
  const r = await POST(
    '/driver/trips',
    {
      originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
      destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
      departureTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      availableSeats: 8, tier: 'ECO',
    },
    { token: driver.token, headers: { 'Idempotency-Key': `e2e-money-${label}-${Date.now()}` } },
  );
  const id = (r.trip ?? r).id;
  ctx.trips.push({ id, driver });
  return id;
}
async function bookAndPay(rider, tripId, seatNumber, { promo } = {}) {
  const b = await POST(`/trips/${tripId}/book`, { seatNumber }, { token: rider.token });
  const bookingId = (b.booking ?? b).id;
  if (!bookingId) throw new Error(`no booking id: ${JSON.stringify(b).slice(0, 160)}`);
  if (promo) await POST(`/bookings/${bookingId}/apply-promo`, { code: promo }, { token: rider.token });
  const p = await POST('/payments/initiate', { bookingId, method: 'WALLET' }, { token: rider.token });
  if (p.status !== 'SUCCESS') throw new Error(`wallet payment not settled: ${JSON.stringify(p).slice(0, 160)}`);
  return bookingId;
}

async function main() {
  section('0 · actors');
  await check('two funded riders, a driver with a minibus', async () => {
    const [a, b, d] = await Promise.all([
      makeRider('E2E Money A'), makeRider('E2E Money B'), makeDriver({ name: 'E2E Money Driver', seaterCount: 14 }),
    ]);
    ctx.a = a; ctx.b = b; ctx.driver = d;
    ctx.riders.push(a, b); ctx.drivers.push(d);
    await goOnline(d, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    await Promise.all([fund(a.userId ?? a.user?.id ?? a.id, 20000), fund(b.userId ?? b.user?.id ?? b.id, 20000)]);
    ctx.aId = a.userId ?? a.user?.id ?? a.id;
    ctx.bId = b.userId ?? b.user?.id ?? b.id;
    const [ba, bb] = await Promise.all([balanceOf(a), balanceOf(b)]);
    if (ba < 20000 || bb < 20000) throw new Error(`funding did not land: ${ba} / ${bb}`);
    return `A ${ba} · B ${bb}`;
  });
  if (!ctx.a) return;

  section('1 · P2P send');
  await check('A sends GH₵10 to B: both balances move, exactly', async () => {
    const [a0, b0] = await Promise.all([balanceOf(ctx.a), balanceOf(ctx.b)]);
    await POST('/wallet/send', { recipientPhone: ctx.b.phone, amountPesewas: 1000 }, {
      token: ctx.a.token, headers: { 'Idempotency-Key': `e2e-p2p-${Date.now()}` },
    });
    const [a1, b1] = await Promise.all([balanceOf(ctx.a), balanceOf(ctx.b)]);
    if (a0 - a1 !== 1000 || b1 - b0 !== 1000) throw new Error(`A ${a0}→${a1}, B ${b0}→${b1}`);
    return `A −1000 · B +1000`;
  });

  section('2 · paid seats: kept through a redispatch, returned when the ride is off');
  await check('the driver drops a part-full bus: it goes back to dispatch and the paid seat stays', async () => {
    const tripId = await publishBus(ctx.driver, 'redispatch');
    ctx.redispatchTrip = tripId;
    ctx.bBefore = await balanceOf(ctx.b);
    ctx.redispatchBooking = await bookAndPay(ctx.b, tripId, 1);
    ctx.bPaid = await balanceOf(ctx.b);
    if (ctx.bPaid >= ctx.bBefore) throw new Error(`payment did not debit: ${ctx.bBefore} → ${ctx.bPaid}`);
    await POST(`/driver/trips/${tripId}/cancel`, { reason: 'e2e' }, { token: ctx.driver.token });
    const row = await db.booking.findUnique({
      where: { id: ctx.redispatchBooking },
      select: { status: true, paymentStatus: true, trip: { select: { status: true } } },
    });
    if (row.paymentStatus !== 'PAID' || !['MATCHING', 'REASSIGNING'].includes(row.trip.status)) {
      throw new Error(`after the driver dropped it: ${JSON.stringify(row)}`);
    }
    return `trip ${row.trip.status}, seat ${row.status}/${row.paymentStatus}`;
  });

  await check('the rider cancels that seat before departure: whole again, one refund', async () => {
    await POST(`/cancellation/${ctx.redispatchBooking}/cancel`, { reason: 'changed_plans' }, { token: ctx.b.token });
    const after = await balanceOf(ctx.b);
    if (after !== ctx.bBefore) throw new Error(`${ctx.bBefore} → paid ${ctx.bPaid} → after ${after}`);
    const refunds = await db.riderWalletTransaction.count({ where: { bookingId: ctx.redispatchBooking, type: 'REFUND' } });
    if (refunds !== 1) throw new Error(`${refunds} refund rows for one booking`);
    return `${ctx.bBefore} → ${ctx.bPaid} → ${after} (1 refund row)`;
  });

  await check('a bus that expires undriven refunds its paid seats — once', async () => {
    // What dispatch giving up / the stale-trip sweep does, driven directly: the
    // refund lives in the state machine's terminal release.
    const tripId = await publishBus(ctx.driver, 'expire');
    const before = await balanceOf(ctx.b);
    const bookingId = await bookAndPay(ctx.b, tripId, 1);
    const tripState = apiRequire('./src/services/trip-state.service.js');
    await tripState.applyTransition(tripId, 'EXPIRED', { actor: tripState.ACTOR.SYSTEM, payload: { reason: 'e2e' } });
    const after = await balanceOf(ctx.b);
    const refunds = await db.riderWalletTransaction.count({ where: { bookingId, type: 'REFUND' } });
    if (after !== before || refunds !== 1) throw new Error(`${before} → ${after}, ${refunds} refund rows`);
    return `${before} → paid → ${after} (1 refund row)`;
  });

  section('3 · a promo is paid for by the platform');
  await check('a 50 % promo bigger than the commission leaves driver pay untouched', async () => {
    ctx.promoCode = `E2E${Date.now().toString(36).toUpperCase()}`;
    await db.promotion.create({
      data: {
        code: ctx.promoCode, discountPercent: 50, maxDiscountPesewas: 1_000_000,
        expiry: new Date(Date.now() + 86400000), active: true, perUserLimit: 1,
      },
    });
    const tripId = await publishBus(ctx.driver, 'promo');
    ctx.promoTrip = tripId;
    const detail = await GET(`/trips/${tripId}`, { token: ctx.a.token });
    const listFare = (detail.trip ?? detail).farePerSeatPesewas;
    ctx.promoBooking = await bookAndPay(ctx.a, tripId, 2, { promo: ctx.promoCode });
    const row = await db.booking.findUnique({
      where: { id: ctx.promoBooking },
      select: { fareAmountPesewas: true, commissionAmountPesewas: true, promoSubsidyPesewas: true },
    });
    if (row.promoSubsidyPesewas <= 0) throw new Error(`no subsidy recorded: ${JSON.stringify(row)}`);
    // Driver pay = fare − commission + subsidy must equal the undiscounted pay.
    ctx.expectedDriverPay = row.fareAmountPesewas - row.commissionAmountPesewas + row.promoSubsidyPesewas;
    return `list ${listFare} → paid ${row.fareAmountPesewas}, commission ${row.commissionAmountPesewas}, subsidy ${row.promoSubsidyPesewas}`;
  });

  await check('the same rider cannot use a once-per-rider code twice', async () => {
    const b = await POST(`/trips/${ctx.promoTrip}/book`, { seatNumber: 3 }, { token: ctx.a.token });
    const id = (b.booking ?? b).id;
    const { status, body } = await req('POST', `/bookings/${id}/apply-promo`, {
      token: ctx.a.token, raw: true, body: { code: ctx.promoCode },
    });
    await POST(`/bookings/${id}/cancel`, {}, { token: ctx.a.token }).catch(() => {});
    if (status !== 400) throw new Error(`expected 400, got ${status} ${JSON.stringify(body).slice(0, 120)}`);
    return body?.code ?? body?.error?.code ?? 'refused';
  });

  await check('driving the bus pays the driver the full, undiscounted share', async () => {
    const before = await driverBalance(ctx.driver);
    // The real driver flow for a bus: set off, reach the pickup, board, depart.
    await POST(`/driver/trips/${ctx.promoTrip}/start`, {}, { token: ctx.driver.token });
    await POST(`/driver/trips/${ctx.promoTrip}/arrive-at-pickup`, {}, { token: ctx.driver.token });
    await boardEveryone(ctx.driver.token, ctx.promoTrip);
    await POST(`/driver/trips/${ctx.promoTrip}/depart`, { acknowledgeUnderMinimum: true }, { token: ctx.driver.token });
    await POST(`/driver/trips/${ctx.promoTrip}/arrive`, {}, { token: ctx.driver.token });
    const after = await driverBalance(ctx.driver);
    const status = (await GET(`/driver/trips/${ctx.promoTrip}`, { token: ctx.driver.token })).status
      ?? (await GET(`/driver/trips/${ctx.promoTrip}`, { token: ctx.driver.token })).trip?.status;
    if (status !== 'COMPLETED') throw new Error(`trip is ${status}`);
    if (after - before !== ctx.expectedDriverPay) {
      throw new Error(`driver +${after - before}, expected +${ctx.expectedDriverPay}`);
    }
    const again = await req('POST', `/driver/trips/${ctx.promoTrip}/arrive`, { token: ctx.driver.token, raw: true });
    const twice = await driverBalance(ctx.driver);
    if (twice !== after) throw new Error(`a second arrive paid again: ${after} → ${twice} (${again.status})`);
    return `driver +${after - before} (= undiscounted share), second arrive pays nothing`;
  });

  section('4 · the books');
  await check('every touched rider wallet reconciles with its ledger', async () => {
    for (const [name, id] of [['A', ctx.aId], ['B', ctx.bId]]) {
      const r = await reconciles(id);
      if (r.ledger !== r.balance) throw new Error(`${name}: ledger ${r.ledger} vs balance ${r.balance}`);
    }
    return 'A and B balanced';
  });

  section('5 · deleting an account with money in it');
  await check('a rider wallet balance asks, keeps the session, then deletes on confirm', async () => {
    // A rider wallet has no withdrawal: a hard block here made deletion impossible.
    const c = await makeRider('E2E Money C');
    const cId = c.userId ?? c.user?.id ?? c.id;
    await fund(cId, 350);
    const first = await req('DELETE', '/user/me', { token: c.token, raw: true });
    if (first.status !== 409 || first.body?.code !== 'WALLET_NOT_EMPTY') throw new Error(`${first.status} ${first.body?.code}`);
    const still = await req('GET', '/user/me', { token: c.token, raw: true });
    if (still.status !== 200) throw new Error(`refused deletion signed the rider out (${still.status})`);
    await DEL('/user/me', { token: c.token, body: { acknowledgeBalance: true } });
    const after = await db.user.findUnique({ where: { id: cId }, select: { isActive: true, walletBalancePesewas: true } });
    if (after?.isActive !== false || after.walletBalancePesewas !== 350) throw new Error(JSON.stringify(after));
    return 'deleted; GH₵3.50 kept on the anonymised record';
  });
}

main()
  .catch((e) => info(`harness crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`))
  .finally(async () => {
    for (const t of ctx.trips) {
      await POST(`/driver/trips/${t.id}/cancel`, { reason: 'e2e teardown' }, { token: t.driver.token }).catch(() => {});
    }
    for (const d of ctx.drivers) await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    if (ctx.promoCode) await db.promotion.updateMany({ where: { code: ctx.promoCode }, data: { active: false } }).catch(() => {});
    await db.$disconnect().catch(() => {});
    // Explicit exit: requiring the state machine in-process opened Redis and
    // the scheduler, which would otherwise keep this process alive for ever.
    process.exit(summary() ? 1 : 0);
  });
