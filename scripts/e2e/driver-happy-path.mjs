/**
 * The driver's half of the product, played against a real server.
 *
 * The rider suites prove a rider can get a ride. This proves the other seat:
 * a driver signs up, submits their vehicle, is approved, goes online, is
 * offered a trip, accepts it, drives the status rail, boards a passenger with
 * their PIN, completes, is paid, and rates. Every step asserts what the DRIVER
 * sees and what the RIDER sees, because the whole class of bug this system
 * produces is the two sides disagreeing about the same trip.
 *
 *   node scripts/e2e/driver-happy-path.mjs
 */

import {
  BASE, section, check, fail, summary,
  GET, POST, PATCH, req,
  makeRider, makeDriver, goOnline, connectSocket, sleep, until, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  section('1 · driver signup and approval');
  await check('phone → OTP → driver token', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Lifecycle Driver' });
    return ctx.driver.phone;
  });
  if (!ctx.driver) return;

  await check('GET /driver/me returns an ACTIVE driver with the vehicle just submitted', async () => {
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const d = me.driver ?? me;
    ctx.driver.id = d.id;
    if (d.status !== 'ACTIVE') throw new Error(`status=${d.status}, expected ACTIVE ('APPROVED' is not a status this system uses)`);
    const v = (d.vehicles ?? [])[0];
    if (!v) throw new Error('no vehicle — /driver/verify did not persist one (F1 regression)');
    // The 2026-08-19 finding: the vehicle screen read `seatCapacity`, a field
    // that does not exist, so every vehicle showed its `?? 14` fallback.
    if (!Number.isInteger(v.seaterCount)) throw new Error(`seaterCount is ${v.seaterCount} — the vehicle screen reads this field`);
    if (!v.tier) throw new Error('vehicle has no tier — it can never be tier-matched');
    if (!('colour' in v)) throw new Error('no colour column — the admin driver page renders a Colour row');
    return `${v.make} ${v.model} ${v.plateNumber} · ${v.tier} · ${v.seaterCount} seats · ${v.colour}`;
  });

  await check('driver refresh token mints a new access token', async () => {
    const r = await POST('/auth/driver/refresh', { refreshToken: ctx.driver.refreshToken });
    if (!r.accessToken) throw new Error(JSON.stringify(r).slice(0, 160));
    return '';
  });

  await check('documents endpoint answers (onboarding reads it)', async () => {
    const d = await GET('/driver/documents', { token: ctx.driver.token });
    const list = d.documents ?? d;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(d).slice(0, 160)}`);
    return `${list.length} document(s)`;
  });

  section('2 · going online');
  await check('go-online puts the driver in the Redis dispatch pool', async () => {
    const r = await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const { body } = await req('GET', `${BASE}/health/dispatch`, { raw: true });
    const health = body?.data ?? body;
    if (!health) throw new Error('no dispatch health payload');
    return `${JSON.stringify(r).slice(0, 120)}`;
  });

  await check('presence-over-HTTP reports the driver as dispatchable', async () => {
    // The non-socket path into the pool. Flagged as dead code in an earlier
    // sweep; it is the only delivery path when the websocket is down, so it has
    // to answer truthfully rather than merely 200.
    const p = await POST(
      '/driver/presence',
      { lat: ACCRA.nearPickup.lat, lng: ACCRA.nearPickup.lng, heading: 90, speed: 0 },
      { token: ctx.driver.token },
    );
    if (p.inPool !== true) throw new Error(`inPool=${p.inPool} reason=${p.reason}`);
    if (p.dispatchable === false) throw new Error(`online but not dispatchable: ${p.reason}`);
    return `inPool=${p.inPool} dispatchable=${p.dispatchable} ttl=${p.presenceTtlSeconds}s`;
  });

  await check('driver connects to the /driver namespace', async () => {
    ctx.driverSock = await connectSocket('/driver', ctx.driver.token);
    return '';
  });

  await check('GET /rides/driver/state hydrates a free, online driver', async () => {
    const s = await GET('/rides/driver/state', { token: ctx.driver.token });
    if (!s.driver) throw new Error('no driver on the state payload');
    if (s.trip) throw new Error(`a brand-new driver already has a trip: ${s.trip.status}`);
    if (s.driver.isOnline !== true) throw new Error('went online but state says offline');
    return `wallet=${s.driver.walletBalancePesewas} online=${s.driver.isOnline}`;
  });

  section('3 · receiving and accepting a dispatch');
  await check('a rider books, and the offer reaches this driver', async () => {
    ctx.rider = await makeRider('E2E Lifecycle Rider');
    ctx.riderSock = await connectSocket('/passenger', ctx.rider.token);
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'CASH',
        seatCount: 1,
      },
      { token: ctx.rider.token },
    );
    ctx.tripId = r.tripId ?? r.trip?.id;
    ctx.quotedFare = q.amountPesewas;
    const offer = await until(
      async () => {
        const s = await GET('/rides/driver/state', { token: ctx.driver.token });
        const o = s.offer ?? s.pendingOffer;
        return o?.tripId === ctx.tripId ? o : null;
      },
      { timeoutMs: 120000, everyMs: 700, label: 'the offer to reach this driver' },
    );
    ctx.offer = offer;
    return `fare ${offer.farePesewas} · earns ${offer.driverEarningsPesewas} · eta ${offer.etaSeconds}s · attempt ${offer.attempt}/${offer.totalCandidates}`;
  });
  if (!ctx.tripId) return;

  await check('the offer carries everything the sheet renders, and no rider PII', async () => {
    const o = ctx.offer;
    const missing = ['pickupLat', 'pickupLng', 'dropoffLat', 'dropoffLng', 'farePesewas', 'driverEarningsPesewas', 'expiresAtServerMs']
      .filter((k) => o[k] == null);
    if (missing.length) throw new Error(`offer is missing ${missing.join(', ')}`);
    if (o.driverEarningsPesewas > o.farePesewas) throw new Error('driver earns more than the fare');
    if (JSON.stringify(o).includes(ctx.rider.phone)) throw new Error("the offer carries the rider's phone before acceptance");
    const commission = 1 - o.driverEarningsPesewas / o.farePesewas;
    if (commission < 0 || commission > 0.5) throw new Error(`implied commission ${(commission * 100).toFixed(1)}% is out of range`);
    return `commission ${(commission * 100).toFixed(1)}%`;
  });

  await check('the offer has a real deadline in server time', async () => {
    const left = ctx.offer.expiresAtServerMs - Date.now();
    if (left <= 0) throw new Error('the offer was already expired when it arrived');
    if (left > 120000) throw new Error(`offer window is ${Math.round(left / 1000)}s — far too long`);
    return `${Math.round(left / 1000)}s left`;
  });

  await check('driver accepts', async () => {
    const r = await POST(`/rides/${ctx.tripId}/accept`, {}, { token: ctx.driver.token });
    if (r.status !== 'DRIVER_ASSIGNED') throw new Error(`status=${r.status}`);
    return `v${r.version}`;
  });

  await check('a second driver accepting the same trip loses cleanly', async () => {
    const other = await makeDriver({ name: 'E2E Loser Driver' });
    await goOnline(other, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.otherDriver = other;
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/accept`, { token: other.token, raw: true });
    if (status < 400) throw new Error(`the second driver also got ${status} — two drivers hold one trip`);
    // Since the state machine retries a lost compare-and-swap, the loser should
    // be told the trip moved on, not that the database was busy.
    if (body?.code === 'VERSION_CONFLICT') {
      throw new Error('loser got VERSION_CONFLICT — a storage detail, not what happened');
    }
    return `${status} ${body?.code}`;
  });

  await check('the driver now holds the trip in /driver/trips/active', async () => {
    const a = await GET('/driver/trips/active', { token: ctx.driver.token });
    const trip = a.trip ?? (Array.isArray(a.trips) ? a.trips[0] : a);
    if (!trip || (trip.id ?? trip.tripId) !== ctx.tripId) {
      throw new Error(`active trip is ${JSON.stringify(a).slice(0, 200)}`);
    }
    return `status=${trip.status}`;
  });

  await check('an accepted trip hands over the rider contact the driver needs', async () => {
    const t = await GET(`/driver/trips/${ctx.tripId}`, { token: ctx.driver.token });
    const trip = t.trip ?? t;
    const blob = JSON.stringify(trip);
    if (!blob.includes(ctx.rider.phone)) {
      throw new Error('no rider phone anywhere on an accepted trip — the driver cannot reach them at the kerb');
    }
    if (trip.pickupLat == null || trip.dropoffLat == null) throw new Error('trip has no coordinates to navigate to');
    return `pickup ${trip.pickupLat},${trip.pickupLng} → ${trip.dropoffLat},${trip.dropoffLng}`;
  });

  await check('a busy driver is refused a second trip', async () => {
    const rider2 = await makeRider('E2E Second Rider');
    const q = await POST(
      '/rides/quote',
      { pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng, dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, tier: 'ECO' },
      { token: rider2.token },
    );
    const r2 = await POST(
      '/rides',
      { quoteId: q.quoteId, pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng, dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, paymentMethod: 'CASH' },
      { token: rider2.token },
    );
    ctx.secondTripId = r2.tripId ?? r2.trip?.id;
    ctx.rider2 = rider2;
    const { status, body } = await req('POST', `/rides/${ctx.secondTripId}/accept`, { token: ctx.driver.token, raw: true });
    if (status < 400) throw new Error('a driver already on a trip accepted a second one');
    if (body?.code !== 'DRIVER_BUSY') return `refused ${status} ${body?.code} (expected DRIVER_BUSY)`;
    return `${status} DRIVER_BUSY`;
  });

  section('4 · the status rail');
  for (const [verb, expected] of [
    ['en-route', 'DRIVER_EN_ROUTE'],
    ['arrived', 'ARRIVED_AT_PICKUP'],
  ]) {
    await check(`POST /rides/:id/${verb} → ${expected}`, async () => {
      const r = await POST(`/rides/${ctx.tripId}/${verb}`, {}, { token: ctx.driver.token });
      if (r.status !== expected) throw new Error(`server says ${r.status}`);
      return '';
    });
  }

  await check('the driver may not skip straight from ARRIVED to COMPLETED', async () => {
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/complete`, { token: ctx.driver.token, raw: true });
    if (status < 400) throw new Error('completed a trip that never started');
    return `${status} ${body?.code}`;
  });

  await check('boarding PIN can be requested and reaches the rider', async () => {
    const t = await GET(`/driver/trips/${ctx.tripId}`, { token: ctx.driver.token });
    const trip = t.trip ?? t;
    const booking = (trip.bookings ?? [])[0];
    if (!booking) throw new Error('the accepted trip has no booking on it');
    ctx.bookingId = booking.id;
    const { status, body } = await req('POST', `/driver/trips/${ctx.tripId}/board/${booking.id}/request-pin`, {
      token: ctx.driver.token, raw: true,
    });
    // Riders have the PIN setting off by default, so "no pin on this booking" is
    // a legitimate answer — but it must be a stated one, not a 500.
    if (status >= 500) throw new Error(`request-pin 500'd: ${body?.message}`);
    return status < 400 ? 'requested' : `${status} ${body?.code ?? body?.message}`.slice(0, 90);
  });

  await check('POST /rides/:id/start → IN_PROGRESS', async () => {
    const r = await POST(`/rides/${ctx.tripId}/start`, {}, { token: ctx.driver.token });
    if (r.status !== 'IN_PROGRESS') throw new Error(`status=${r.status}`);
    return '';
  });

  await check('the rider saw every one of those transitions, in order, with no gaps', async () => {
    const evs = ctx.riderSock.frames.filter((f) => f.event === 'trip:event' && f.payload?.seq != null);
    if (!evs.length) throw new Error('the rider received no sequenced frames at all');
    const seqs = evs.map((f) => f.payload.seq).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) gaps.push(`${seqs[i - 1]}→${seqs[i]}`);
    if (gaps.length) throw new Error(`seq gaps: ${gaps.join(',')}`);
    const types = evs.map((e) => e.payload.type);
    for (const need of ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS']) {
      if (!types.includes(need)) throw new Error(`the rider was never told ${need}`);
    }
    return `${evs.length} frames: ${types.join(' → ')}`;
  });

  section('5 · completion and money');
  await check('driver completes the trip', async () => {
    ctx.walletBefore = (await GET('/driver/wallet/balance', { token: ctx.driver.token })).balancePesewas;
    const r = await POST(`/rides/${ctx.tripId}/complete`, {}, { token: ctx.driver.token });
    if (r.status !== 'COMPLETED') throw new Error(`status=${r.status}`);
    return '';
  });

  await check('the driver is free for dispatch again immediately', async () => {
    const s = await until(
      async () => {
        const st = await GET('/rides/driver/state', { token: ctx.driver.token });
        return st.trip == null ? st : null;
      },
      { timeoutMs: 15000, label: 'the driver to be released' },
    );
    return `online=${s.driver?.isOnline}`;
  });

  await check('a cash trip moves the driver wallet by the commission, not the fare', async () => {
    const after = (await GET('/driver/wallet/balance', { token: ctx.driver.token })).balancePesewas;
    const delta = after - ctx.walletBefore;
    ctx.walletDelta = delta;
    // Cash: the rider paid the driver directly, so the platform's commission is
    // DEBITED from the driver's float. A credit of the whole fare here would
    // mean the driver was paid twice.
    if (delta > 0) throw new Error(`wallet went UP by ${delta} on a cash ride — the driver already holds the cash`);
    // And it must MOVE. Zero was the actual bug: the status sweep in
    // `completeTrip` ran before the cash auto-settle, so nothing was ever marked
    // PAID and the platform silently took no commission at all.
    if (delta === 0) {
      throw new Error(`wallet did not move on a completed cash ride — no commission was taken (fare ${ctx.quotedFare})`);
    }
    const commission = Math.abs(delta);
    if (commission > ctx.quotedFare) throw new Error(`commission ${commission} exceeds the fare ${ctx.quotedFare}`);
    return `${ctx.walletBefore} → ${after} (commission ${commission} of ${ctx.quotedFare})`;
  });

  await check('every ledger row for the trip obeys the rule for its own kind', async () => {
    const t = await GET('/driver/earnings/transactions?limit=20', { token: ctx.driver.token });
    const list = t.transactions ?? t.items ?? t;
    if (!Array.isArray(list) || !list.length) throw new Error('no ledger rows after a completed trip');
    // The endpoint deliberately exposes `tripShortId`, not the raw trip id —
    // the short id is what the driver sees on a receipt.
    const t2 = await GET(`/driver/trips/${ctx.tripId}`, { token: ctx.driver.token });
    const shortId = (t2.trip ?? t2).shortId;
    if (!shortId) throw new Error('the completed trip has no shortId to attribute earnings to');
    const rows = list.filter((x) => x.tripShortId === shortId);
    if (!rows.length) {
      throw new Error(`${list.length} rows, none attributed to trip ${shortId} (types: ${list.map((r) => r.type).join(',')})`);
    }

    /**
     * `CASH_EARNING` is a MEMO row by design — the rider handed the money over
     * in person, so nothing moved through us, but the earnings chart is built
     * from these rows and a cash driver's chart read zero without it. See the
     * note on `WalletTransaction.amountPesewas` in schema.prisma.
     */
    const MEMO_TYPES = new Set(['CASH_EARNING']);
    // This table stores an UNSIGNED magnitude and carries direction in `type` —
    // unlike RiderWalletTransaction, which is a properly signed ledger. See the
    // note on `WalletTransaction.amountPesewas` in schema.prisma.
    const DEBIT_TYPES = new Set(['COMMISSION_DEDUCTION', 'WITHDRAWAL']);
    for (const r of rows) {
      if (r.balanceBeforePesewas == null || r.balanceAfterPesewas == null) continue;
      if (MEMO_TYPES.has(r.type)) {
        if (r.balanceAfterPesewas !== r.balanceBeforePesewas) {
          throw new Error(`${r.type} is a memo row but moved the balance ${r.balanceBeforePesewas}→${r.balanceAfterPesewas}`);
        }
        continue;
      }
      const signed = DEBIT_TYPES.has(r.type) ? -Math.abs(r.amountPesewas) : r.amountPesewas;
      if (r.balanceAfterPesewas !== r.balanceBeforePesewas + signed) {
        throw new Error(`${r.type} does not balance: ${r.balanceBeforePesewas} ${signed >= 0 ? '+' : '−'} ${Math.abs(signed)} ≠ ${r.balanceAfterPesewas}`);
      }
    }
    if (!rows.some((r) => r.type === 'COMMISSION_DEDUCTION')) {
      throw new Error(`no COMMISSION_DEDUCTION row — the platform took nothing. Rows: ${rows.map((r) => r.type).join(',')}`);
    }
    return rows.map((r) => `${r.type} ${r.amountPesewas}`).join(' · ');
  });

  await check('the completed trip shows in the driver trip history', async () => {
    const a = await GET('/driver/trips/all?limit=20', { token: ctx.driver.token });
    const list = a.trips ?? a.items ?? a;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(a).slice(0, 160)}`);
    if (!list.some((t) => (t.id ?? t.tripId) === ctx.tripId)) throw new Error(`${list.length} trips, none is the one just completed`);
    return `${list.length} trips`;
  });

  await check('driver rates the passenger', async () => {
    if (!ctx.bookingId) throw new Error('no booking id captured');
    const r = await POST(`/driver/rate-passenger/${ctx.bookingId}`, { stars: 5, comment: 'e2e' }, { token: ctx.driver.token });
    ctx.firstRatingId = (r.rating ?? r).id;
    return `${(r.rating ?? r).stars}★`;
  });

  await check('re-rating replaces the rating rather than adding a second row', async () => {
    // `ratePassenger` upserts on (driverId, tripId, userId) deliberately — a
    // driver correcting a mis-tap is legitimate. The invariant is that exactly
    // one row survives, not that the second call is refused.
    const again = await POST(`/driver/rate-passenger/${ctx.bookingId}`, { stars: 3, comment: 'corrected' }, { token: ctx.driver.token });
    const rating = again.rating ?? again;
    if (rating.stars !== 3) throw new Error(`re-rate did not take: stars=${rating.stars}`);
    if (ctx.firstRatingId && rating.id !== ctx.firstRatingId) {
      throw new Error('a SECOND rating row was created — the unique key is not holding');
    }
    return `one row, now ${rating.stars}★`;
  });

  await check('the performance screen gets every field it renders', async () => {
    const p = await GET('/driver/performance', { token: ctx.driver.token });
    const perf = p.performance ?? p;
    // The exact set `(profile)/performance.tsx` reads. A missing key renders as
    // its `?? 0` fallback, which is indistinguishable from a real zero.
    const needed = ['level', 'acceptanceRate', 'completionRate', 'cancellationRate',
      'tripsThisWeek', 'onlineHoursThisWeek', 'earningsThisWeek', 'weeklyGoal', 'weeklyGoalProgress'];
    const missing = needed.filter((k) => !(k in perf));
    if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
    if (perf.tripsThisWeek < 1) throw new Error('a completed trip did not count towards tripsThisWeek');
    // The settlement bug showed up here first: a completed cash ride recorded
    // zero earnings because nothing was ever marked PAID.
    if (perf.earningsThisWeek === 0) {
      throw new Error('a completed cash trip recorded ZERO earnings — settlement did not run');
    }
    return `${perf.level} · ${perf.tripsThisWeek} trip(s) · earned ${perf.earningsThisWeek}`;
  });

  await check('the ratings screen payload is shaped', async () => {
    const r = await GET('/driver/ratings', { token: ctx.driver.token });
    const ratings = r.ratings ?? r;
    if (typeof ratings !== 'object' || ratings == null) throw new Error(`shape: ${JSON.stringify(r).slice(0, 160)}`);
    return Object.keys(ratings).slice(0, 6).join(',');
  });

  await check('the trip the driver could not take was still dispatched to someone else', async () => {
    // The busy-refusal above left a second live trip. It must not be stranded:
    // the cascade should have carried on to the other driver.
    const s = await GET('/rides/driver/state', { token: ctx.otherDriver.token });
    const seen = (s.offer ?? s.pendingOffer)?.tripId === ctx.secondTripId
      || (s.pendingDispatches ?? []).some((d) => d.tripId === ctx.secondTripId)
      || s.trip?.tripId === ctx.secondTripId;
    if (!seen) {
      const t = await GET('/rides/active', { token: ctx.rider2.token });
      if (!t.trip) throw new Error('the second ride vanished entirely');
      return `still searching (${t.trip.status}) — not stranded`;
    }
    return 'offered to the other driver';
  });
}

main()
  .catch((e) => fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | ')))
  .finally(async () => {
    try { ctx.driverSock?.close(); } catch {}
    try { ctx.riderSock?.close(); } catch {}
    for (const d of [ctx.driver, ctx.otherDriver]) {
      if (d) await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
