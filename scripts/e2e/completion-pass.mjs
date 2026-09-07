/**
 * ── THE 2026-09-07 COMPLETION PASS, PINNED ──────────────────────────────────
 *
 * Every check here corresponds to a defect found by running the two apps on
 * two real handsets. They are grouped by the report that produced them, and
 * each one asserts the BEHAVIOUR that was wrong rather than the line that was
 * changed — a refactor is allowed to move the code, not to bring the bug back.
 *
 *   1 · multi-seat requests            "it tells me couldn't request ride"
 *   2 · the walking approach route     "it shows a straight line"
 *   3 · the dispatch board's radius    "it only shows the banner"
 *
 * Needs a live stack with NODE_ENV=development (the fixtures use `_dev_otp`).
 *
 *   node scripts/e2e/completion-pass.mjs
 */

import {
  BASE, section, check, info, summary,
  GET, POST,
  makeRider, makeDriver, goOnline, ACCRA, sleep,
} from './lib.mjs';

const ctx = {};

/** Far enough from Accra that no dispatch radius could ever reach it. */
const KUMASI = { lat: 6.6885, lng: -1.6244 };

const idem = () => `e2e-completion-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** A quote for the standard Accra journey, for a party of `seats`. */
function quoteBody(seats) {
  return {
    pickupLat: ACCRA.pickup.lat,
    pickupLng: ACCRA.pickup.lng,
    dropoffLat: ACCRA.dropoff.lat,
    dropoffLng: ACCRA.dropoff.lng,
    tier: 'ECO',
    ...(seats == null ? {} : { seatCount: seats }),
  };
}

function requestBody(quoteId, seats) {
  return {
    quoteId,
    pickupLat: ACCRA.pickup.lat,
    pickupLng: ACCRA.pickup.lng,
    pickupAddress: 'E2E pickup',
    dropoffLat: ACCRA.dropoff.lat,
    dropoffLng: ACCRA.dropoff.lng,
    dropoffAddress: 'E2E dropoff',
    ...(seats == null ? {} : { seatCount: seats }),
  };
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  await check('a rider fixture exists', async () => {
    ctx.rider = await makeRider('E2E Completion Rider');
    return ctx.rider.phone;
  });
  if (!ctx.rider) {
    summary();
    process.exit(1);
  }
  const rt = { token: ctx.rider.token };

  /* ────────────────────────────────────────────────────────────────────────
   * 1 · MULTI-SEAT REQUESTS
   *
   * The party size is an input to the FARE and lives inside the quote's HMAC
   * signature. `rides.service` refuses a request whose party differs from the
   * priced one — correctly, or a rider could quote for two and travel with
   * eight. The rider app quoted WITHOUT a seat count (so the server signed a
   * party of one) and then requested with the real number, so every party of
   * two or more 409'd with FARE_EXPIRED and surfaced as "Couldn't request
   * ride". A solo hail passed because 1 === 1.
   *
   * Both directions are pinned: the fix must work, and the guard it was
   * tripping over must still be there.
   * ──────────────────────────────────────────────────────────────────────── */
  section('1 · multi-seat requests — "it tells me couldn\'t request ride"');

  await check('a quote accepts a party of 3 and echoes it back', async () => {
    const q = await POST('/rides/quote', quoteBody(3), rt);
    ctx.quote3 = q;
    const got = q.seatCount ?? q.partySize ?? q.breakdown?.seatCount;
    if (got != null && Number(got) !== 3) {
      throw new Error(`quoted party came back as ${got}, not 3`);
    }
    return `quoteId=${String(q.quoteId).slice(0, 12)}… fare=${q.totalPesewas ?? q.farePesewas ?? '?'}`;
  });

  await check('REQUESTING 3 SEATS SUCCEEDS when the quote was for 3', async () => {
    if (!ctx.quote3?.quoteId) throw new Error('no quote to redeem');
    const res = await POST('/rides', requestBody(ctx.quote3.quoteId, 3), {
      ...rt,
      headers: { 'Idempotency-Key': idem() },
    });
    if (!res?.tripId) throw new Error(`no tripId: ${JSON.stringify(res).slice(0, 200)}`);
    ctx.multiSeatTripId = res.tripId;
    return `tripId=${res.tripId}`;
  });

  await check('the trip really carries the party (3 seats, not 1)', async () => {
    if (!ctx.multiSeatTripId) throw new Error('no trip from the previous check');
    const active = await GET('/rides/active', rt);
    const snap = active?.trip ?? active?.snapshot ?? active;
    /**
     * `seats` on a trip snapshot is an OBJECT, not a number:
     * `{ confirmed, max, occupied, boarded, paid, settled }`. Reading it as a
     * scalar is how a check like this passes for the wrong reason — or, as it
     * did on the first run of this suite, fails with "[object Object] seat(s)".
     */
    const seats = snap?.seats;
    if (!seats || typeof seats !== 'object') {
      throw new Error(`no seats object on the snapshot: ${JSON.stringify(snap?.seats)}`);
    }
    /**
     * `max` is what the driver's screen counts against and is the number that
     * read "1/1" in the original report; `confirmed` is the party that is
     * actually holding those seats. Both have to say 3, or somebody at the kerb
     * is not getting in the car.
     */
    if (Number(seats.max) !== 3 || Number(seats.confirmed) !== 3) {
      throw new Error(
        `the trip says max=${seats.max}, confirmed=${seats.confirmed}. The driver would be told to expect ` +
          'the wrong number of people — this is the half of the bug that made it look like a display issue.',
      );
    }
    return `max=${seats.max} confirmed=${seats.confirmed} occupied=${seats.occupied}`;
  });

  await check('THE GUARD STILL BITES: quote for 1, request 3 → 409 FARE_EXPIRED', async () => {
    const q1 = await POST('/rides/quote', quoteBody(1), rt);
    let threw = null;
    try {
      await POST('/rides', requestBody(q1.quoteId, 3), {
        ...rt,
        headers: { 'Idempotency-Key': idem() },
      });
    } catch (e) {
      threw = e;
    }
    if (!threw) {
      throw new Error(
        'a party of 3 was accepted against a quote signed for 1. The price lock is open: a rider can now ' +
          'quote for one and travel with eight.',
      );
    }
    if (threw.status !== 409) throw new Error(`rejected with ${threw.status}, expected 409`);
    return `409 ${threw.code ?? ''}`.trim();
  });

  /* ────────────────────────────────────────────────────────────────────────
   * 2 · THE WALKING APPROACH ROUTE
   *
   * When the rider sets a pickup away from where they are standing, the map
   * draws a dashed leg from their GPS dot to that pin. It was built as a
   * literal two-point LineString, so it cut through buildings.
   *
   * `getRoute` has always taken a `profile`; nothing forwarded one, so every
   * caller silently got a driving route. A pedestrian is not bound by one-way
   * systems, so a driving route here is confidently wrong, not merely
   * approximate.
   * ──────────────────────────────────────────────────────────────────────── */
  section('2 · the walking approach route — "it shows a straight line"');

  const legs =
    `originLat=${ACCRA.pickup.lat}&originLng=${ACCRA.pickup.lng}` +
    `&destLat=${ACCRA.dropoff.lat}&destLng=${ACCRA.dropoff.lng}`;

  await check('GET /geo/route?profile=walking is accepted', async () => {
    ctx.walk = await GET(`/geo/route?${legs}&profile=walking`, rt);
    if (!ctx.walk) throw new Error('empty response');
    return `source=${ctx.walk.source}`;
  });

  await check('the walk is a ROUTE, not a ruler', async () => {
    const coords = ctx.walk?.geometry?.coordinates;
    if (!Array.isArray(coords)) throw new Error('no geometry.coordinates');
    if (coords.length <= 2) {
      throw new Error(
        `${coords.length} points — the approach line would render as the straight line that was reported. ` +
          `source=${ctx.walk.source}`,
      );
    }
    return `${coords.length} points`;
  });

  await check('it is answered by the WALKING profile, not silently by driving', async () => {
    if (ctx.walk?.source === 'estimate') {
      throw new Error('source=estimate — both providers failed; check MAPBOX_SECRET_TOKEN');
    }
    if (ctx.walk?.source === 'driving-traffic') {
      throw new Error(
        'the proxy answered with a DRIVING route for a walking request — the profile is not being ' +
          'forwarded, which is the original defect.',
      );
    }
    if (ctx.walk?.source === 'osrm') {
      return 'osrm fallback (driving geometry, but road-following — acceptable degradation)';
    }
    return `source=${ctx.walk.source}`;
  });

  await check('an unknown profile is REFUSED, not interpolated into the upstream URL', async () => {
    let threw = null;
    try {
      await GET(`/geo/route?${legs}&profile=../../../tokens`, rt);
    } catch (e) {
      threw = e;
    }
    if (!threw) {
      throw new Error(
        'an arbitrary profile was accepted. This value is interpolated into the Mapbox URL, so an ' +
          'unchecked one lets a caller redirect the request using our token.',
      );
    }
    if (threw.status !== 400) throw new Error(`rejected with ${threw.status}, expected 400`);
    return '400';
  });

  await check('the default is still the traffic-aware driving profile', async () => {
    const d = await GET(`/geo/route?${legs}`, rt);
    if (d?.source === 'driving' ) {
      throw new Error('free-flow `driving` — that is the "8.3 km in 12 minutes" regression');
    }
    return `source=${d?.source}`;
  });

  /* ────────────────────────────────────────────────────────────────────────
   * 3 · THE DISPATCH BOARD'S RADIUS
   *
   * Reported as "the dispatch page doesn't pop up — it only shows the banner".
   * The popup path is whole. The BOARD was the broken half: it listed every
   * live search in the world to every driver, with no distance filter and no
   * candidacy filter, so a driver saw rows for rides they were never a
   * candidate for and could never be offered. Banner without a popup, exactly
   * as described.
   * ──────────────────────────────────────────────────────────────────────── */
  section('3 · the dispatch board — "it only shows the banner"');

  await check('a near driver and a far driver both exist and are online', async () => {
    ctx.near = await makeDriver({ name: 'E2E Near Driver' });
    ctx.far = await makeDriver({ name: 'E2E Far Driver' });
    await goOnline(ctx.near, ACCRA.pickup.lat, ACCRA.pickup.lng);
    await goOnline(ctx.far, KUMASI.lat, KUMASI.lng);
    return `near=${ctx.near.id?.slice(0, 8)} far=${ctx.far.id?.slice(0, 8)}`;
  });

  await check('a fresh Accra search exists to advertise', async () => {
    const rider2 = await makeRider('E2E Board Rider');
    const q = await POST('/rides/quote', quoteBody(1), { token: rider2.token });
    const res = await POST('/rides', requestBody(q.quoteId, 1), {
      token: rider2.token,
      headers: { 'Idempotency-Key': idem() },
    });
    ctx.boardTripId = res?.tripId;
    if (!ctx.boardTripId) throw new Error('could not create a search');
    // The cascade runs out of band; give it a moment to write its state.
    await sleep(2500);
    return `tripId=${ctx.boardTripId}`;
  });

  await check('THE FAR DRIVER IS NOT ADVERTISED AN ACCRA SEARCH', async () => {
    if (!ctx.boardTripId) throw new Error('no search to check');
    const st = await GET('/rides/driver/state', { token: ctx.far.token });
    const rows = st?.pendingRequests ?? [];
    const seen = rows.find((r) => r.tripId === ctx.boardTripId);
    if (seen) {
      throw new Error(
        'a driver in Kumasi was shown a search in Accra. The board has no radius filter, so it advertises ' +
          'work the cascade can never offer — which is what produced "banner, but no popup".',
      );
    }
    return `${rows.length} row(s), none of them this trip`;
  });

  await check('the NEAR driver can still see it (the filter did not empty the board)', async () => {
    if (!ctx.boardTripId) throw new Error('no search to check');
    const st = await GET('/rides/driver/state', { token: ctx.near.token });
    const rows = st?.pendingRequests ?? [];
    const seen = rows.find((r) => r.tripId === ctx.boardTripId);
    if (!seen) {
      throw new Error(
        'the nearby driver cannot see a search at their own pickup point. The radius filter is too tight, ' +
          'or the cascade never started — either way this driver gets no work.',
      );
    }
    return `offeredToMe=${seen.offeredToMe} heldByAnother=${seen.heldByAnother}`;
  });

  await check('the board and the sheet agree: an offered row carries a deadline', async () => {
    const st = await GET('/rides/driver/state', { token: ctx.near.token });
    const rows = st?.pendingRequests ?? [];
    const mine = rows.filter((r) => r.offeredToMe);
    if (mine.length === 0) {
      info('no row is currently offered to this driver — the cascade may have moved on; not a failure');
      return 'nothing held right now';
    }
    for (const r of mine) {
      if (!r.expiresAtServerMs) {
        throw new Error(
          `trip ${r.tripId} says offeredToMe with no server deadline. The card would count down from ` +
            'nothing and never expire.',
        );
      }
    }
    // The exclusive offer must ALSO be readable as `offer`, which is what
    // actually raises DispatchOfferSheet when the socket frame was missed.
    if (!st.offer) {
      throw new Error(
        'a row is offeredToMe but GET /rides/driver/state returned offer:null. The 2s poll is what raises ' +
          'the full-screen sheet when the socket frame is lost — with no offer here, the driver only ever ' +
          'gets the banner.',
      );
    }
    return `${mine.length} offered, offer.tripId=${st.offer.tripId}`;
  });

  /* ────────────────────────────────────────────────────────────────────────
   * 4 · IMMEDIATE TRIP REQUESTS RUN THE CASCADE
   *
   * `POST /trips/request` used to broadcast to nearby drivers whatever the
   * departure time was. That is right for a ride four days out — nobody sits
   * on a 45-second countdown for one — and wrong for a ride somebody is
   * waiting for, because a broadcast produces a board row and never an
   * exclusive offer, and an offer is the only thing that raises the driver's
   * full-screen sheet.
   *
   * A request for NOW must now come back with a real trip that the cascade is
   * already searching on. One for later must not.
   * ──────────────────────────────────────────────────────────────────────── */
  section('4 · an immediate request goes through the cascade');

  await check('a request departing now returns a live trip', async () => {
    const rider3 = await makeRider('E2E Immediate Rider');
    const res = await POST(
      '/trips/request',
      {
        destination: 'Madina Market',
        scheduledAt: new Date().toISOString(),
        seatCount: 1,
        pickupLat: ACCRA.pickup.lat,
        pickupLng: ACCRA.pickup.lng,
        destLat: ACCRA.dropoff.lat,
        destLng: ACCRA.dropoff.lng,
      },
      { token: rider3.token },
    );
    ctx.immediateRequestId = res?.requestId;
    ctx.immediateTripId = res?.tripId;
    if (!res?.requestId) throw new Error(`no requestId: ${JSON.stringify(res).slice(0, 200)}`);
    if (!res?.tripId) {
      throw new Error(
        'the response carries no tripId, so this request took the broadcast path. A rider waiting now ' +
          'gets a board row and no driver ever sees a popup — the reported bug.',
      );
    }
    ctx.immediateRiderToken = rider3.token;
    return `tripId=${res.tripId}`;
  });

  await check('the request row is closed against the trip it became', async () => {
    if (!ctx.immediateRequestId) throw new Error('no request to check');
    const r = await GET(`/trips/request/${ctx.immediateRequestId}`, { token: ctx.immediateRiderToken });
    if (r?.status === 'PENDING' || r?.status === 'DISPATCHED') {
      throw new Error(
        `the row is still ${r.status}, so the board keeps advertising it as unclaimed work alongside the ` +
          'cascade that is already running — the two surfaces disagreeing again.',
      );
    }
    if (r?.matchedTripId !== ctx.immediateTripId) {
      throw new Error(`matchedTripId is ${r?.matchedTripId}, expected ${ctx.immediateTripId}`);
    }
    return `status=${r.status}, matched`;
  });

  await check('a request for NEXT WEEK still broadcasts — it must not cascade', async () => {
    const rider4 = await makeRider('E2E Scheduled Rider');
    const nextWeek = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    const res = await POST(
      '/trips/request',
      {
        destination: 'Kumasi',
        scheduledAt: nextWeek,
        seatCount: 1,
        pickupLat: ACCRA.pickup.lat,
        pickupLng: ACCRA.pickup.lng,
        destLat: ACCRA.dropoff.lat,
        destLng: ACCRA.dropoff.lng,
      },
      { token: rider4.token },
    );
    if (res?.tripId) {
      throw new Error(
        'a ride seven days out created a live trip and started a dispatch cascade. Every candidate will ' +
          'time out on a 45-second countdown for a ride nobody can drive yet.',
      );
    }
    return 'broadcast, as intended';
  });

  return summary();
}

/**
 * ── SIGN THE DRIVERS OUT, ALWAYS ────────────────────────────────────────────
 *
 * This suite puts two drivers online at the standard Accra pickup — the exact
 * point `rider-happy-path` requests from. Left in the pool they are candidates
 * for the NEXT suite's trip, and because dispatch is sequential the cascade
 * offers to one of them first and holds the ride for its full window. The next
 * suite's own driver then never receives an offer and its accept comes back
 * "Another driver is being asked about this ride right now".
 *
 * That is precisely how this suite failed `rider-happy-path` on its first full
 * run (25/35, all ten failures downstream of one missed offer) while passing
 * 19/19 itself — a suite that breaks its neighbours and reports success. Every
 * other suite here already signs out in a `finally` for the same reason; see
 * also `reset-pool.mjs`, which exists to clean up after the days before they
 * did.
 *
 * `finally`, not the end of `main`: a suite that fails half way through leaves
 * the worst mess and is exactly when this matters most.
 */
main()
  .then((bad) => {
    // `process.exitCode`, NOT `process.exit()`: the latter terminates the
    // process immediately and the `finally` below would never run — which
    // would leave the drivers online and reintroduce the whole problem while
    // looking like it had been fixed.
    process.exitCode = bad;
  })
  .catch((e) => {
    console.error('\x1b[31mSUITE CRASHED\x1b[0m', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const d of [ctx.near, ctx.far]) {
      if (d?.token) await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
  });
