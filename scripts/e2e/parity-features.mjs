/**
 * ── THE 2026-10-10 PARITY FEATURES, AND THE OWNERSHIP CLASS ─────────────────
 *
 * One hailed ride driven end to end, exercising everything the parity pass
 * added on the way: ride prefs + pickup note on the offer, masked/direct
 * calling, the wait fee, mid-ride stops, cash change to the wallet, referral
 * rewards, the 30-day inbox, lost items. Then every ownership fix of the
 * 2026-10-11 hunt, as the attacker would try it.
 *
 *   node scripts/e2e/parity-features.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  section, check, summary, info, GET, POST, PATCH, req, makeRider, makeDriver, goOnline, boardEveryone,
  until, advanceTrip, ACCRA, BASE,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(path.join(here, '..', '..', 'eyego-api', 'package.json'));
apiRequire('dotenv').config({ path: path.join(here, '..', '..', 'eyego-api', '.env') });
const { PrismaClient } = apiRequire('@prisma/client');
const db = new PrismaClient();

const ctx = {};
const NOTE = 'Blue gate beside the pharmacy';
const STOP = { lat: 5.5891, lng: -0.1987, address: 'Kaneshie Market, Accra' };

async function balance(rider) {
  const b = await GET('/wallet/balance', { token: rider.token });
  return b.balancePesewas ?? b.walletBalancePesewas ?? b.balance;
}
async function driverView() {
  const s = await GET('/rides/driver/state', { token: ctx.driver.token });
  const offer = s?.offer?.tripId === ctx.tripId ? s.offer : null;
  return offer ?? (s?.pendingRequests ?? []).find((r) => r.tripId === ctx.tripId) ?? null;
}
async function expectStatus(method, p, token, body, want) {
  const { status, body: b } = await req(method, p, { token, body, raw: true });
  const code = b?.code ?? b?.error?.code;
  if (!want.includes(status)) throw new Error(`expected ${want.join('/')}, got ${status} ${JSON.stringify(b).slice(0, 160)}`);
  return `${status}${code ? ` ${code}` : ''}`;
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · referral, before the first ride');
  await check('an inviter has a code; a new rider redeems it; nobody redeems their own', async () => {
    ctx.inviter = await makeRider('E2E Inviter');
    ctx.rider = await makeRider('E2E Parity Rider');
    ctx.stranger = await makeRider('E2E Stranger');
    const { code } = await GET('/user/me/referral', { token: ctx.inviter.token });
    if (!code) throw new Error('no referral code');
    ctx.code = code;
    await expectStatus('POST', '/user/me/referral/redeem', ctx.inviter.token, { code }, [400]);
    const r = await POST('/user/me/referral/redeem', { code }, { token: ctx.rider.token });
    await expectStatus('POST', '/user/me/referral/redeem', ctx.rider.token, { code }, [409]);
    return `code ${code} · reward ${r.rewardPesewas} each`;
  });

  section('2 · prefs + pickup note reach the driver');
  await check('ride prefs save and read back', async () => {
    await PATCH('/user/me/preferences', { ride: { quiet: true, ac: true } }, { token: ctx.rider.token });
    const p = await GET('/user/me/preferences', { token: ctx.rider.token });
    const ride = p.preferences?.ride ?? p.ride;
    if (!ride?.quiet || !ride?.ac || ride?.luggage) throw new Error(`prefs ${JSON.stringify(p)}`);
    return 'quiet + AC';
  });

  await check('ride requested with a pickup note', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Parity Driver' });
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const q = await POST('/rides/quote', {
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, tier: 'ECO',
    }, { token: ctx.rider.token });
    const r = await POST('/rides', {
      quoteId: q.quoteId,
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
      pickupAddress: 'Kwame Nkrumah Circle, Accra', dropoffAddress: 'Dansoman High Street, Accra',
      paymentMethod: 'CASH', pickupNote: `  ${NOTE}  `,
    }, { token: ctx.rider.token });
    ctx.tripId = (r.trip ?? r)?.id ?? r.tripId;
    if (!ctx.tripId) throw new Error('no trip id');
    return ctx.tripId.slice(0, 8);
  });
  if (!ctx.tripId) return;

  await check('the offer carries the note (trimmed) and the switches', async () => {
    const v = await until(driverView, { timeoutMs: 30000, everyMs: 1000, label: 'driver sees the ride' });
    if (v.pickupNote !== NOTE) throw new Error(`pickupNote ${JSON.stringify(v.pickupNote)}`);
    const prefs = [...(v.ridePrefs ?? [])].sort().join(',');
    if (prefs !== 'ac,quiet') throw new Error(`ridePrefs ${prefs}`);
    return `"${v.pickupNote}" · ${prefs}`;
  });

  section('3 · ownership while searching');
  await check('a stranger cannot cancel someone else’s ride', () =>
    expectStatus('POST', `/rides/${ctx.tripId}/cancel`, ctx.stranger.token, { reason: 'grief' }, [403]));

  section('4 · accept, call, wait, start');
  await check('driver accepts and reaches the pickup', async () => {
    await POST(`/rides/${ctx.tripId}/accept`, {}, { token: ctx.driver.token });
    const a = await advanceTrip(ctx.driver.token, ctx.tripId, 'arrived', 'ARRIVED_AT_PICKUP');
    return a.already ? 'auto-arrived at accept' : a.status;
  });

  await check('the rider can call their driver (DIRECT with no voice number set)', async () => {
    const c = await POST('/contact/call', { tripId: ctx.tripId, calleeRole: 'DRIVER' }, { token: ctx.rider.token });
    if (c.mode === 'DIRECT' && !c.phone) throw new Error('DIRECT without a number');
    return `${c.mode}${c.phone ? ` → …${String(c.phone).slice(-4)}` : ''}`;
  });

  await check('…a stranger cannot', () =>
    expectStatus('POST', '/contact/call', ctx.stranger.token, { tripId: ctx.tripId, calleeRole: 'DRIVER' }, [403]));

  await check('8 minutes at the pickup → a wait fee on /rides/:id/start (the delegated start)', async () => {
    await db.trip.update({ where: { id: ctx.tripId }, data: { arrivedAt: new Date(Date.now() - 8 * 60_000) } });
    const before = await db.booking.findFirst({ where: { tripId: ctx.tripId }, select: { id: true, fareAmountPesewas: true } });
    ctx.bookingId = before.id;
    await boardEveryone(ctx.driver.token, ctx.tripId);
    await POST(`/rides/${ctx.tripId}/start`, {}, { token: ctx.driver.token });
    const after = await db.booking.findUnique({ where: { id: ctx.bookingId }, select: { fareAmountPesewas: true, waitFeePesewas: true } });
    if (!(after.waitFeePesewas > 0)) throw new Error(`waitFeePesewas ${after.waitFeePesewas}`);
    if (after.fareAmountPesewas !== before.fareAmountPesewas + after.waitFeePesewas) {
      throw new Error(`fare ${before.fareAmountPesewas} → ${after.fareAmountPesewas}, fee ${after.waitFeePesewas}`);
    }
    return `+${after.waitFeePesewas} for 5 chargeable minutes`;
  });

  section('5 · a stop added mid-ride');
  await check('quote, refuse a stale price, apply the quoted one', async () => {
    const q = await POST(`/rides/${ctx.tripId}/route/quote`, { kind: 'stop', ...STOP }, { token: ctx.rider.token });
    if (!Number.isFinite(q.farePesewas)) throw new Error(`quote ${JSON.stringify(q)}`);
    await expectStatus('POST', `/rides/${ctx.tripId}/route`, ctx.rider.token,
      { kind: 'stop', ...STOP, expectedFarePesewas: q.farePesewas + 50_00 }, [409]);
    const a = await POST(`/rides/${ctx.tripId}/route`, { kind: 'stop', ...STOP, expectedFarePesewas: q.farePesewas }, { token: ctx.rider.token });
    ctx.fareAfterStop = a.farePesewas;
    return `${q.deltaPesewas >= 0 ? '+' : ''}${q.deltaPesewas} → ${a.farePesewas}`;
  });

  await check('…only the rider who booked may change it', () =>
    expectStatus('POST', `/rides/${ctx.tripId}/route/quote`, ctx.stranger.token, { kind: 'stop', ...STOP }, [403]));

  await check('driver reaches the stop and continues — once', async () => {
    const t = await db.trip.findUnique({ where: { id: ctx.tripId }, select: { dropoffAddress: true, onwardStops: true } });
    if (t.dropoffAddress !== STOP.address || (t.onwardStops ?? []).length !== 1) {
      throw new Error(`next ${t.dropoffAddress}, queue ${JSON.stringify(t.onwardStops)}`);
    }
    await POST(`/driver/trips/${ctx.tripId}/next-stop`, {}, { token: ctx.driver.token });
    await expectStatus('POST', `/driver/trips/${ctx.tripId}/next-stop`, ctx.driver.token, {}, [409]);
    return 'stop → final destination';
  });

  section('6 · complete, cash change, referral');
  await check('complete', async () => {
    ctx.inviterBefore = await balance(ctx.inviter);
    ctx.riderBefore = await balance(ctx.rider);
    const c = await advanceTrip(ctx.driver.token, ctx.tripId, 'complete', 'COMPLETED');
    return c.status;
  });

  await check('cash over the fare → the change lands in the rider’s wallet, once', async () => {
    const b = await db.booking.findUnique({ where: { id: ctx.bookingId }, select: { fareAmountPesewas: true } });
    const r = await POST(`/driver/trips/${ctx.tripId}/bookings/${ctx.bookingId}/cash-received`,
      { amountPesewas: b.fareAmountPesewas + 5_00 }, { token: ctx.driver.token });
    if (r.changePesewas !== 5_00) throw new Error(`change ${r.changePesewas}`);
    await expectStatus('POST', `/driver/trips/${ctx.tripId}/bookings/${ctx.bookingId}/cash-received`,
      ctx.driver.token, { amountPesewas: b.fareAmountPesewas + 5_00 }, [409]);
    return '+500 to the rider';
  });

  await check('first completed ride pays the referral to both sides', async () => {
    const reward = await until(async () => {
      const i = await balance(ctx.inviter);
      return i > ctx.inviterBefore ? i - ctx.inviterBefore : null;
    }, { timeoutMs: 15000, everyMs: 1000, label: 'inviter credited' });
    const riderGain = (await balance(ctx.rider)) - ctx.riderBefore;
    if (riderGain !== reward + 5_00) throw new Error(`rider +${riderGain}, expected referral ${reward} + change 500`);
    return `+${reward} each (rider also +500 change)`;
  });

  await check('calling after the ride is over is refused (no number harvesting)', () =>
    expectStatus('POST', '/contact/call', ctx.rider.token, { tripId: ctx.tripId, calleeRole: 'DRIVER' }, [409]));

  section('7 · the 30-day inbox');
  await check('rider: the ride, the change and the referral, in the inbox window', async () => {
    const { outcomes } = await GET('/bookings/outcomes?days=30', { token: ctx.rider.token });
    const kinds = new Set(outcomes.map((o) => o.kind));
    for (const k of ['COMPLETED', 'CASH_CHANGE', 'REFERRAL_REWARD']) if (!kinds.has(k)) throw new Error(`no ${k} in ${[...kinds]}`);
    return [...kinds].join(',');
  });
  await check('driver: the completed trip', async () => {
    const { outcomes } = await GET('/driver/outcomes?days=30', { token: ctx.driver.token });
    if (!outcomes.some((o) => o.kind === 'TRIP_COMPLETED' && o.tripId === ctx.tripId)) throw new Error(outcomes.map((o) => o.kind).join(','));
    return `${outcomes.length} facts`;
  });

  section('8 · lost item');
  await check('rider reports it once; a stranger cannot', async () => {
    const r = await POST(`/bookings/trips/${ctx.tripId}/lost-item`, { description: 'Black phone in a red case' }, { token: ctx.rider.token });
    ctx.lostTicket = r.ticketId;
    await expectStatus('POST', `/bookings/trips/${ctx.tripId}/lost-item`, ctx.rider.token, { description: 'again' }, [409]);
    await expectStatus('POST', `/bookings/trips/${ctx.tripId}/lost-item`, ctx.stranger.token, { description: 'not mine' }, [404]);
    return ctx.lostTicket.slice(0, 8);
  });
  await check('driver sees it, answers Found; the rider hears back', async () => {
    const { items } = await GET('/driver/lost-items', { token: ctx.driver.token });
    if (!items.some((i) => (i.ticketId ?? i.id) === ctx.lostTicket)) throw new Error('not on the driver list');
    await POST(`/driver/lost-items/${ctx.lostTicket}/answer`, { found: true, note: 'It is in the glovebox' }, { token: ctx.driver.token });
    await until(async () => {
      const { outcomes } = await GET('/bookings/outcomes?days=30', { token: ctx.rider.token });
      return outcomes.find((o) => o.kind === 'SUPPORT_REPLY' && o.ticketId === ctx.lostTicket);
    }, { timeoutMs: 10000, label: 'SUPPORT_REPLY for the lost item' });
    return 'found → rider told';
  });

  section('9 · a complaint about the driver is not the driver’s to read');
  await check('"Unsafe driving" hidden from the driver; "Incorrect fare" shown', async () => {
    const safety = await POST(`/bookings/${ctx.tripId}/dispute`, { type: 'Unsafe driving', description: 'Ran two red lights' }, { token: ctx.rider.token });
    const fare = await POST(`/bookings/${ctx.tripId}/dispute`, { type: 'Incorrect fare', description: 'Charged twice' }, { token: ctx.rider.token });
    const { tickets } = await GET('/driver/support-tickets', { token: ctx.driver.token });
    const ids = new Set(tickets.map((t) => t.id));
    if (ids.has((safety.ticket ?? safety).id)) throw new Error('the accused driver can read the safety complaint');
    if (!ids.has((fare.ticket ?? fare).id)) throw new Error('the fare dispute is missing from the driver list');
    await expectStatus('POST', `/driver/support-tickets/${(safety.ticket ?? safety).id}/reply`, ctx.driver.token, { message: 'hi' }, [404]);
    return 'SAFETY hidden · TRIP shown · reply refused';
  });

  section('10 · a shared bus');
  await check('a driver publishes a bus; a rider holds seat 1', async () => {
    ctx.busDriver = await makeDriver({ name: 'E2E Bus Driver', seaterCount: 14 });
    const t = await POST('/driver/trips', {
      originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
      destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
      departureTime: new Date(Date.now() + 90 * 60_000).toISOString(), availableSeats: 6, tier: 'ECONOMY',
    }, { token: ctx.busDriver.token });
    ctx.busId = (t.trip ?? t).id;
    ctx.busRider = await makeRider('E2E Bus Rider');
    await POST('/bookings', { tripId: ctx.busId, seatNumber: 1, paymentMethod: 'CASH' }, { token: ctx.busRider.token });
    return ctx.busId.slice(0, 8);
  });
  if (ctx.busId) {
    await check('a passenger cannot cancel the whole bus through /rides', () =>
      expectStatus('POST', `/rides/${ctx.busId}/cancel`, ctx.busRider.token, { reason: 'grief' }, [409]));
    await check('someone with no seat cannot lead a group and hold every seat', async () => {
      const out = await expectStatus('POST', `/trips/${ctx.busId}/group`, ctx.stranger.token, { isCoverAll: true }, [403]);
      const held = await db.booking.count({ where: { tripId: ctx.busId, userId: ctx.stranger.id } });
      if (held) throw new Error(`${held} seats held in the stranger's name`);
      return out;
    });
    await check('the seated host still can', async () => {
      await POST(`/trips/${ctx.busId}/group`, { isCoverAll: true }, { token: ctx.busRider.token });
      const n = await db.booking.count({ where: { tripId: ctx.busId, userId: ctx.busRider.id, isCoveredByLead: true } });
      return `${n} seats covered`;
    });
  }

  section('11 · map reports and GraphQL');
  await check('a driver’s map report is not readable by a rider', async () => {
    const r = await POST('/map-reports/driver', { type: 'ADD_PLACE', lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng, name: 'E2E place' }, { token: ctx.driver.token });
    return expectStatus('GET', `/map-reports/${(r.report ?? r).id}`, ctx.stranger.token, undefined, [404]);
  });
  const gql = (query, token) => req('POST', `${BASE}/graphql`, { token, body: { query }, raw: true });
  await check('GraphQL trip: no login → refused; stranger → null; the rider → the trip', async () => {
    const q = `{ trip(id: "${ctx.tripId}") { id status } }`;
    const anon = await gql(q);
    if (!anon.body?.errors?.length) throw new Error(`anonymous read: ${JSON.stringify(anon.body).slice(0, 120)}`);
    const s = await gql(q, ctx.stranger.token);
    if (s.body?.data?.trip !== null) throw new Error(`stranger read: ${JSON.stringify(s.body).slice(0, 120)}`);
    const me = await gql(q, ctx.rider.token);
    if (me.body?.data?.trip?.id !== ctx.tripId) throw new Error(`rider read: ${JSON.stringify(me.body).slice(0, 120)}`);
    return 'refused · null · own trip';
  });
  await check('GraphQL Driver no longer has phone or wallet', async () => {
    const r = await gql(`{ trip(id: "${ctx.tripId}") { driver { phone walletBalancePesewas } } }`, ctx.rider.token);
    if (!r.body?.errors?.some((e) => /phone|walletBalance/.test(e.message))) throw new Error(JSON.stringify(r.body).slice(0, 160));
    return 'schema refuses both fields';
  });
}

main()
  .catch((e) => info(`harness crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`))
  .finally(async () => {
    if (ctx.busId) await POST(`/driver/trips/${ctx.busId}/cancel`, { reason: 'e2e teardown' }, { token: ctx.busDriver.token }).catch(() => {});
    if (ctx.tripId && ctx.driver) await POST(`/rides/${ctx.tripId}/driver-cancel`, { reason: 'e2e teardown' }, { token: ctx.driver.token }).catch(() => {});
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    await db.$disconnect().catch(() => {});
    process.exit(summary() ? 1 : 0);
  });
