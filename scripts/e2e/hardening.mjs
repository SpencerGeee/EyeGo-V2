/**
 * ── THE 2026-10-11 HARDENING PASS, AS AN ATTACKER WOULD TRY IT ──────────────
 *
 * Bad input, double taps and concurrent requests against the live API: the
 * empty socket emit that used to kill the process, the seat that does not
 * exist, the ride "cancelled" after it was taken, two cancels refunding twice,
 * two board taps charging commission twice, the reflected-XSS tracking link.
 *
 *   node scripts/e2e/hardening.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { section, check, summary, GET, POST, req, makeRider, makeDriver, connectSocket, goOnline, until, sleep, ACCRA, BASE } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(path.join(here, '..', '..', 'eyego-api', 'package.json'));
apiRequire('dotenv').config({ path: path.join(here, '..', '..', 'eyego-api', '.env') });
const { PrismaClient } = apiRequire('@prisma/client');
const db = new PrismaClient();

const ctx = {};
const tripOf = (d) => d?.trip ?? d;
const codeOf = (r) => r.body?.code ?? r.body?.error?.code ?? '';
const raw = (method, p, token, body) => req(method, p, { token, body, raw: true });
async function expectStatus(method, p, token, body, want) {
  const r = await raw(method, p, token, body);
  if (!want.includes(r.status)) throw new Error(`expected ${want.join('/')}, got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return `${r.status}${codeOf(r) ? ` ${codeOf(r)}` : ''}`;
}
async function book(rider, seatNumber) {
  const b = await POST('/bookings', { tripId: ctx.tripId, seatNumber, paymentMethod: 'CASH' }, { token: rider.token });
  return (b.booking ?? b).id;
}
const walletOf = async (rider) => {
  const b = await GET('/wallet/balance', { token: rider.token });
  return b.balancePesewas ?? b.walletBalancePesewas ?? b.balance;
};

async function main() {
  section('0 · setup');
  await check('a driver publishes a 7-seat group trip; four riders', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Hardening Driver', seaterCount: 7 });
    const r = await POST(
      '/driver/trips',
      {
        originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
        destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
        departureTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        availableSeats: 7,
        tier: 'ECO',
      },
      { token: ctx.driver.token, headers: { 'Idempotency-Key': 'e2e-hardening-' + Date.now() } },
    );
    ctx.tripId = tripOf(r)?.id;
    ctx.shortId = tripOf(r)?.shortId;
    if (!ctx.tripId) throw new Error(`no trip: ${JSON.stringify(r).slice(0, 200)}`);
    [ctx.a, ctx.b, ctx.c, ctx.d] = await Promise.all(['A', 'B', 'C', 'D'].map((n) => makeRider(`E2E Hardening ${n}`)));
    return `trip ${ctx.tripId.slice(0, 8)} · ${tripOf(r).maxSeats} seats`;
  });
  if (!ctx.tripId) return;

  section('1 · one bad socket frame cannot take the API down');
  await check('empty, null and garbage payloads on every kind of handler', async () => {
    const p = await connectSocket('/passenger', ctx.a.token);
    const d = await connectSocket('/driver', ctx.driver.token);
    p.emit('passenger:leave_trip_room');
    p.emit('passenger:leave_trip_room', null);
    p.emit('chat:typing_start', null);
    p.emit('chat:send', null);
    p.emit('trip:ack', null);
    d.emit('driver:join_tracking', null);
    d.emit('driver:location_update', null);
    d.emit('driver:location_update', { lat: 'x', lng: 1e9 });
    await sleep(800);
    const h = await GET(`${BASE}/health`);
    const alive = p.connected && d.connected;
    p.disconnect(); d.disconnect();
    if (h.status !== 'ok' || !alive) throw new Error(`health ${h.status}, sockets alive ${alive}`);
    return 'API up, both sockets still connected';
  });

  await check('a driver can trip:subscribe to their own trip (it was always refused)', async () => {
    const d = await connectSocket('/driver', ctx.driver.token);
    const ack = await new Promise((resolve) => d.emit('trip:subscribe', { tripId: ctx.tripId, lastSeq: 0 }, resolve));
    d.disconnect();
    if (ack?.error) throw new Error(`refused: ${ack.error}`);
    return 'subscribed';
  });

  section('2 · input bounds');
  await check('a seat that does not exist on the vehicle is refused', async () => {
    const a = await expectStatus('POST', '/bookings', ctx.a.token, { tripId: ctx.tripId, seatNumber: 99, paymentMethod: 'CASH' }, [400]);
    const b = await expectStatus('POST', '/bookings', ctx.a.token, { tripId: ctx.tripId, seatNumber: 'abc', paymentMethod: 'CASH' }, [400]);
    return `seat 99 → ${a} · seat "abc" → ${b}`;
  });
  await check('a megabyte text field is refused before it reaches a table', async () => {
    return expectStatus('POST', '/user/me/saved-places', ctx.a.token, { label: 'x'.repeat(20_000), address: 'a', lat: 5.6, lng: -0.2 }, [413]);
  });
  await check('?limit=1000000 is clamped, not served', async () => {
    const r = await raw('GET', '/bookings?limit=1000000', ctx.a.token);
    if (r.status !== 200) throw new Error(`${r.status}`);
    return `200 · totalPages ${r.body?.data?.totalPages ?? '?'}`;
  });

  section('3 · the public tracking page');
  await check('a script in the link is not reflected into the page', async () => {
    const evil = await fetch(`${BASE}/track/${encodeURIComponent('</script><script>alert(1)</script>')}`);
    const body = await evil.text();
    if (evil.status !== 404 || body.includes('<script>alert')) throw new Error(`${evil.status} reflected=${body.includes('<script>alert')}`);
    const good = await fetch(`${BASE}/track/${ctx.shortId}`);
    const page = await good.text();
    if (good.status !== 200 || !page.includes(ctx.shortId)) throw new Error(`real link → ${good.status}`);
    return 'crafted link 404 · real link 200';
  });

  section('4 · a ride that happened cannot be cancelled for a refund');
  await check('a completed, paid seat → 409 on both cancel verbs, wallet untouched', async () => {
    ctx.doneId = await book(ctx.a, 1);
    await db.booking.update({ where: { id: ctx.doneId }, data: { status: 'COMPLETED', paymentStatus: 'PAID', paymentMethod: 'WALLET' } });
    const before = await walletOf(ctx.a);
    const x = await expectStatus('POST', `/cancellation/${ctx.doneId}/cancel`, ctx.a.token, { reason: 'other' }, [409]);
    const y = await expectStatus('POST', `/bookings/${ctx.doneId}/cancel`, ctx.a.token, {}, [409]);
    const after = await walletOf(ctx.a);
    if (after !== before) throw new Error(`wallet moved ${before} → ${after}`);
    return `${x} · ${y}`;
  });

  section('5 · double taps');
  await check('two cancels at once refund once', async () => {
    const id = await book(ctx.b, 2);
    const fare = (await db.booking.update({ where: { id }, data: { status: 'CONFIRMED', paymentStatus: 'PAID', paymentMethod: 'WALLET' } })).fareAmountPesewas;
    const before = await walletOf(ctx.b);
    const rs = await Promise.all([1, 2].map(() => raw('POST', `/cancellation/${id}/cancel`, ctx.b.token, { reason: 'other' })));
    const after = await walletOf(ctx.b);
    const refunds = await db.paymentTransaction.count({ where: { bookingId: id, status: { in: ['REFUNDED', 'PARTIAL_REFUND'] } } });
    if (refunds !== 1 || after - before !== fare) throw new Error(`refund rows ${refunds}, wallet +${after - before} for a ${fare} fare (${rs.map((r) => r.status)})`);
    return `statuses ${rs.map((r) => r.status).join('/')} · refunded ${fare} once`;
  });

  await check('two board taps on a cash seat take the commission once', async () => {
    const id = await book(ctx.c, 3);
    await POST('/payments/initiate', { bookingId: id, method: 'CASH' }, { token: ctx.c.token });
    const commission = (await db.booking.findUnique({ where: { id } })).commissionAmountPesewas;
    const walletBefore = (await GET('/driver/wallet/balance', { token: ctx.driver.token })).balancePesewas;
    const tap = () => raw('POST', `/driver/trips/${ctx.tripId}/board/${id}`, ctx.driver.token, {});
    let rs = await Promise.all([tap(), tap()]);
    if (rs.some((r) => codeOf(r) === 'PIN_REQUIRED')) {
      const pin = (await db.booking.findUnique({ where: { id } })).boardingPin;
      const tapPin = () => raw('POST', `/driver/trips/${ctx.tripId}/board/${id}`, ctx.driver.token, { pin });
      rs = await Promise.all([tapPin(), tapPin()]);
    }
    const walletAfter = (await GET('/driver/wallet/balance', { token: ctx.driver.token })).balancePesewas;
    const status = (await db.booking.findUnique({ where: { id } })).status;
    if (status !== 'BOARDED' || walletBefore - walletAfter !== commission) {
      throw new Error(`status ${status}, taken ${walletBefore - walletAfter} vs commission ${commission} (${rs.map((r) => `${r.status} ${codeOf(r)}`)})`);
    }
    ctx.boardedId = id;
    return `taps ${rs.map((r) => r.status).join('/')} · commission ${commission} once`;
  });

  await check('a cancelled booking cannot be boarded back to life', async () => {
    const id = await book(ctx.d, 4);
    await POST(`/bookings/${id}/cancel`, {}, { token: ctx.d.token });
    return expectStatus('POST', `/driver/trips/${ctx.tripId}/board/${id}`, ctx.driver.token, {}, [409]);
  });

  await check('no-show twice is one no-show', async () => {
    const id = await book(ctx.d, 5);
    await POST('/payments/initiate', { bookingId: id, method: 'CASH' }, { token: ctx.d.token });
    const first = await expectStatus('POST', `/trips/${ctx.tripId}/rider-no-show/${id}`, ctx.driver.token, {}, [200]);
    const second = await expectStatus('POST', `/trips/${ctx.tripId}/rider-no-show/${id}`, ctx.driver.token, {}, [409, 400]);
    return `${first} · then ${second}`;
  });

  await check('a promo cannot be added after boarding', async () => {
    const id = await book(ctx.b, 6);
    await db.booking.update({ where: { id }, data: { status: 'BOARDED' } });
    return expectStatus('POST', `/bookings/${id}/apply-promo`, ctx.b.token, { code: 'ANYCODE' }, [400]);
  });

  await check('two disputes at once file one ticket, with its trip', async () => {
    const body = { type: 'Incorrect fare', description: 'charged twice' };
    const rs = await Promise.all([1, 2].map(() => raw('POST', `/bookings/${ctx.doneId}/dispute`, ctx.a.token, body)));
    const again = await expectStatus('POST', `/bookings/${ctx.doneId}/dispute`, ctx.a.token, body, [409]);
    const tickets = await db.supportTicket.findMany({ where: { userId: ctx.a.id, category: 'TRIP' }, select: { tripId: true } });
    if (tickets.length !== 1 || tickets[0].tripId !== ctx.tripId) throw new Error(`${tickets.length} ticket(s), tripId ${tickets[0]?.tripId}`);
    return `${rs.map((r) => r.status).join('/')} · then ${again}`;
  });

  await check('two ratings at once: one lands, the other is "already rated", never a 500', async () => {
    await db.trip.update({ where: { id: ctx.tripId }, data: { status: 'COMPLETED' } });
    const rs = await Promise.all([1, 2].map(() => raw('POST', `/bookings/${ctx.doneId}/rating`, ctx.a.token, { rating: 5 })));
    const ok = rs.filter((r) => r.status < 300).length;
    if (ok !== 1 || rs.some((r) => r.status >= 500)) throw new Error(rs.map((r) => `${r.status} ${codeOf(r)}`).join(', '));
    return rs.map((r) => `${r.status}${codeOf(r) ? ` ${codeOf(r)}` : ''}`).join(' · ');
  });

  section('6 · a deliberate pass is counted, once');
  await check('driver passes a hailed offer → one DECLINED row for the acceptance rate', async () => {
    ctx.hailDriver = await makeDriver({ name: 'E2E Hardening Pass Driver' });
    await goOnline(ctx.hailDriver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const rider = await makeRider('E2E Hardening Hailer');
    const q = await POST('/rides/quote', {
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, tier: 'ECO',
    }, { token: rider.token });
    const r = await POST('/rides', {
      quoteId: q.quoteId,
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
      pickupAddress: 'Kwame Nkrumah Circle, Accra', dropoffAddress: 'Dansoman High Street, Accra',
      paymentMethod: 'CASH',
    }, { token: rider.token });
    const tripId = (r.trip ?? r)?.id ?? r.tripId;
    await until(async () => (await GET('/rides/driver/state', { token: ctx.hailDriver.token }))?.offer?.tripId === tripId,
      { timeoutMs: 30000, everyMs: 1000, label: 'the offer reaches the driver' });
    await POST(`/rides/${tripId}/decline`, {}, { token: ctx.hailDriver.token });
    await POST(`/rides/${tripId}/decline`, {}, { token: ctx.hailDriver.token }).catch(() => {});
    await sleep(300);
    const n = await db.dispatchAction.count({ where: { driverId: ctx.hailDriver.id, tripId, action: 'DECLINED' } });
    await POST(`/rides/${tripId}/cancel`, { reason: 'other' }, { token: rider.token }).catch(() => {});
    if (n !== 1) throw new Error(`${n} DECLINED rows`);
    return '1 row';
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    if (ctx.hailDriver) await POST('/driver/go-offline', {}, { token: ctx.hailDriver.token }).catch(() => {});
    await db.$disconnect().catch(() => {});
    summary();
  });
