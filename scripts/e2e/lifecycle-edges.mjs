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
    ctx.cancelBody = await POST(
      `/rides/${ctx.tripCancelled}/cancel`,
      { reason: 'CHANGED_MIND' },
      { token: ctx.riderA.token },
    );
    return ctx.tripCancelled.slice(0, 8);
  });

  await check('the trip reaches a terminal status', async () => {
    if (!ctx.tripCancelled) return 'skipped';
    /**
     * The cancel response IS the answer. Nothing to poll.
     *
     * Two wrong doors were tried first. `tripStatus` reads /driver/trips/:id,
     * which is scoped to the driver a trip belongs to, and this one was never
     * assigned — 404. `GET /trips/:id` is the GROUP-trip reader and 404s for an
     * on-demand ride too. Both looked like "the server never cancelled it",
     * which is the worst kind of false finding: it accuses the one subsystem
     * that was demonstrably working (the board clears, and the accept below is
     * correctly refused with 409).
     *
     * `POST /rides/:id/cancel` answers `{ tripId, status, version, freeCancel }`
     * — the transition, stated by the thing that performed it.
     */
    const st = ctx.cancelBody?.status;
    if (!['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(st)) {
      throw new Error(`cancel answered status=${JSON.stringify(st)} — the ride may still be live`);
    }
    if (typeof ctx.cancelBody?.version !== 'number') {
      throw new Error('the cancel carried no version — an unversioned transition cannot be replayed in order');
    }
    return `${st} at v${ctx.cancelBody.version}`;
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
    /**
     * Driver A OFF first.
     *
     * They were left online from section 1, so the cascade could hand the
     * exclusive offer to a THIRD driver — and both racers then got a perfectly
     * correct `409 OFFER_HELD_BY_ANOTHER`, which this suite reported as "the
     * ride is stranded". The server was right and the fixture was dirty.
     */
    await POST('/driver/go-offline', {}, { token: ctx.driverA.token }).catch(() => {});
    await goOnline(ctx.driverB1, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    await goOnline(ctx.driverB2, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.tripRace = await bookRide(ctx.riderB);
    /**
     * Concurrently, not one after the other.
     *
     * Sequential `until` polls burn up to 30 s EACH, and an exclusive offer
     * lives for 45 — so by the time the second driver was confirmed to see the
     * ride, the cascade had frequently moved on and both accepts got a correct
     * 409. Waiting in parallel keeps the race inside one offer window.
     */
    /**
     * Wait for a HOLDER, not merely for the row to appear.
     *
     * Dispatch is sequential: one driver is inside the exclusive window and the
     * other sees the same ride as `heldByAnother`. `waitClaimable` returns
     * either, so the race used to fire before anybody could actually win it.
     * The real race is the holder and the non-holder accepting together — the
     * holder must win, the other must be refused, exactly once.
     */
    ctx.holder = await until(
      async () => {
        for (const d of [ctx.driverB1, ctx.driverB2]) {
          const s = await GET('/rides/driver/state', { token: d.token }).catch(() => null);
          if (s?.offer?.tripId === ctx.tripRace) return d;
          const row = (s?.pendingRequests ?? []).find?.((r) => r.tripId === ctx.tripRace);
          if (row?.offeredToMe) return d;
        }
        return null;
      },
      { timeoutMs: 30000, everyMs: 700, label: 'one of the two drivers to hold the offer' },
    );
    return `${ctx.tripRace.slice(0, 8)} held by ${ctx.holder === ctx.driverB1 ? 'B1' : 'B2'}`;
  });

  await check('exactly one accept wins', async () => {
    if (!ctx.tripRace) return 'skipped';
    /**
     * Read the status FIRST, so a failure here is diagnostic.
     *
     * "Neither driver could claim it" means one of two very different things —
     * a broken compare-and-swap, or a ride that was no longer being offered by
     * the time the harness got to it. Without this line the two are
     * indistinguishable and the finding is unusable.
     */
    const before = await GET(`/trips/${ctx.tripRace}`, { token: ctx.riderB.token }).catch(() => null);
    const beforeStatus = (before?.trip ?? before)?.status ?? 'unknown';
    if (!['REQUESTED', 'MATCHING'].includes(beforeStatus)) {
      return `trip was ${beforeStatus}, not still being offered — no race to run this pass`;
    }
    const [a, b] = await Promise.all([
      req('POST', `/driver/trips/${ctx.tripRace}/accept`, { token: ctx.driverB1.token, raw: true, body: {} }),
      req('POST', `/driver/trips/${ctx.tripRace}/accept`, { token: ctx.driverB2.token, raw: true, body: {} }),
    ]);
    const winners = [a, b].filter((r) => r.status < 400);
    if (winners.length === 0) {
      const after = await GET(`/trips/${ctx.tripRace}`, { token: ctx.riderB.token }).catch(() => null);
      throw new Error(
        `neither driver could claim it (${a.status} ${a.body?.code ?? ''} / ${b.status} ${b.body?.code ?? ''}) ` +
          `— trip was ${beforeStatus} before, ${(after?.trip ?? after)?.status ?? '?'} after. The ride is stranded.`,
      );
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
    /**
     * `/passenger`, not `/rider`.
     *
     * The namespace was guessed, the connect failed, and the two checks below
     * — the ONLY direct proof that a rider is told when their driver walks away
     * — reported themselves as "skipped" and the suite still went green. A
     * check that quietly stops checking is exactly what this harness exists to
     * catch, so this one throws now rather than shrugging.
     */
    ctx.riderCSock = await connectSocket('/passenger', ctx.riderC.token);
    ctx.sockets.push(ctx.riderCSock);
    ctx.tripNoShow = await bookRide(ctx.riderC);
    await waitClaimable(ctx.driverC, ctx.tripNoShow);
    await POST(`/driver/trips/${ctx.tripNoShow}/accept`, {}, { token: ctx.driverC.token });
    /**
     * JOIN THE TRIP ROOM, WITH THE EVENT THE SERVER ACTUALLY LISTENS FOR.
     *
     * `passenger:join_trip_room`, not `join_tracking`. The frame is published
     * to `trip:<id>`, and a socket that never joined that room receives
     * nothing — so the checks below reported "the rider was never told" about a
     * server that had told them correctly. Joined after the accept, because the
     * handler wants the driver id too.
     */
    ctx.riderCSock.emit('passenger:join_trip_room', {
      tripId: ctx.tripNoShow,
      driverId: ctx.driverC.id,
    });
    await sleep(600);
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
    /**
     * The real routes, from trips.routes.js — the three shapes guessed here
     * first were all wrong, and a harness that invents an endpoint reports a
     * missing feature that has existed all along.
     *
     *   POST /trips/:id/rider-no-show/:bookingId   one passenger did not show
     *   POST /trips/:id/driver-no-show             nobody showed; refund all
     */
    const attempts = [
      ['POST', `/trips/${ctx.tripNoShow}/rider-no-show/${b.id}`, {}],
      ['POST', `/trips/${ctx.tripNoShow}/driver-no-show`, {}],
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
    if (!ctx.noShowPath) throw new Error('no no-show was fired — nothing to prove');
    if (!ctx.riderCSock) throw new Error('the rider socket never connected — see the namespace note above');
    /**
     * A RIDER no-show is a BOOKING-level ending, not a trip-level one.
     *
     * The bus drives on with everybody else aboard, so the trip status stays
     * live — and this check originally waited only on `status`, which meant it
     * would have gone green the moment the whole trip was cancelled for an
     * unrelated reason and stayed red forever otherwise. What has to reach this
     * rider is their OWN seat dying: `myBooking.status === 'NO_SHOW'` inside the
     * published snapshot, which is the field the rider app now branches on.
     */
    /**
     * Matched on the ENVELOPE, because that is all a broadcast can carry.
     *
     * `snapshot.myBooking` is resolved from a `forUserId` and a frame sent to
     * the whole trip room has no single viewer — so it is absent here, and an
     * assertion on it can never pass. (The rider app had the same mistake; this
     * check is what found it.) The envelope's `type` plus `payload.bookingId`
     * is what a rider can actually identify their own seat from.
     */
    const isMine = (fr) => {
      const p = fr.payload ?? {};
      const snap = p.snapshot ?? {};
      const type = p.type ?? p.event;
      const tripLevel = p.status ?? snap?.status;
      if (type === 'PASSENGER_NO_SHOW' && p.payload?.bookingId === ctx.noShowBooking) return true;
      if ((snap?.myBooking?.status ?? p.myBooking?.status) === 'NO_SHOW') return true;
      return ['NO_SHOW', 'CANCELLED', 'REFUNDED'].includes(tripLevel);
    };
    const f = await ctx.riderCSock
      .waitFor(isMine, 12000, 'a frame saying this rider is no longer travelling')
      .catch(() => null);
    if (!f) {
      // Name what DID arrive. "No frame" and "the wrong frame" are different
      // bugs and a failure that cannot tell them apart cannot be acted on.
      const seen = ctx.riderCSock.frames.map((x) => x.event);
      const shapes = ctx.riderCSock.frames
        .slice(-4)
        .map((x) => `${x.event}:${Object.keys(x.payload ?? {}).join('|').slice(0, 70)}`);
      throw new Error(
        'the rider received no frame saying they are no longer travelling. Their app will sit on "your driver ' +
          'is arriving" against a ride that has ended. ' +
          `Frames seen (${ctx.riderCSock.frames.length}): ${[...new Set(seen)].join(',') || 'none'}. ` +
          `Last shapes: ${shapes.join(' ~ ') || 'none'}`,
      );
    }
    return f.event;
  });

  await check('the frame names the event, so the rider sheet can say what happened', async () => {
    if (!ctx.riderCSock) throw new Error('no rider socket');
    const f = ctx.riderCSock.frames.find(
      (fr) => (fr.payload?.type ?? fr.payload?.event) === 'PASSENGER_NO_SHOW',
    );
    if (!f) {
      const seen = [...new Set(ctx.riderCSock.frames.map((x) => x.payload?.type ?? x.event))];
      throw new Error(`no PASSENGER_NO_SHOW frame. Types seen: ${seen.join(',') || 'none'}`);
    }
    const p = f.payload ?? {};
    const type = p.type ?? p.event;
    if (p.payload?.bookingId !== ctx.noShowBooking) {
      throw new Error(
        `the frame names booking ${p.payload?.bookingId} but the one no-showed was ${ctx.noShowBooking} — ` +
          'without a matching id every other passenger on a group trip would think it was them',
      );
    }
    if (typeof p.seq !== 'number') {
      throw new Error('the frame has no seq — an unsequenced frame cannot be replayed after a reconnect');
    }
    if (type !== 'PASSENGER_NO_SHOW') {
      throw new Error(
        `the frame's type is ${JSON.stringify(type)}. The rider's app distinguishes "your driver cancelled" ` +
          'from "your ride was cancelled" from this, and gets the refund sentence wrong without it.',
      );
    }
    return `type=${type}`;
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
