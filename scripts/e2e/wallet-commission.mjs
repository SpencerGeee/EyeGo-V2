/**
 * ── THE MONEY THAT MOVES BEFORE ANY MONEY ARRIVES ───────────────────────────
 *
 * A CASH ride is the only product in this system where the DRIVER pays first:
 * the platform's commission has no webhook to ride in on, so it is debited from
 * the driver's wallet at BOARDING. That single fact produces a whole family of
 * bugs, and one of them shipped:
 *
 *   "I accepted a trip and got to the pickup point, but when I tried to mark
 *    the passenger as boarded, THAT is when I got 'insufficient funds'. The
 *    drivers need to know this before they can even accept the trip."
 *
 * The only check that existed lived inside `boardPassenger` — the last possible
 * moment, with the passenger standing at the door. This suite pins the fix down
 * from both ends: the offer must ADVERTISE the float it will need, and the
 * accept must REFUSE when the wallet cannot cover it.
 *
 * It also pins the things that must NOT change: a card/MoMo ride needs no float
 * at all, and a driver who can afford the ride is debited exactly once, for
 * exactly the commission.
 *
 *   node scripts/e2e/wallet-commission.mjs
 */

import {
  BASE, section, check, fail, info, summary,
  GET, POST, req,
  makeRider, makeDriver, goOnline, sleep, until, ACCRA,
} from './lib.mjs';

const ctx = { drivers: [] };

/**
 * A LONG ride, because a short one cannot make a dev driver broke.
 *
 * `POST /driver/dev-activate` seeds a wallet (GH20 on this build), and the
 * 3 km Accra hop the other suites use carries about GH4 of commission — so the
 * "driver cannot afford it" case could never be reached, and the four checks
 * that depend on it failed as collateral while the guard they were testing was
 * working correctly.
 *
 * Winneba is ~55 km down the coast road. At 15% the commission on that clears
 * any plausible seeded float, so the refusal is genuinely exercised. If a build
 * ever seeds MORE than this ride's commission, the check below says so in as
 * many words rather than reporting a bug that is not there.
 */
const FAR = { lat: 5.35, lng: -0.63 };

/** The driver's spendable balance, in pesewas. */
async function balance(driver) {
  const b = await GET('/driver/wallet/balance', { token: driver.token });
  const v = b?.balancePesewas ?? b?.wallet?.balancePesewas;
  if (typeof v !== 'number') throw new Error(`no balancePesewas in ${JSON.stringify(b).slice(0, 160)}`);
  return v;
}

/** Move the driver's wallet to (approximately) `targetPesewas`. */
async function setBalance(driver, targetPesewas) {
  const now = await balance(driver);
  if (targetPesewas > now) {
    await POST('/driver/wallet/topup', { amountPesewas: targetPesewas - now }, { token: driver.token });
  }
  return balance(driver);
}

/** Book a ride and return its trip id. */
async function bookRide(rider, { dropoff = ACCRA.dropoff, paymentMethod = 'CASH' } = {}) {
  const q = await POST(
    '/rides/quote',
    {
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
      tier: 'ECO',
    },
    { token: rider.token },
  );
  const r = await POST(
    '/rides',
    {
      quoteId: q.quoteId,
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
      pickupAddress: 'Kwame Nkrumah Circle, Accra',
      dropoffAddress: 'Destination',
      paymentMethod,
    },
    { token: rider.token },
  );
  return (r.trip ?? r)?.id ?? r.tripId;
}
const bookCashRide = (rider) => bookRide(rider);

/** Wait until this driver can see the trip on their board or as an offer. */
async function waitForOffer(driver, tripId) {
  return until(
    async () => {
      const s = await GET('/rides/driver/state', { token: driver.token }).catch(() => null);
      const offer = s?.offer?.tripId === tripId ? s.offer : null;
      const row = (s?.pendingRequests ?? s?.searches ?? []).find?.((r) => r.tripId === tripId);
      return offer ?? row ?? null;
    },
    { timeoutMs: 30000, everyMs: 1000, label: `offer for ${tripId?.slice(0, 8)}` },
  );
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · actors');
  await check('a rider and two drivers exist', async () => {
    ctx.rider = await makeRider('E2E Wallet Rider');
    ctx.broke = await makeDriver({ name: 'E2E Broke Driver' });
    ctx.flush = await makeDriver({ name: 'E2E Flush Driver' });
    ctx.drivers.push(ctx.broke, ctx.flush);
    return `${ctx.broke.phone} / ${ctx.flush.phone}`;
  });
  if (!ctx.rider || !ctx.broke) return;

  section('2 · the offer advertises what it will cost the driver');
  await check('a driver can be topped up and read their own balance back', async () => {
    const after = await setBalance(ctx.flush, 50_00);
    if (after < 50_00) throw new Error(`top-up did not land: ${after}`);
    ctx.flushStart = after;
    return `GH₵${(after / 100).toFixed(2)}`;
  });

  await check('only the flush driver is in the pool, so the offer is deterministic', async () => {
    await POST('/driver/go-offline', {}, { token: ctx.broke.token }).catch(() => {});
    await goOnline(ctx.flush, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    return 'flush driver online';
  });

  await check('a CASH ride reaches the driver', async () => {
    ctx.tripA = await bookCashRide(ctx.rider);
    if (!ctx.tripA) throw new Error('no trip id');
    ctx.offerA = await waitForOffer(ctx.flush, ctx.tripA);
    return `trip ${ctx.tripA.slice(0, 8)}`;
  });

  await check('the offer payload carries walletRequiredPesewas', async () => {
    const v = ctx.offerA?.walletRequiredPesewas;
    if (v === undefined) {
      throw new Error(
        'walletRequiredPesewas is absent — the driver cannot be warned before accepting. ' +
          `keys=${Object.keys(ctx.offerA ?? {}).join(',')}`,
      );
    }
    if (typeof v !== 'number') throw new Error(`not a number: ${JSON.stringify(v)}`);
    if (v <= 0) throw new Error(`a CASH ride should demand a float, got ${v}`);
    ctx.requiredA = v;
    return `GH₵${(v / 100).toFixed(2)}`;
  });

  await check('the required float is never more than the whole fare', async () => {
    const fare = ctx.offerA?.farePesewas;
    if (typeof fare !== 'number' || fare <= 0) return 'no fare on the offer to compare against';
    if (ctx.requiredA > fare) {
      throw new Error(`commission ${ctx.requiredA} exceeds the fare ${fare} — a rate is being applied twice`);
    }
    return `${((ctx.requiredA / fare) * 100).toFixed(1)}% of the fare`;
  });

  section('3 · a flush driver takes it, and the debit happens exactly once');
  await check('accept succeeds', async () => {
    const r = await POST(`/driver/trips/${ctx.tripA}/accept`, {}, { token: ctx.flush.token });
    const t = r.trip ?? r;
    if (!t?.id) throw new Error(`no trip back: ${JSON.stringify(r).slice(0, 160)}`);
    return `status=${t.status}`;
  });

  await check('accepting does NOT move the wallet — only boarding does', async () => {
    const now = await balance(ctx.flush);
    if (now !== ctx.flushStart) {
      throw new Error(
        `balance changed on accept: ${ctx.flushStart} → ${now}. Commission must be taken at boarding, ` +
          'not at accept, or a declined-then-cancelled ride charges the driver for nothing.',
      );
    }
    return `still GH₵${(now / 100).toFixed(2)}`;
  });

  await check('boarding debits exactly the commission the offer advertised', async () => {
    const detail = await GET(`/driver/trips/${ctx.tripA}`, { token: ctx.flush.token });
    const rows = (detail?.trip ?? detail)?.bookings ?? [];
    const target = rows.find((b) => ['CONFIRMED', 'PAID'].includes(b.status));
    if (!target) throw new Error(`no boardable booking (statuses: ${rows.map((b) => b.status).join(',')})`);
    const before = await balance(ctx.flush);
    await POST(`/driver/trips/${ctx.tripA}/board/${target.id}`, {}, { token: ctx.flush.token });
    const after = await balance(ctx.flush);
    const moved = before - after;
    if (moved <= 0) throw new Error(`boarding a CASH seat did not debit anything (${before} → ${after})`);
    if (Math.abs(moved - ctx.requiredA) > 1) {
      throw new Error(
        `debited ${moved} but the offer advertised ${ctx.requiredA} — the two numbers must be the same ` +
          'or the warning on the offer card is a lie',
      );
    }
    ctx.boardedBookingA = target.id;
    return `GH₵${(moved / 100).toFixed(2)}`;
  });

  await check('boarding the same seat twice does not debit twice', async () => {
    if (!ctx.boardedBookingA) return 'skipped — nothing boarded';
    const before = await balance(ctx.flush);
    await POST(`/driver/trips/${ctx.tripA}/board/${ctx.boardedBookingA}`, {}, { token: ctx.flush.token }).catch(
      () => {},
    );
    const after = await balance(ctx.flush);
    if (after !== before) throw new Error(`re-boarding moved the wallet again: ${before} → ${after}`);
    return 'idempotent';
  });

  await check('a COMMISSION_DEDUCTION row was written for it', async () => {
    const t = await GET('/driver/wallet/transactions?limit=20', { token: ctx.flush.token });
    const list = t.transactions ?? t.items ?? t;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(t).slice(0, 160)}`);
    const row = list.find((x) => String(x.type).includes('COMMISSION'));
    if (!row) {
      throw new Error(
        `no commission row in the ledger (types: ${[...new Set(list.map((x) => x.type))].join(',')}) — ` +
          'a wallet that moves without a ledger row is money the driver cannot account for',
      );
    }
    return `${row.type} ${row.amountPesewas}`;
  });

  section('4 · a broke driver is refused at the OFFER, not at the kerb');
  await check('a long CASH ride reaches a driver who cannot cover its commission', async () => {
    await POST('/driver/go-offline', {}, { token: ctx.flush.token }).catch(() => {});
    await goOnline(ctx.broke, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.rider2 = await makeRider('E2E Wallet Rider 2');
    // FAR, not the usual 3 km hop — see the note on `FAR`. A dev driver is
    // seeded with a float that a short ride's commission cannot exhaust, so
    // the refusal path was unreachable and four checks failed as collateral.
    ctx.tripB = await bookRide(ctx.rider2, { dropoff: FAR });
    ctx.offerB = await waitForOffer(ctx.broke, ctx.tripB);
    ctx.requiredB = ctx.offerB?.walletRequiredPesewas ?? 0;
    ctx.brokeBalance = await balance(ctx.broke);
    if (ctx.brokeBalance >= ctx.requiredB) {
      throw new Error(
        `the driver holds ${ctx.brokeBalance} pesewas and the ride only demands ${ctx.requiredB} — this ` +
          'build seeds a bigger float than a 55 km commission, so the refusal path cannot be exercised. ' +
          'Lower the dev seed or lengthen FAR.',
      );
    }
    return `needs ${ctx.requiredB}p, has ${ctx.brokeBalance}p`;
  });

  await check('ACCEPT is refused with 402 INSUFFICIENT_WALLET_FOR_TRIP', async () => {
    if (!ctx.requiredB || ctx.brokeBalance >= ctx.requiredB) return 'skipped — see above';
    const { status, body } = await req('POST', `/driver/trips/${ctx.tripB}/accept`, {
      token: ctx.broke.token,
      raw: true,
      body: {},
    });
    if (status < 400) {
      throw new Error(
        'a driver who cannot pay the commission was allowed to ACCEPT. They will drive to the pickup ' +
          'and be refused at boarding — the exact bug this suite exists for.',
      );
    }
    if (status !== 402) throw new Error(`refused with ${status} ${body?.code} — expected 402`);
    if (body?.code !== 'INSUFFICIENT_WALLET_FOR_TRIP') {
      throw new Error(`refused with code ${body?.code} — the app branches on INSUFFICIENT_WALLET_FOR_TRIP`);
    }
    return `${status} ${body.code}`;
  });

  /**
   * THE OTHER ACCEPT. Everything above drives `/driver/trips/:id/accept`, which
   * routes through `claimTrip` and always had the wallet gate. The offer sheet
   * the driver actually swipes on posts to `/rides/:id/accept` instead, which
   * reaches `acceptRide` — a different function that skipped the check
   * entirely. A suite that only exercises one of the two accept verbs proves
   * the gate exists, not that it cannot be walked around.
   */
  await check('the OTHER accept verb refuses the broke driver too', async () => {
    if (!ctx.requiredB || ctx.brokeBalance >= ctx.requiredB) return 'skipped — see above';
    const { status, body } = await req('POST', `/rides/${ctx.tripB}/accept`, {
      token: ctx.broke.token,
      raw: true,
      body: {},
    });
    if (status < 400) {
      throw new Error(
        'POST /rides/:id/accept let a driver who cannot pay the commission take a cash ride. ' +
          'This is the verb the swipe-to-accept offer sheet uses, so the gate on the other ' +
          'accept path protects nobody in the flow drivers actually use.',
      );
    }
    if (body?.code !== 'INSUFFICIENT_WALLET_FOR_TRIP') {
      throw new Error(`refused with ${status} ${body?.code} — the app branches on INSUFFICIENT_WALLET_FOR_TRIP`);
    }
    return `${status} ${body.code}`;
  });

  await check('the refusal carries the numbers the app needs to say how much to add', async () => {
    if (!ctx.requiredB || ctx.brokeBalance >= ctx.requiredB) return 'skipped — see above';
    const { body } = await req('POST', `/driver/trips/${ctx.tripB}/accept`, {
      token: ctx.broke.token,
      raw: true,
      body: {},
    });
    const d = body?.details;
    if (!d) throw new Error('no details on the 402 — the app can only show a generic error');
    for (const k of ['requiredPesewas', 'balancePesewas', 'shortfallPesewas']) {
      if (typeof d[k] !== 'number') throw new Error(`details.${k} missing or not a number`);
    }
    if (d.shortfallPesewas !== d.requiredPesewas - d.balancePesewas) {
      throw new Error(`shortfall ${d.shortfallPesewas} ≠ required ${d.requiredPesewas} − balance ${d.balancePesewas}`);
    }
    return `short GH₵${(d.shortfallPesewas / 100).toFixed(2)}`;
  });

  await check('the SAME ride is claimable once the wallet can cover it', async () => {
    if (!ctx.requiredB) return 'skipped — no offer to claim';
    // Topped against `requiredB`, the float THIS ride demands. The old version
    // topped up against the SHORT ride's commission, which was never enough for
    // the long one, so the retry was refused a second time and the check
    // blamed the guard for a number the harness got wrong.
    const after = await setBalance(ctx.broke, ctx.requiredB + 20_00);
    let t = null;
    try {
      const r = await POST(`/driver/trips/${ctx.tripB}/accept`, {}, { token: ctx.broke.token });
      t = r?.trip ?? r;
    } catch (e) {
      throw new Error(
        `accept still failed after topping up to ${after} pesewas: ${e.message}. A refusal the driver ` +
          'cannot clear by paying is worse than no guard at all.',
      );
    }
    if (!t?.id) throw new Error('accept returned no trip after the top-up');
    return `topped to ${after}p, accepted`;
  });

  section('5 · a prepaid ride demands no float at all');
  await check('a MOMO ride advertises walletRequiredPesewas = 0', async () => {
    ctx.rider3 = await makeRider('E2E Prepaid Rider');
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider3.token },
    );
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'MOMO',
      },
      { token: ctx.rider3.token },
    );
    const tripId = (r.trip ?? r)?.id ?? r.tripId;
    if (!tripId) throw new Error('no trip id');
    ctx.tripC = tripId;

    // A FRESH driver: `flush` and `broke` are both mid-trip by now, and a busy
    // driver is correctly excluded from the pool — so reusing one made this
    // check time out waiting for an offer that was never going to come.
    await POST('/driver/go-offline', {}, { token: ctx.broke.token }).catch(() => {});
    ctx.prepaid = await makeDriver({ name: 'E2E Prepaid Driver' });
    ctx.drivers.push(ctx.prepaid);
    await goOnline(ctx.prepaid, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const offer = await waitForOffer(ctx.prepaid, tripId);
    const v = offer?.walletRequiredPesewas;
    if (v === undefined) throw new Error('walletRequiredPesewas absent on a MOMO offer');
    if (v !== 0) {
      throw new Error(
        `a prepaid ride demanded a GH₵${(v / 100).toFixed(2)} float. Card/MoMo settle through the webhook and ` +
          'completeTrip CREDITS the driver — asking them to fund it locks poor drivers out of prepaid work.',
      );
    }
    return 'zero, correctly';
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    for (const d of ctx.drivers) {
      await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
