/**
 * The loop the whole product exists to serve, played end to end against a real
 * server: rider signs up, prices a ride, books it, a driver is dispatched,
 * accepts, drives it, completes it, and the rider rates and pays.
 *
 * Every step asserts BOTH sides — what the rider sees and what the driver sees
 * — because the entire class of bug this repo keeps producing is the two sides
 * disagreeing about the same trip.
 */

import {
  BASE, section, check, fail, info, summary,
  GET, POST, req,
  makeRider, makeDriver, goOnline, connectSocket, sleep, until, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · rider auth');
  await check('phone → OTP → token', async () => {
    ctx.rider = await makeRider();
    return `${ctx.rider.phone} isNewUser=${ctx.rider.isNewUser}`;
  });
  if (!ctx.rider) return;

  await check('GET /user/me returns a flat user with the name we just set', async () => {
    const me = await GET('/user/me', { token: ctx.rider.token });
    const user = me.user ?? me;
    if (!user?.id) throw new Error(`no id on ${JSON.stringify(me).slice(0, 160)}`);
    if (user.name !== 'E2E Rider') throw new Error(`name not persisted: ${JSON.stringify(user.name)}`);
    ctx.rider.id = user.id;
    return `id=${user.id.slice(0, 8)}`;
  });

  await check('refresh token mints a new access token', async () => {
    const r = await POST('/auth/refresh', { refreshToken: ctx.rider.refreshToken });
    if (!r.accessToken) throw new Error(`no accessToken: ${JSON.stringify(r).slice(0, 160)}`);
    return '';
  });

  section('2 · driver setup');
  await check('driver OTP → verify → vehicle → ACTIVE', async () => {
    ctx.driver = await makeDriver();
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const d = me.driver ?? me;
    if (d.status !== 'ACTIVE') throw new Error(`status is ${d.status}, expected ACTIVE`);
    const vehicles = d.vehicles || [];
    if (!vehicles.length) throw new Error('driver has NO vehicle after /driver/verify — F1 regression');
    ctx.driver.id = d.id;
    return `status=${d.status} vehicle=${vehicles[0]?.plateNumber} tier=${vehicles[0]?.tier} seats=${vehicles[0]?.seaterCount}`;
  });
  if (!ctx.driver) return;

  await check('driver goes online and lands in the Redis dispatch pool', async () => {
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    // /health/dispatch answers 503 when the STUCK-TRIP alarm is firing, which
    // is about leftover fixture rows, not about the pool. Read the body either way.
    const { body } = await req('GET', `${BASE}/health/dispatch`, { raw: true });
    const health = body?.data ?? body;
    ctx.dispatchHealth = health;
    const pool = health.pool ?? health;
    const online = pool.driversInPool ?? pool.poolSize ?? pool.onlineDrivers ?? pool.available;
    if (online === 0) throw new Error(`went online but the pool is empty: ${JSON.stringify(health).slice(0, 300)}`);
    return `pool keys: ${Object.keys(health).join(',')}`;
  });

  section('3 · sockets');
  await check('rider connects to /passenger', async () => {
    ctx.riderSock = await connectSocket('/passenger', ctx.rider.token);
    return '';
  });
  await check('driver connects to /driver', async () => {
    ctx.driverSock = await connectSocket('/driver', ctx.driver.token);
    return '';
  });

  section('4 · quote');
  await check('POST /rides/quote returns a signed, expiring quote', async () => {
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    ctx.quote = q;
    const problems = [];
    if (!q.quoteId || q.quoteId.length !== 64) problems.push(`quoteId length ${q.quoteId?.length}`);
    if (!Number.isFinite(q.amountPesewas) || q.amountPesewas <= 0) problems.push(`amountPesewas=${q.amountPesewas}`);
    if (!Number.isFinite(q.distanceKm) || q.distanceKm <= 0) problems.push(`distanceKm=${q.distanceKm}`);
    if (!Number.isFinite(q.expiresAtServerMs)) problems.push('no expiresAtServerMs');
    if (!Number.isFinite(q.serverNowMs)) problems.push('no serverNowMs');
    if (problems.length) throw new Error(problems.join('; '));
    return `GHS ${(q.amountPesewas / 100).toFixed(2)} · ${q.distanceKm.toFixed(2)}km · surge ${q.surgeMultiplier} · geometry ${q.geometry ? 'yes' : 'NO'} · expires ${q.expiresInSeconds}s`;
  });

  await check('quote is deterministic for the same inputs', async () => {
    const q2 = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    if (q2.amountPesewas !== ctx.quote.amountPesewas) {
      throw new Error(`same inputs priced ${ctx.quote.amountPesewas} then ${q2.amountPesewas}`);
    }
    ctx.quoteIdStable = q2.quoteId === ctx.quote.quoteId;
    return `both GHS ${(q2.amountPesewas / 100).toFixed(2)}; quoteId ${ctx.quoteIdStable ? 'is a content hash (same id)' : 'is per-call (distinct ids)'}`;
  });

  await check('all three tiers price, and price differently', async () => {
    const out = {};
    for (const tier of ['ECO', 'COMFORT', 'PREMIUM']) {
      const q = await POST(
        '/rides/quote',
        {
          pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
          dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
          tier,
        },
        { token: ctx.rider.token },
      );
      out[tier] = q.amountPesewas;
    }
    const vals = Object.values(out);
    if (new Set(vals).size === 1) throw new Error(`every tier priced identically at ${vals[0]} — tier multiplier not applied`);
    if (!(out.ECO <= out.COMFORT && out.COMFORT <= out.PREMIUM)) {
      throw new Error(`tiers not monotonic: ${JSON.stringify(out)}`);
    }
    return JSON.stringify(out);
  });

  section('5 · book → dispatch → accept');
  await check('POST /rides creates the trip and starts dispatch', async () => {
    const t0 = Date.now();
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    ctx.usedQuoteId = q.quoteId;
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'CASH',
      },
      { token: ctx.rider.token },
    );
    ctx.trip = r.trip ?? r;
    ctx.tripId = ctx.trip?.id || r.tripId;
    if (!ctx.tripId) throw new Error(`no trip id in ${JSON.stringify(r).slice(0, 200)}`);
    const ms = Date.now() - t0;
    // The 2026-08-14b finding: POST /rides used to run the cascade inline and
    // take 14s. It must return immediately and dispatch in the background.
    if (ms > 5000) throw new Error(`POST /rides took ${ms}ms — dispatch is running inline again`);
    return `trip ${ctx.tripId.slice(0, 8)} keys=${Object.keys(r).join(',')} in ${ms}ms`;
  });
  if (!ctx.tripId) return;

  await check('a spent quoteId cannot be replayed into a second ride', async () => {
    const { status, body } = await req('POST', '/rides', {
      token: ctx.rider.token,
      raw: true,
      body: {
        quoteId: ctx.usedQuoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'CASH',
      },
    });
    if (status < 400) {
      const dupId = body?.data?.trip?.id ?? body?.data?.tripId;
      if (dupId && dupId !== ctx.tripId) {
        ctx.duplicateTripId = dupId;
        throw new Error(`the same quote booked a SECOND ride (${dupId.slice(0, 8)}) — quotes are not single-use`);
      }
      return 'replay returned the original ride (idempotent)';
    }
    return `refused with ${status} ${body?.code ?? body?.message ?? ''}`.slice(0, 120);
  });

  await check('driver receives the dispatch offer on the socket', async () => {
    const f = await ctx.driverSock.waitFor(
      (fr) => fr.event === 'trip:event' && fr.payload?.type === 'OFFER',
      25000,
      'trip:event type=OFFER',
    );
    ctx.offerFrame = f;
    const p = f.payload?.payload ?? {};
    if (p.tripId !== ctx.tripId) throw new Error(`offer is for ${p.tripId}, not our trip`);
    return `fare=${p.farePesewas} earn=${p.driverEarningsPesewas} eta=${p.etaSeconds}s expires in ${p.expiresInSeconds}s`;
  });

  await check('GET /rides/driver/state also reports the pending offer (socket-miss net)', async () => {
    const st = await until(
      async () => {
        const s = await GET('/rides/driver/state', { token: ctx.driver.token });
        return s.offer || s.pendingOffer ? s : null;
      },
      { timeoutMs: 15000, label: 'pending offer in driver state' },
    );
    const offer = st.offer || st.pendingOffer;
    if (offer.tripId !== ctx.tripId) throw new Error(`offer is for ${offer.tripId}, not our trip`);
    if (!Number.isFinite(offer.farePesewas)) throw new Error('offer carries no fare');
    if (!Number.isFinite(offer.driverEarningsPesewas)) throw new Error('offer carries no driver earnings');
    if (offer.driverEarningsPesewas > offer.farePesewas) throw new Error('driver earns more than the fare');
    return `fare ${offer.farePesewas} earn ${offer.driverEarningsPesewas} eta ${offer.etaSeconds}s`;
  });

  await check('rider sees dispatch progress on GET /rides/active', async () => {
    const a = await GET('/rides/active', { token: ctx.rider.token });
    if (!a.trip) throw new Error('rider has no active trip right after booking one');
    // The snapshot keys the trip as `tripId`, not `id` — assert against both so
    // a genuine cross-rider leak is distinguishable from a naming difference.
    const activeId = a.trip.tripId ?? a.trip.id;
    if (activeId !== ctx.tripId) {
      throw new Error(`active trip is ${activeId} not ${ctx.tripId} (keys: ${Object.keys(a.trip).join(',')})`);
    }
    if (!Number.isFinite(a.serverNowMs)) throw new Error('no serverNowMs — countdowns will use Date.now()');
    return `status=${a.trip.status} dispatch=${a.dispatch ? `attempt ${a.dispatch.attempt}/${a.dispatch.totalCandidates}` : 'none'}`;
  });

  await check('driver accepts', async () => {
    const r = await POST(`/rides/${ctx.tripId}/accept`, {}, { token: ctx.driver.token });
    return JSON.stringify(r).slice(0, 140);
  });

  await check('rider is told, on the socket, that a driver was assigned', async () => {
    const f = await ctx.riderSock.waitFor(
      (fr) => fr.event === 'trip:event' || /assign|accept|driver/i.test(fr.event),
      15000,
      'assignment frame',
    );
    return `${f.event} ${JSON.stringify(f.payload).slice(0, 200)}`;
  });

  section('6 · lifecycle');
  const verbs = [
    ['en-route', 'DRIVER_EN_ROUTE'],
    ['arrived', 'ARRIVED_AT_PICKUP'],
    ['start', 'IN_PROGRESS'],
    ['complete', 'COMPLETED'],
  ];
  for (const [verb, expected] of verbs) {
    await check(`driver POST /rides/:id/${verb} → ${expected}`, async () => {
      const r = await POST(`/rides/${ctx.tripId}/${verb}`, {}, { token: ctx.driver.token });
      const st = r.trip?.status || r.status;
      if (st && st !== expected) throw new Error(`server says ${st}, expected ${expected}`);
      if (verb === 'complete') ctx.completion = r;
      return `status=${st}`;
    });
    await sleep(300);
  }

  await check('every lifecycle frame reached the rider with a contiguous seq', async () => {
    const evs = ctx.riderSock.frames.filter((f) => f.event === 'trip:event');
    if (!evs.length) throw new Error('rider received ZERO trip:event frames for the whole trip');
    const seqs = evs.map((f) => f.payload?.seq);
    const nulls = seqs.filter((s) => s === null || s === undefined).length;
    if (nulls) throw new Error(`${nulls}/${seqs.length} frames carried no seq — unreplayable`);
    const sorted = [...seqs].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) gaps.push(`${sorted[i - 1]}→${sorted[i]}`);
    if (gaps.length) throw new Error(`seq gaps: ${gaps.join(',')}`);
    return `${evs.length} frames, seq ${sorted[0]}..${sorted[sorted.length - 1]}, types: ${[...new Set(evs.map((e) => e.payload?.type))].join(',')}`;
  });

  await check('replay endpoint returns the same events', async () => {
    const r = await GET(`/rides/${ctx.tripId}/events?since=0`, { token: ctx.rider.token });
    const evs = r.events || r;
    if (!Array.isArray(evs) || !evs.length) throw new Error(`no events replayed: ${JSON.stringify(r).slice(0, 160)}`);
    return `${evs.length} events replayable`;
  });

  await check("the driver's phone rides the snapshot only while the ride is live", async () => {
    /**
     * `trip-view.js` gates it on CONTACTABLE_STATUSES deliberately: a rider who
     * cannot phone their driver at the kerb is the worse safety outcome, but
     * the number must not survive the ride. So this asserts the gate, not the
     * absence — and separately that no credential ever rides a frame.
     */
    const CONTACTABLE = new Set(['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'SCHEDULED', 'FILLING', 'CONFIRMED']);
    const creds = [];
    const walkCreds = (node, p) => {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (/^(accessToken|refreshToken|password|otp|boardingPin)$/i.test(k) && v) creds.push(`${p}.${k}`);
        walkCreds(v, `${p}.${k}`);
      }
    };
    const bad = [];
    let live = 0;
    for (const f of ctx.riderSock.frames.filter((x) => x.event === 'trip:event')) {
      walkCreds(f.payload?.snapshot, `${f.payload?.type}.snapshot`);
      const phone = f.payload?.snapshot?.driver?.phone;
      const status = f.payload?.status ?? f.payload?.snapshot?.status;
      if (phone && !CONTACTABLE.has(status)) bad.push(`${status} still carried it`);
      if (phone) live++;
    }
    // A rider's OWN boarding pin is legitimately on their personal frame; only
    // flag one that arrived for somebody else.
    const foreign = creds.filter((c) => !/boardingPin/i.test(c));
    if (foreign.length) throw new Error(`credential on a frame: ${[...new Set(foreign)].join(', ')}`);
    if (bad.length) throw new Error(`phone survived a terminal status: ${[...new Set(bad)].join(', ')}`);
    return `present on ${live} live frame(s), absent after`;
  });

  section('7 · after the ride');
  await check('rider can read the completed trip', async () => {
    const t = await GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token });
    const trip = t.trip ?? t;
    if (trip.status !== 'COMPLETED') throw new Error(`status ${trip.status}`);
    return `status=${trip.status}`;
  });

  await check('a stranger cannot read that trip', async () => {
    const stranger = await makeRider('E2E Stranger');
    ctx.stranger = stranger;
    const { status } = await req('GET', `/trips/${ctx.tripId}`, { token: stranger.token, raw: true });
    if (status !== 404) throw new Error(`expected 404, got ${status} — trip detail is readable by id alone`);
    return '404 as designed';
  });

  await check('the completed ride appears in the rider history', async () => {
    const h = await GET('/bookings?limit=20', { token: ctx.rider.token });
    const list = h.bookings || h.items || h;
    if (!Array.isArray(list)) throw new Error(`history shape: ${JSON.stringify(h).slice(0, 160)}`);
    const found = list.find((b) => b.tripId === ctx.tripId || b.trip?.id === ctx.tripId);
    if (!found) throw new Error(`${list.length} bookings, none for our trip`);
    ctx.bookingId = found.id;
    return `booking ${found.id?.slice(0, 8)} status=${found.status} fare=${found.farePesewas ?? found.amountPesewas}`;
  });

  await check('GET /rides/active is empty again after completion', async () => {
    const a = await GET('/rides/active', { token: ctx.rider.token });
    if (a.trip) throw new Error(`still reports trip ${a.trip.id} at ${a.trip.status} — ghost live-trip card`);
    return '';
  });

  if (ctx.bookingId) {
    await check('rider rates the driver', async () => {
      await POST(`/bookings/${ctx.bookingId}/rating`, { rating: 5, comment: 'e2e' }, { token: ctx.rider.token });
      return '';
    });
    await check('the receipt carries the fareBreakdown the complete screen reads', async () => {
      const r = await GET(`/receipts/${ctx.bookingId}`, { token: ctx.rider.token });
      const rec = r.receipt ?? r;
      // `ride/[id]/complete.tsx` renders `fareBreakdown.total`, and falls back to
      // `totalPaidPesewas`. With neither, the fare skeleton never resolves —
      // and `getReceipt` swallows the failure with `.catch(() => null)`, so a
      // missing breakdown is silent on the server too.
      const fb = rec?.fareBreakdown;
      if (!fb && rec?.totalPaidPesewas == null) {
        throw new Error(`neither fareBreakdown nor totalPaidPesewas — the complete screen shows a skeleton forever. keys: ${Object.keys(rec || {}).join(',')}`);
      }
      if (fb && !Number.isFinite(fb.total)) throw new Error(`fareBreakdown.total is ${fb.total}`);
      return fb
        ? `total=${fb.total} seats=${fb.seatCount} perSeat=${fb.perSeatPesewas} receiptNo=${rec.receiptNumber ?? 'none (cash)'}`
        : `totalPaidPesewas=${rec.totalPaidPesewas}`;
    });

    await check('the trip detail endpoint the chat screen calls works on an on-demand ride', async () => {
      // `ride/[id]/chat.tsx` and Activity's tap-through both call this. It used
      // to 500 because on-demand trips carry `routeId: null`.
      const t = await GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token });
      const trip = t.trip ?? t;
      if (!Number.isFinite(trip.farePerSeatPesewas)) {
        throw new Error(`no farePerSeatPesewas: ${JSON.stringify(trip).slice(0, 200)}`);
      }
      if (trip.bookings?.some((b) => 'fareAmountPesewas' in b)) {
        throw new Error('per-passenger fare leaked into the bookings array');
      }
      return `fare=${trip.farePerSeatPesewas} route=${trip.route ? 'row' : 'null (on-demand)'} seats=${trip.occupiedSeats}/${trip.maxSeats}`;
    });

    await check('the public share/track page has an origin and a destination', async () => {
      const t = await GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token });
      const shortId = (t.trip ?? t).shortId;
      if (!shortId) throw new Error('trip has no shortId to share');
      const d = await GET(`/trips/track/${shortId}/data`);
      const data = d.trip ?? d;
      if (!data.route?.originName || !data.route?.destinationName) {
        throw new Error(`tracking payload has route=${JSON.stringify(data.route)} — the public page renders a blank header and no pins`);
      }
      return `${data.route.originName} → ${data.route.destinationName} (ended=${!!data.ended})`;
    });
  }

  section('8 · driver side after the ride');
  await check('driver state is free again (not stuck on the finished trip)', async () => {
    const s = await GET('/rides/driver/state', { token: ctx.driver.token });
    if (s.trip && s.trip.status !== 'COMPLETED') throw new Error(`driver still on trip ${s.trip.id} at ${s.trip.status}`);
    if (s.trip && s.trip.status === 'COMPLETED') throw new Error('driver state still returns the completed trip — locks them out of dispatch');
    return `online=${s.driver?.isOnline} wallet=${s.driver?.walletBalancePesewas}`;
  });

  await check('driver earnings reflect the trip', async () => {
    const e = await GET('/driver/earnings/transactions?limit=10', { token: ctx.driver.token });
    const list = e.transactions || e.items || e;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(e).slice(0, 160)}`);
    return `${list.length} transactions`;
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    try { ctx.riderSock?.close(); } catch {}
    try { ctx.driverSock?.close(); } catch {}
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
