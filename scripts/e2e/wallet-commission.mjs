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

/** Book a CASH ride and return its trip id. */
async function bookCashRide(rider) {
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
  return (r.trip ?? r)?.id ?? r.tripId;
}

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
  await check('the broke driver has less than one commission in the wallet', async () => {
    const b = await balance(ctx.broke);
    if (b >= (ctx.requiredA ?? 1)) {
      // A dev fixture may seed a balance. Nothing here can spend it down, so
      // say so rather than pretend the case was covered.
      throw new Error(
        `broke driver starts on ${b} pesewas, which already covers the ${ctx.requiredA} commission — ` +
          'this environment seeds driver wallets, so the refusal case cannot be exercised here',
      );
    }
    return `GH₵${(b / 100).toFixed(2)}`;
  });

  await check('a second CASH ride reaches the broke driver', async () => {
    await POST('/driver/go-offline', {}, { token: ctx.flush.token }).catch(() => {});
    await goOnline(ctx.broke, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    ctx.rider2 = await makeRider('E2E Wallet Rider 2');
    ctx.tripB = await bookCashRide(ctx.rider2);
    ctx.offerB = await waitForOffer(ctx.broke, ctx.tripB);
    return `trip ${ctx.tripB.slice(0, 8)}`;
  });

  await check('ACCEPT is refused with 402 INSUFFICIENT_WALLET_FOR_TRIP', async () => {
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

  await check('the refusal carries the numbers the app needs to say "top up GH₵X"', async () => {
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

  await check('the trip is still claimable by somebody who CAN pay', async () => {
    const after = await setBalance(ctx.broke, (ctx.requiredA ?? 500) + 20_00);
    const r = await POST(`/driver/trips/${ctx.tripB}/accept`, {}, { token: ctx.broke.token });
    const t = r.trip ?? r;
    if (!t?.id) throw new Error(`accept after top-up still failed: ${JSON.stringify(r).slice(0, 160)}`);
    return `topped to GH₵${(after / 100).toFixed(2)}, accepted`;
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

    await POST('/driver/go-offline', {}, { token: ctx.broke.token }).catch(() => {});
    await goOnline(ctx.flush, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const offer = await waitForOffer(ctx.flush, tripId);
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
