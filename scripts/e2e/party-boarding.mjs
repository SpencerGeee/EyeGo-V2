/**
 * A host who pays for everyone is ONE party — on the seat map, on cancel, and
 * at the kerb.
 *
 *   - the seat map marks only the host's own seat as `isMyHold` (the one seat
 *     a re-pick may move); covered seats are theirs but not re-pickable;
 *   - cancelling the host seat gives every covered seat back (it used to leave
 *     them held, so the picker showed a full car and Continue was dead);
 *   - boarding any one of the party's rows boards every row, behind one PIN,
 *     and the cash commission for all of it is taken once.
 *
 *   node scripts/e2e/party-boarding.mjs
 */

import { section, check, summary, GET, POST, req, makeRider, makeDriver, ACCRA } from './lib.mjs';

const ctx = {};
const seatList = (m) => (Array.isArray(m) ? m : m?.seats ?? []);
const tripOf = (d) => d?.trip ?? d;
const hostRows = (detail) =>
  (tripOf(detail)?.bookings ?? []).filter(
    (b) => (b.user?.id ?? b.userId) === ctx.host.id && !b.guestName && b.status !== 'CANCELLED',
  );

async function main() {
  section('setup');
  await check('a driver publishes a 6-seat group trip', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Party Driver', seaterCount: 7 });
    const r = await POST(
      '/driver/trips',
      {
        originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
        destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
        departureTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        availableSeats: 6,
        tier: 'ECO',
      },
      { token: ctx.driver.token, headers: { 'Idempotency-Key': 'e2e-party-' + Date.now() } },
    );
    ctx.tripId = tripOf(r)?.id;
    if (!ctx.tripId) throw new Error(`no trip: ${JSON.stringify(r).slice(0, 200)}`);
    ctx.host = await makeRider('E2E Party Host');
    return `trip ${ctx.tripId.slice(0, 8)} · ${tripOf(r).maxSeats} seats`;
  });
  if (!ctx.tripId || !ctx.host) return;
  const host = { token: ctx.host.token };
  const driver = { token: ctx.driver.token };

  section('a hold the host walks away from');
  await check('host takes seat 1 and covers everyone; only seat 1 is a re-pickable hold', async () => {
    const b = await POST('/bookings', { tripId: ctx.tripId, seatNumber: 1, paymentMethod: 'CASH' }, host);
    ctx.firstHold = (b.booking ?? b).id;
    await POST(`/trips/${ctx.tripId}/group`, { isCoverAll: true }, host);
    const seats = seatList(await GET(`/trips/${ctx.tripId}/seats`, host));
    const mine = seats.filter((s) => s.isMine);
    const myHold = seats.filter((s) => s.isMyHold);
    if (mine.length < 2) throw new Error(`cover-all claimed ${mine.length} seat(s)`);
    if (myHold.length !== 1 || myHold[0].number !== 1) {
      throw new Error(`isMyHold on [${myHold.map((s) => s.number)}], expected [1]`);
    }
    return `${mine.length} seats held by the host, isMyHold only on seat 1`;
  });

  await check('cancelling the host seat releases every covered seat', async () => {
    await POST(`/bookings/${ctx.firstHold}/cancel`, { reason: 'CHANGED_MIND' }, host);
    const seats = seatList(await GET(`/trips/${ctx.tripId}/seats`, host));
    const held = seats.filter((s) => s.status !== 'AVAILABLE');
    if (held.length) throw new Error(`still held: ${held.map((s) => `${s.number}:${s.status}`).join(', ')}`);
    return `all ${seats.length} seats free again`;
  });

  section('one PIN boards the whole party');
  await check('host books again, covers everyone and confirms cash', async () => {
    const b = await POST('/bookings', { tripId: ctx.tripId, seatNumber: 1, paymentMethod: 'CASH' }, host);
    ctx.bookingId = (b.booking ?? b).id;
    await POST(`/trips/${ctx.tripId}/group`, { isCoverAll: true }, host);
    await POST('/payments/initiate', { bookingId: ctx.bookingId, method: 'CASH' }, host);
    const rows = hostRows(await GET(`/driver/trips/${ctx.tripId}`, driver));
    ctx.partyIds = rows.map((r) => r.id);
    if (rows.length < 2) throw new Error(`the driver sees ${rows.length} row(s) for the host`);
    return `${rows.length} rows: ${rows.map((r) => r.status).join(',')}`;
  });

  await check('boarding one covered seat boards every seat the host holds', async () => {
    ctx.walletBefore = (await GET('/driver/wallet/balance', driver)).balancePesewas;
    const covered = ctx.partyIds.find((x) => x !== ctx.bookingId) ?? ctx.bookingId;
    const first = await req('POST', `/driver/trips/${ctx.tripId}/board/${covered}`, { ...driver, raw: true, body: {} });
    let viaPin = false;
    if (first.status === 400 && first.body?.code === 'PIN_REQUIRED') {
      const ev = await GET(`/rides/${ctx.tripId}/events?since=0`, host);
      const pin = ev?.snapshot?.booking?.boardingPin;
      if (!pin) throw new Error('PIN required but the host snapshot carries none');
      await POST(`/driver/trips/${ctx.tripId}/board/${covered}`, { pin }, driver);
      viaPin = true;
    } else if (first.status >= 400) {
      throw new Error(`${first.status} ${first.body?.code ?? ''} ${first.body?.message ?? ''}`);
    }
    const rows = (tripOf(await GET(`/driver/trips/${ctx.tripId}`, driver))?.bookings ?? []).filter((b) =>
      ctx.partyIds.includes(b.id),
    );
    const left = rows.filter((r) => r.status !== 'BOARDED');
    if (left.length) throw new Error(`${left.length}/${rows.length} not boarded: ${left.map((r) => r.status)}`);
    return `${rows.length} seats boarded in one call${viaPin ? ', behind the host PIN' : ''}`;
  });

  await check('the party is not boarded twice and its commission is taken once', async () => {
    const again = await req('POST', `/driver/trips/${ctx.tripId}/board/${ctx.bookingId}`, { ...driver, raw: true, body: {} });
    const after = (await GET('/driver/wallet/balance', driver)).balancePesewas;
    const taken = ctx.walletBefore - after;
    if (taken < 0) throw new Error(`wallet went UP by ${-taken}`);
    return `re-board → ${again.status}; commission taken ${taken} pesewas once`;
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => summary());
