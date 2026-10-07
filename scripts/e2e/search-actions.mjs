/**
 * ── WHAT A RIDER CAN DO WHILE WE LOOK FOR A DRIVER ──────────────────────────
 *
 * The 2026-10-06 "finding your driver" rework added two server verbs. Both
 * move money or move a pickup on a live search, so both are pinned here rather
 * than trusted to a screen:
 *
 *   POST /rides/:id/boost   +10/20/30 % of the REQUESTED fare, cap +50 %,
 *                           and ALL of it reaches the driver (commission is
 *                           not taken on the extra — the card says so).
 *   POST /rides/:id/pickup  once, within ~200 m, while no driver has accepted.
 *
 *   node scripts/e2e/search-actions.mjs
 */

import {
  section, check, summary, info, GET, POST, req, makeRider, makeDriver, goOnline, until, ACCRA,
} from './lib.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5020';
const ctx = {};

/** The driver's view of this ride: the held offer if they hold it, else the board row. */
async function driverView() {
  const s = await GET('/rides/driver/state', { token: ctx.driver.token });
  const offer = s?.offer?.tripId === ctx.tripId ? s.offer : null;
  const row = (s?.pendingRequests ?? []).find((r) => r.tripId === ctx.tripId) ?? null;
  return offer ?? row;
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · a live search with one driver watching');
  await check('rider + driver exist, ride requested', async () => {
    ctx.rider = await makeRider('E2E Search Rider');
    ctx.driver = await makeDriver({ name: 'E2E Search Driver' });
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    ctx.quoted = q.amountPesewas;
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        pickupAddress: 'Kwame Nkrumah Circle, Accra',
        dropoffAddress: 'Dansoman High Street, Accra',
        paymentMethod: 'CASH',
      },
      { token: ctx.rider.token },
    );
    ctx.tripId = (r.trip ?? r)?.id ?? r.tripId;
    if (!ctx.tripId) throw new Error('no trip id');
    return `trip ${ctx.tripId.slice(0, 8)} quoted ${ctx.quoted}`;
  });
  if (!ctx.tripId) return;

  await check('the driver can see it (offer or board row) with earnings', async () => {
    ctx.before = await until(driverView, { timeoutMs: 30000, everyMs: 1000, label: 'driver sees the ride' });
    if (!Number.isFinite(ctx.before.driverEarningsPesewas)) throw new Error('no driverEarningsPesewas');
    // How many people are waiting — a party of four used to look like one.
    if (ctx.before.partySize !== 1) throw new Error(`partySize ${ctx.before.partySize}, expected 1`);
    return `fare ${ctx.before.farePesewas} · driver keeps ${ctx.before.driverEarningsPesewas} · party ${ctx.before.partySize}`;
  });

  section('2 · fare boost');
  await check('a step outside 10/20/30 is refused', async () => {
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/boost`, {
      token: ctx.rider.token, raw: true, body: { percent: 15 },
    });
    if (status !== 400) throw new Error(`expected 400, got ${status} ${JSON.stringify(body).slice(0, 120)}`);
    return body?.code ?? 'refused';
  });

  await check('+20 % raises the fare by 20 % of the requested fare', async () => {
    const b = await POST(`/rides/${ctx.tripId}/boost`, { percent: 20 }, { token: ctx.rider.token });
    ctx.requested = b.requestedPesewas;
    const want = Math.round(ctx.requested * 0.2);
    if (b.addedPesewas !== want) throw new Error(`added ${b.addedPesewas}, expected ${want}`);
    if (b.farePesewas !== ctx.requested + want) throw new Error(`fare ${b.farePesewas}, expected ${ctx.requested + want}`);
    ctx.boost1 = b;
    return `${ctx.requested} → ${b.farePesewas}`;
  });

  await check('ALL of the boost reaches the driver — none of it is commission', async () => {
    const after = await until(
      async () => {
        const v = await driverView();
        return v && v.farePesewas === ctx.boost1.farePesewas ? v : null;
      },
      { timeoutMs: 15000, everyMs: 1000, label: 'driver view carrying the boosted fare' },
    );
    const gained = after.driverEarningsPesewas - ctx.before.driverEarningsPesewas;
    if (gained !== ctx.boost1.addedPesewas) {
      throw new Error(`driver gained ${gained} of a ${ctx.boost1.addedPesewas} boost — commission was taken on the extra`);
    }
    if (after.commissionPesewas !== ctx.before.commissionPesewas) {
      throw new Error(`commission moved ${ctx.before.commissionPesewas} → ${after.commissionPesewas}`);
    }
    // The card says "+GH₵X rider boost · 100% yours" — it must name the same X.
    if (after.boostPesewas !== ctx.boost1.addedPesewas) {
      throw new Error(`card names a boost of ${after.boostPesewas}, rider added ${ctx.boost1.addedPesewas}`);
    }
    return `driver keeps ${ctx.before.driverEarningsPesewas} → ${after.driverEarningsPesewas} (boost ${after.boostPesewas} named)`;
  });

  await check('…and it STAYS — the late road to the pickup never brings the old fare back', async () => {
    // The driver→pickup road is fetched after the offer goes out and used to
    // re-park the PRE-boost payload with it, putting the old fare back on the
    // card a few seconds later. Watch long enough for that road to land.
    const t0 = Date.now();
    let seen = 0;
    while (Date.now() - t0 < 6000) {
      const v = await driverView();
      if (v) {
        seen += 1;
        if (v.farePesewas !== ctx.boost1.farePesewas) {
          throw new Error(`the card went back to ${v.farePesewas} (boosted ${ctx.boost1.farePesewas})`);
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return `${seen} reads, all ${ctx.boost1.farePesewas}`;
  });

  await check('+30 % on top reaches the +50 % cap exactly', async () => {
    const b = await POST(`/rides/${ctx.tripId}/boost`, { percent: 30 }, { token: ctx.rider.token });
    if (b.totalBoostPesewas !== Math.round(ctx.requested * 0.2) + Math.round(ctx.requested * 0.3)) {
      throw new Error(`total boost ${b.totalBoostPesewas}`);
    }
    return `total +${b.totalBoostPesewas} (cap ${b.capPesewas})`;
  });

  await check('anything past +50 % is refused', async () => {
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/boost`, {
      token: ctx.rider.token, raw: true, body: { percent: 10 },
    });
    if (status !== 409) throw new Error(`expected 409, got ${status}`);
    return body?.code ?? body?.error?.code ?? 'refused';
  });

  await check('another rider cannot boost this ride', async () => {
    const stranger = await makeRider('E2E Stranger');
    const { status } = await req('POST', `/rides/${ctx.tripId}/boost`, {
      token: stranger.token, raw: true, body: { percent: 10 },
    });
    if (status !== 403) throw new Error(`expected 403, got ${status}`);
    return '403';
  });

  section('3 · move the pickup');
  await check('a move further than 200 m is refused', async () => {
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/pickup`, {
      token: ctx.rider.token, raw: true,
      body: { lat: ACCRA.pickup.lat + 0.01, lng: ACCRA.pickup.lng }, // ~1.1 km
    });
    if (status !== 409) throw new Error(`expected 409, got ${status}`);
    return body?.code ?? body?.error?.code ?? 'refused';
  });

  await check('a ~100 m move lands on the trip and the driver view', async () => {
    const to = { lat: ACCRA.pickup.lat + 0.0009, lng: ACCRA.pickup.lng }; // ~100 m north
    await POST(`/rides/${ctx.tripId}/pickup`, { ...to, address: 'Circle, east entrance' }, { token: ctx.rider.token });
    const v = await until(
      async () => {
        const x = await driverView();
        return x && Math.abs(x.pickupLat - to.lat) < 1e-6 ? x : null;
      },
      { timeoutMs: 15000, everyMs: 1000, label: 'driver view at the new pickup' },
    );
    return `driver sees ${v.pickupAddress}`;
  });

  await check('a second move is refused — once only', async () => {
    const { status, body } = await req('POST', `/rides/${ctx.tripId}/pickup`, {
      token: ctx.rider.token, raw: true,
      body: { lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng },
    });
    if (status !== 409) throw new Error(`expected 409, got ${status}`);
    return body?.code ?? body?.error?.code ?? 'refused';
  });

  await check('a resumed search reads its money back from its own events', async () => {
    // The rider app re-opening a search (Home card, cold start) has no quote in
    // hand: it takes the RIDER'S snapshot fare and subtracts every FARE_BOOSTED.
    // That must land on the requested fare exactly, or every chip is wrong.
    const r = await GET(`/rides/${ctx.tripId}/events?since=0`, { token: ctx.rider.token });
    const events = r?.events ?? [];
    const current = r?.snapshot?.fare?.amountPesewas;
    const boosts = events
      .filter((e) => e.type === 'FARE_BOOSTED')
      .reduce((n, e) => n + (Number(e.payload?.addedPesewas) || 0), 0);
    if (current - boosts !== ctx.requested) {
      throw new Error(`current ${current} − boosts ${boosts} ≠ requested ${ctx.requested}`);
    }
    if (!events.some((e) => e.type === 'PICKUP_MOVED')) throw new Error('no PICKUP_MOVED in the log');
    return `${current} − ${boosts} = ${ctx.requested}`;
  });

  section('4 · a ride with a driver is locked');
  await check('after accept, boost and pickup are both refused', async () => {
    await POST(`/rides/${ctx.tripId}/accept`, {}, { token: ctx.driver.token });
    const boost = await req('POST', `/rides/${ctx.tripId}/boost`, {
      token: ctx.rider.token, raw: true, body: { percent: 10 },
    });
    const move = await req('POST', `/rides/${ctx.tripId}/pickup`, {
      token: ctx.rider.token, raw: true, body: { lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng },
    });
    if (boost.status !== 409 || move.status !== 409) {
      throw new Error(`boost ${boost.status}, pickup ${move.status} — a matched ride can still be changed`);
    }
    return 'RIDE_LOCKED';
  });

  section('5 · an ended search still answers for itself');
  await check('/rides/active forgets it, but its replay names the ending', async () => {
    // What the rider app's hydrate falls back on when a search ended while the
    // app sat in the switcher: without it the request stage saw `trip: null`
    // and showed "Sending your request" for ever.
    const rider = await makeRider('E2E Ended Search');
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: rider.token },
    );
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'CASH',
      },
      { token: rider.token },
    );
    const id = (r.trip ?? r)?.id ?? r.tripId;
    await POST(`/rides/${id}/cancel`, { reason: 'e2e: ended search' }, { token: rider.token });
    const active = await GET('/rides/active', { token: rider.token });
    if (active?.trip) throw new Error('/rides/active still returns the ended trip');
    const replay = await GET(`/rides/${id}/events?since=0`, { token: rider.token });
    if (replay?.snapshot?.status !== 'CANCELLED') throw new Error(`replay status ${replay?.snapshot?.status}`);
    return 'active: null · replay: CANCELLED';
  });
}

main()
  .catch((e) => info(`harness crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`))
  .finally(async () => {
    if (ctx.tripId && ctx.driver) {
      await POST(`/rides/${ctx.tripId}/driver-cancel`, { reason: 'e2e teardown' }, { token: ctx.driver.token }).catch(() => {});
    }
    if (ctx.tripId && ctx.rider) {
      await POST(`/rides/${ctx.tripId}/cancel`, { reason: 'e2e teardown' }, { token: ctx.rider.token }).catch(() => {});
    }
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    process.exitCode = summary() ? 1 : 0;
  });
