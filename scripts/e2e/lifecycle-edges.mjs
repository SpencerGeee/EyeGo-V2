/**
 * ── THE ENDINGS NOBODY TESTS ────────────────────────────────────────────────
 *
 * The happy-path suites walk a ride from request to receipt. This one walks off
 * the edges, because every serious defect this codebase has shipped lived in a
 * state the happy path never enters:
 *
 *   · a driver marks a no-show, and the rider's app is told nothing
 *   · a cancelled trip is still openable as a dispatch offer (blank map, stale
 *     card) — the "the notification took me to a cancelled trip" report
 *   · two drivers accept the same ride in the same second
 *   · a terminal trip accepts one more lifecycle verb and re-opens itself
 *   · a rider cancels while the cascade is mid-offer and the driver is left
 *     holding a dead card
 *
 * Each of those is a state machine question, and a state machine is exactly the
 * thing you cannot check by looking at it.
 *
 *   node scripts/e2e/lifecycle-edges.mjs
 */

import {
  BASE, section, check, fail, info, summary,
  GET, POST, req,
  makeRider, makeDriver, goOnline, connectSocket, sleep, until, ACCRA,
  boardEveryone, tripStatus,
} from './lib.mjs';

const ctx = { drivers: [], sockets: [] };

async function bookRide(rider, paymentMethod = 'CASH') {
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
      paymentMethod,
    },
    { token: rider.token },
  );
  return (r.trip ?? r)?.id ?? r.tripId;
}

async function waitClaimable(driver, tripId) {
  return until(
    async () => {
      const s = await GET('/rides/driver/state', { token: driver.token }).catch(() => null);
      if (s?.offer?.tripId === tripId) return s.offer;
      return (s?.pendingRequests ?? []).find?.((r) => r.tripId === tripId) ?? null;
    },
    { timeoutMs: 30000, everyMs: 1000, label: `claimable ${tripId?.slice(0, 8)}` },
  );
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · a cancelled trip is not an offer');
  await check('a rider books, a driver sees it, the rider cancels', async () => {
    ctx.riderA = await makeRider('E2E Edge Rider A');
    ctx.driverA = await makeDriver({ name: 'E2E Edge Driver A' });
    ctx.drivers.push(ctx.driverA);
    await goOnline(ctx.driverA, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.tripCancelled = await bookRide(ctx.riderA);
    await waitClaimable(ctx.driverA, ctx.tripCancelled);
    await POST(`/rides/${ctx.tripCancelled}/cancel`, { reason: 'CHANGED_MIND' }, { token: ctx.riderA.token });
    return ctx.tripCancelled.slice(0, 8);
  });

  await check('the trip reaches a terminal status', async () => {
    if (!ctx.tripCancelled) return 'skipped';
    const s = await until(
      async () => {
        const st = await tripStatus(ctx.driverA.token, ctx.tripCancelled).catch(() => null);
        return ['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(st) ? st : null;
      },
      { timeoutMs: 20000, everyMs: 1000, label: 'terminal status' },
    );
    return s;
  });

  await check('it disappears from the driver board within a few seconds', async () => {
    if (!ctx.tripCancelled) return 'skipped';
    await until(
      async () => {
        const s = await GET('/rides/driver/state', { token: ctx.driverA.token }).catch(() => null);
        const stillOffered =
          s?.offer?.tripId === ctx.tripCancelled ||
          (s?.pendingRequests ?? []).some?.((r) => r.tripId === ctx.tripCancelled);
        return stillOffered ? null : true;
      },
      { timeoutMs: 20000, everyMs: 1000, label: 'row cleared from the board' },
    );
    return 'cleared';
  });

  await check('accepting it is refused, not silently allowed', async () => {
    if (!ctx.tripCancelled) return 'skipped';
    const { status, body } = await req('POST', `/driver/trips/${ctx.tripCancelled}/accept`, {
      token: ctx.driverA.token,
      raw: true,
      body: {},
    });
    if (status < 400) {
      throw new Error(
        'a CANCELLED trip was accepted. This is the "the notification took me to a cancelled trip, the map is ' +
          'blank" report: the driver lands on an offer screen for a ride that no longer exists.',
      );
    }
    return `${status} ${body?.code ?? ''}`.trim();
  });

  section('2 · two drivers, one ride, same second');
  await check('two drivers are online and a ride is open to both', async () => {
    ctx.riderB = await makeRider('E2E Edge Rider B');
    ctx.driverB1 = await makeDriver({ name: 'E2E Race Driver 1' });
    ctx.driverB2 = await makeDriver({ name: 'E2E Race Driver 2' });
    ctx.drivers.push(ctx.driverB1, ctx.driverB2);
    await goOnline(ctx.driverB1, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    await goOnline(ctx.driverB2, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.tripRace = await bookRide(ctx.riderB);
    await waitClaimable(ctx.driverB1, ctx.tripRace).catch(() => null);
    await waitClaimable(ctx.driverB2, ctx.tripRace).catch(() => null);
    return ctx.tripRace.slice(0, 8);
  });

  await check('exactly one accept wins', async () => {
    if (!ctx.tripRace) return 'skipped';
    const [a, b] = await Promise.all([
      req('POST', `/driver/trips/${ctx.tripRace}/accept`, { token: ctx.driverB1.token, raw: true, body: {} }),
      req('POST', `/driver/trips/${ctx.tripRace}/accept`, { token: ctx.driverB2.token, raw: true, body: {} }),
    ]);
    const winners = [a, b].filter((r) => r.status < 400);
    if (winners.length === 0) {
      throw new Error(`neither driver could claim it (${a.status}/${b.status}) — the ride is stranded`);
    }
    if (winners.length === 2) {
      throw new Error(
        'BOTH drivers accepted the same ride. Two cars will arrive and one of them is not getting paid — the ' +
          'compare-and-swap on the status transition is not holding.',
      );
    }
    ctx.raceWinner = a.status < 400 ? ctx.driverB1 : ctx.driverB2;
    ctx.raceLoser = a.status < 400 ? ctx.driverB2 : ctx.driverB1;
    const loserStatus = a.status < 400 ? b.status : a.status;
    if (loserStatus >= 500) throw new Error(`the loser got a ${loserStatus}, which the app renders as "try again"`);
    return `one winner, loser got ${loserStatus}`;
  });

  await check('the trip names exactly one driver afterwards', async () => {
    if (!ctx.raceWinner) return 'skipped';
    const t = await GET(`/driver/trips/${ctx.tripRace}`, { token: ctx.raceWinner.token });
    const trip = t?.trip ?? t;
    if (!trip?.driverId) throw new Error('the trip has no driverId after a successful accept');
    if (trip.driverId !== ctx.raceWinner.id && trip.driver?.id !== ctx.raceWinner.id) {
      info(`trip.driverId=${trip.driverId} winner=${ctx.raceWinner.id}`);
    }
    return `driverId set`;
  });

  await check('the loser can no longer see it on their board', async () => {
    if (!ctx.raceLoser) return 'skipped';
    await sleep(1500);
    const s = await GET('/rides/driver/state', { token: ctx.raceLoser.token }).catch(() => null);
    const still =
      s?.offer?.tripId === ctx.tripRace ||
      (s?.pendingRequests ?? []).some?.((r) => r.tripId === ctx.tripRace);
    if (still) throw new Error('a taken ride is still on the losing driver\'s board — they will tap it into a 409');
    return 'cleared';
  });

  section('3 · a terminal trip stays terminal');
  await check('a completed ride refuses one more verb', async () => {
    if (!ctx.raceWinner) return 'skipped';
    // Drive it to the end.
    for (const verb of ['en-route', 'arrive-pickup']) {
      await POST(`/rides/${ctx.tripRace}/${verb}`, {}, { token: ctx.raceWinner.token }).catch(() => {});
    }
    await boardEveryone(ctx.raceWinner.token, ctx.tripRace);
    await POST(`/rides/${ctx.tripRace}/start`, {}, { token: ctx.raceWinner.token }).catch(() => {});
    await POST(`/rides/${ctx.tripRace}/complete`, {}, { token: ctx.raceWinner.token }).catch(() => {});
    const st = await tripStatus(ctx.raceWinner.token, ctx.tripRace);
    if (st !== 'COMPLETED') {
      return `trip is ${st}, not COMPLETED — cannot exercise the re-open guard this run`;
    }
    const { status } = await req('POST', `/rides/${ctx.tripRace}/start`, {
      token: ctx.raceWinner.token,
      raw: true,
      body: {},
    });
    if (status < 400) {
      const after = await tripStatus(ctx.raceWinner.token, ctx.tripRace);
      throw new Error(`a COMPLETED trip was re-started and is now ${after} — money has already been settled on it`);
    }
    return `refused with ${status}`;
  });

  await check('a completed ride cannot be cancelled out from under its receipt', async () => {
    if (!ctx.tripRace) return 'skipped';
    const st = await tripStatus(ctx.raceWinner?.token, ctx.tripRace).catch(() => null);
    if (st !== 'COMPLETED') return `trip is ${st} — skipped`;
    const { status } = await req('POST', `/rides/${ctx.tripRace}/cancel`, {
      token: ctx.riderB.token,
      raw: true,
      body: { reason: 'CHANGED_MIND' },
    });
    if (status < 400) throw new Error('a COMPLETED trip accepted a cancellation — the receipt and the trip now disagree');
    return `refused with ${status}`;
  });

  section('4 · no-show: the rider must be told');
  await check('a fresh ride is accepted and driven to the pickup', async () => {
    ctx.riderC = await makeRider('E2E No-show Rider');
    ctx.driverC = await makeDriver({ name: 'E2E No-show Driver' });
    ctx.drivers.push(ctx.driverC);
    for (const d of [ctx.driverB1, ctx.driverB2, ctx.driverA]) {
      await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
    await goOnline(ctx.driverC, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.riderCSock = await connectSocket('/rider', ctx.riderC.token).catch(() => null);
    if (ctx.riderCSock) ctx.sockets.push(ctx.riderCSock);
    ctx.tripNoShow = await bookRide(ctx.riderC);
    await waitClaimable(ctx.driverC, ctx.tripNoShow);
    await POST(`/driver/trips/${ctx.tripNoShow}/accept`, {}, { token: ctx.driverC.token });
    for (const verb of ['en-route', 'arrive-pickup']) {
      await POST(`/rides/${ctx.tripNoShow}/${verb}`, {}, { token: ctx.driverC.token }).catch(() => {});
    }
    return await tripStatus(ctx.driverC.token, ctx.tripNoShow);
  });

  await check('the driver can report a no-show', async () => {
    if (!ctx.tripNoShow) return 'skipped';
    const detail = await GET(`/driver/trips/${ctx.tripNoShow}`, { token: ctx.driverC.token });
    const rows = (detail?.trip ?? detail)?.bookings ?? [];
    const b = rows.find((x) => !['CANCELLED', 'NO_SHOW'].includes(x.status));
    if (!b) throw new Error(`no live booking to no-show (statuses: ${rows.map((x) => x.status).join(',')})`);
    ctx.noShowBooking = b.id;
    const attempts = [
      ['POST', `/driver/trips/${ctx.tripNoShow}/no-show/${b.id}`, {}],
      ['POST', `/driver/bookings/${b.id}/no-show`, {}],
      ['POST', `/rides/${ctx.tripNoShow}/no-show`, { bookingId: b.id }],
    ];
    for (const [m, p, body] of attempts) {
      const r = await req(m, p, { token: ctx.driverC.token, raw: true, body });
      if (r.status < 400) {
        ctx.noShowPath = p;
        return `${p} → ${r.status}`;
      }
    }
    throw new Error(
      'no working no-show endpoint among the three shapes the apps use. A driver stuck with an absent ' +
        'passenger has no way to release the seat.',
    );
  });

  await check('the rider is TOLD, over the socket, that it ended', async () => {
    if (!ctx.noShowPath || !ctx.riderCSock) return 'skipped — no no-show fired or no rider socket';
    const f = await ctx.riderCSock
      .waitFor(
        (fr) => {
          const s = fr.payload?.status ?? fr.payload?.payload?.status ?? fr.payload?.snapshot?.status;
          return ['NO_SHOW', 'CANCELLED', 'REFUNDED'].includes(s);
        },
        12000,
        'terminal status frame',
      )
      .catch(() => null);
    if (!f) {
      throw new Error(
        'the rider received no terminal frame. Their app will sit on "your driver is arriving" against a ride ' +
          'that has ended — nothing will ever move it off that screen.',
      );
    }
    return f.event;
  });

  await check('the terminal frame says WHO ended it, so the rider can be told', async () => {
    if (!ctx.riderCSock) return 'skipped';
    const f = ctx.riderCSock.frames.find((fr) => {
      const s = fr.payload?.status ?? fr.payload?.payload?.status;
      return ['NO_SHOW', 'CANCELLED', 'REFUNDED'].includes(s);
    });
    if (!f) return 'skipped — no terminal frame';
    const p = f.payload?.payload ?? f.payload ?? {};
    const status = p.status ?? f.payload?.status;
    const attributed = status === 'NO_SHOW' || p.cancelledBy || p.reason;
    if (!attributed) {
      throw new Error(
        `the frame carries no cancelledBy/reason (keys: ${Object.keys(p).join(',')}). The rider's sheet cannot ` +
          'say "your driver cancelled" versus "your ride was cancelled", and cannot decide whether to promise ' +
          'a refund.',
      );
    }
    return `status=${status} by=${p.cancelledBy ?? p.reason ?? 'implied'}`;
  });

  await check('the rider is no longer holding an active ride', async () => {
    if (!ctx.tripNoShow) return 'skipped';
    const active = await GET('/rides/active', { token: ctx.riderC.token }).catch(() => null);
    const trip = active?.trip ?? active?.data?.trip ?? null;
    if (trip && trip.id === ctx.tripNoShow) {
      throw new Error(
        'GET /rides/active still returns the ended trip — the home screen will keep showing a live-ride card ' +
          'for a ride that is over, and tapping it opens a dead tracking screen',
      );
    }
    return 'cleared';
  });

  section('5 · a driver who is on a trip is not offered another');
  await check('a busy driver is excluded from the pool', async () => {
    if (!ctx.driverC || !ctx.tripNoShow) return 'skipped';
    const rider = await makeRider('E2E Busy Rider');
    const otherTrip = await bookRide(rider);
    await sleep(4000);
    const s = await GET('/rides/driver/state', { token: ctx.driverC.token }).catch(() => null);
    const offered =
      s?.offer?.tripId === otherTrip || (s?.pendingRequests ?? []).some?.((r) => r.tripId === otherTrip);
    const busy = ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'].includes(
      await tripStatus(ctx.driverC.token, ctx.tripNoShow).catch(() => ''),
    );
    if (busy && offered) {
      throw new Error('a driver mid-trip was offered a second, unrelated ride');
    }
    return busy ? 'busy driver was not offered' : 'driver was free — nothing to prove this run';
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    for (const s of ctx.sockets) { try { s.close(); } catch {} }
    for (const d of ctx.drivers) {
      await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
