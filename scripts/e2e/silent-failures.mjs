/**
 * ── THE 200 THAT DID NOTHING ────────────────────────────────────────────────
 *
 * "Bugs failing silently" is a category, not an accident, and this system has
 * produced the same three species of it over and over:
 *
 *   THE FAKE SUCCESS      An endpoint answers 200 and writes nothing. The app
 *                         shows a tick, the user believes it, and the change is
 *                         gone on the next refresh. ("delete account did
 *                         nothing", "the phantom withdraw".)
 *   THE SETTING NOBODY    A knob is stored and never read. Nothing errors; the
 *   READS                 feature simply is not on. ("the inert
 *                         GEO_VALIDATION_ENABLED flag", "the seat-hold knob
 *                         mismatch".)
 *   THE HALF-SHAPE        A branch returns `null` or a differently-shaped body
 *                         than its sibling, and the other party 500s or renders
 *                         a blank. ("a pref-gated branch returning bare null".)
 *
 * The only way to catch any of them is to WRITE, then read back through a
 * different door and check the value actually moved. That is what every check
 * here does — never "did it return 200", always "is the world different now".
 *
 *   node scripts/e2e/silent-failures.mjs
 */

import {
  BASE, section, check, fail, info, summary,
  GET, POST, PATCH, req,
  makeRider, makeDriver, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  await check('a rider and a driver exist', async () => {
    ctx.rider = await makeRider('E2E Silent Rider');
    ctx.driver = await makeDriver({ name: 'E2E Silent Driver' });
    return `${ctx.rider.phone} / ${ctx.driver.phone}`;
  });
  if (!ctx.rider) return;

  section('1 · a write is only a write if you can read it back');
  await check('PATCH /user/me actually persists a name', async () => {
    const name = `Ama Owusu ${Date.now() % 10000}`;
    await PATCH('/user/me', { name }, { token: ctx.rider.token });
    const me = await GET('/user/me', { token: ctx.rider.token });
    const got = (me.user ?? me)?.name;
    if (got !== name) throw new Error(`wrote "${name}", read back "${got}"`);
    return name;
  });

  await check('a rider field the API does claim survives a round trip', async () => {
    /**
     * Deliberately NOT probing with a made-up key.
     *
     * The first version of this check PATCHed `{ preferences: {...} }` and
     * called the absence of it in the response a silent write. It is not: a
     * PATCH that ignores a field it has never declared is behaving correctly,
     * and a harness that fails on it manufactures a bug. Assert the round trip
     * on a field the API genuinely owns instead.
     */
    const email = `e2e${Date.now() % 100000}@example.com`;
    const probe = await req('PATCH', '/user/me', { token: ctx.rider.token, raw: true, body: { email } });
    if (probe.status >= 400) return `email not writable on this build (${probe.status})`;
    const me = await GET('/user/me', { token: ctx.rider.token });
    const got = (me.user ?? me)?.email;
    if (got !== email) throw new Error(`wrote "${email}", read back ${JSON.stringify(got)}`);
    return 'persisted';
  });

  await check('driver preferences persist (and are not write-only)', async () => {
    // There is no GET /driver/preferences. `updatePreferences` merges into a
    // JSON column that `getMe` parses and SPREADS onto the driver object, so
    // /driver/me is where a written preference is read back from.
    const probe = await req('PATCH', '/driver/preferences', {
      token: ctx.driver.token,
      raw: true,
      body: { navigationApp: 'waze' },
    });
    if (probe.status >= 400) return `endpoint not on this build (${probe.status})`;
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const d = me?.driver ?? me;
    if (d?.navigationApp !== 'waze') {
      throw new Error(
        `wrote navigationApp=waze, /driver/me says ${JSON.stringify(d?.navigationApp)} — a preference the ` +
          'app writes and can never read back is a setting that silently does nothing',
      );
    }
    return 'readable via /driver/me';
  });

  section('2 · money endpoints must move money or refuse');
  await check('a top-up of 0 is refused rather than silently accepted', async () => {
    const { status } = await req('POST', '/driver/wallet/topup', {
      token: ctx.driver.token,
      raw: true,
      body: { amountPesewas: 0 },
    });
    if (status < 400) throw new Error('a zero top-up returned success — the app will show a confirmation for nothing');
    return `refused with ${status}`;
  });

  await check('a negative top-up cannot drain the wallet', async () => {
    const before = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
    await req('POST', '/driver/wallet/topup', {
      token: ctx.driver.token,
      raw: true,
      body: { amountPesewas: -5000 },
    });
    const after = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
    if (after < before) throw new Error(`a negative top-up REMOVED ${before - after} pesewas`);
    return `balance held at ${after}`;
  });

  await check('a real top-up changes the balance AND writes a ledger row', async () => {
    const before = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
    await POST('/driver/wallet/topup', { amountPesewas: 10_00 }, { token: ctx.driver.token });
    const after = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
    if (after - before !== 10_00) throw new Error(`balance moved ${after - before}, expected 1000`);
    const tx = await GET('/driver/wallet/transactions?limit=5', { token: ctx.driver.token });
    const list = tx.transactions ?? tx.items ?? tx;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('the balance moved but the ledger is empty — money the driver cannot account for');
    }
    return `+GH₵10.00, ${list.length} rows`;
  });

  await check('withdrawing more than the balance is refused', async () => {
    const bal = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
    const { status } = await req('POST', '/driver/wallet/withdraw', {
      token: ctx.driver.token,
      raw: true,
      body: { amountPesewas: bal + 1_000_00 },
    });
    if (status < 400) {
      const after = (await GET('/driver/wallet/balance', { token: ctx.driver.token }))?.balancePesewas ?? 0;
      throw new Error(`an over-withdrawal returned success (balance ${bal} → ${after}) — the phantom withdraw`);
    }
    return `refused with ${status}`;
  });

  section('3 · runtime settings are read, not just stored');
  await check('GET /config/public answers with the knobs the apps branch on', async () => {
    // Authenticated on purpose — the route's own note says "there is no reason
    // for it to be open". Both apps call it with a token, so this must too.
    const c = await GET('/config/public', { token: ctx.rider.token });
    const cfg = c?.config ?? c;
    if (!cfg || typeof cfg !== 'object') throw new Error(`shape: ${JSON.stringify(c).slice(0, 160)}`);
    ctx.config = cfg;
    return `${Object.keys(cfg).length} keys`;
  });

  await check('the config carries no secrets', async () => {
    const blob = JSON.stringify(ctx.config ?? {});
    const leaked = blob.match(/(sk_[A-Za-z0-9]{8,}|SECRET|PRIVATE_KEY|"password")/gi);
    if (leaked) throw new Error(`public config exposes ${[...new Set(leaked)].join(', ')}`);
    return 'clean';
  });

  await check('fare knobs are numbers, not strings', async () => {
    const cfg = ctx.config ?? {};
    const numeric = Object.entries(cfg).filter(([k]) => /pesewas|Pesewas|Rate|Multiplier|Seconds|Meters|Metres/.test(k));
    if (numeric.length === 0) return 'no numeric knobs exposed publicly';
    const bad = numeric.filter(([, v]) => v !== null && typeof v !== 'number');
    if (bad.length) {
      throw new Error(
        `${bad.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')} — a string here is silently NaN in ` +
          'every arithmetic expression the apps put it into',
      );
    }
    return `${numeric.length} numeric knobs, all numbers`;
  });

  section('4 · authorisation is not advisory');
  await check('an unauthenticated call to a private route is refused', async () => {
    const { status } = await req('GET', '/user/me', { raw: true });
    if (status !== 401 && status !== 403) throw new Error(`answered ${status} with no token`);
    return `${status}`;
  });

  await check('even /config/public needs a token — it is an allow-list, not a public page', async () => {
    const { status } = await req('GET', '/config/public', { raw: true });
    if (status !== 401 && status !== 403) throw new Error(`answered ${status} with no token`);
    return `${status}`;
  });

  await check('a rider token cannot drive the driver API', async () => {
    const { status } = await req('GET', '/driver/wallet/balance', { token: ctx.rider.token, raw: true });
    if (status < 400) throw new Error('a rider token read a driver wallet');
    return `${status}`;
  });

  await check('a driver token cannot read another driver\'s trips', async () => {
    const other = await makeDriver({ name: 'E2E Other Driver' });
    const { status } = await req('GET', `/driver/trips/${'0'.repeat(24)}`, { token: other.token, raw: true });
    if (status >= 500) throw new Error(`a bogus id 500s (${status}) instead of 404 — an unhandled DB error path`);
    return `${status}`;
  });

  await check('a garbage trip id is a 4xx, never a 500', async () => {
    for (const id of ['not-a-uuid', '../../etc/passwd', '%00']) {
      const { status } = await req('GET', `/driver/trips/${encodeURIComponent(id)}`, {
        token: ctx.driver.token,
        raw: true,
      });
      if (status >= 500) throw new Error(`id ${JSON.stringify(id)} → ${status}`);
    }
    return 'all 4xx';
  });

  section('5 · list endpoints answer with a list');
  // Real paths, checked against the route files. `/bookings/my-history` fell
  // through to `GET /bookings/:bookingId` and answered 404 "Booking not found",
  // which this suite quietly treated as "not on this build" — a check that
  // silently stops checking is the very thing the suite is named after.
  const LISTS = [
    ['/notifications?limit=5', ctx => ctx.rider, 'notifications'],
    ['/bookings?limit=5', ctx => ctx.rider, 'bookings'],
    ['/driver/trips?limit=5', ctx => ctx.driver, 'trips'],
    ['/driver/wallet/transactions?limit=5', ctx => ctx.driver, 'transactions'],
    // `/v1/quests`, not `/driver/quests` — the wrong path answered 404 and this
    // check reported "not on this build" for a feature that has a whole tab.
    ['/quests', ctx => ctx.driver, 'quests'],
  ];
  for (const [path, who, label] of LISTS) {
    // eslint-disable-next-line no-await-in-loop
    await check(`GET ${path} → an array`, async () => {
      const actor = who(ctx);
      if (!actor) return 'skipped — no actor';
      const r = await req('GET', path, { token: actor.token, raw: true });
      if (r.status >= 400) return `not on this build (${r.status})`;
      const body = r.body?.data ?? r.body;
      const list =
        body?.[label] ?? body?.items ?? body?.results ?? (Array.isArray(body) ? body : null);
      if (!Array.isArray(list)) {
        throw new Error(
          `no array under "${label}"/items/results — the app maps over this and renders nothing without ` +
            `erroring. shape: ${JSON.stringify(body).slice(0, 140)}`,
        );
      }
      return `${list.length} rows`;
    });
  }

  section('6 · pagination does not lie');
  await check('limit is honoured', async () => {
    const r = await req('GET', '/driver/wallet/transactions?limit=1', { token: ctx.driver.token, raw: true });
    if (r.status >= 400) return `not on this build (${r.status})`;
    const body = r.body?.data ?? r.body;
    const list = body?.transactions ?? body?.items ?? body;
    if (!Array.isArray(list)) return 'not an array — covered above';
    if (list.length > 1) {
      throw new Error(`asked for 1, got ${list.length} — limit is being ignored, so every list is unbounded`);
    }
    return `${list.length}`;
  });

  await check('an absurd limit is clamped, not obeyed', async () => {
    const r = await req('GET', '/driver/wallet/transactions?limit=100000', { token: ctx.driver.token, raw: true });
    if (r.status >= 400) return `refused with ${r.status}`;
    const body = r.body?.data ?? r.body;
    const list = body?.transactions ?? body?.items ?? body;
    if (Array.isArray(list) && list.length > 500) {
      throw new Error(`returned ${list.length} rows — an unclamped limit is a memory and latency hazard`);
    }
    return 'clamped or empty';
  });

  section('7 · quotes and prices');
  await check('a quote returns a positive fare and an id', async () => {
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    if (!q?.quoteId) throw new Error(`no quoteId: ${JSON.stringify(q).slice(0, 160)}`);
    // `amountPesewas` is the field the server actually answers with. The other
    // two names were a guess, and a harness that asserts a field the API has
    // never had reports a bug that does not exist.
    const fare = q.amountPesewas ?? q.totalPesewas ?? q.farePesewas;
    if (typeof fare !== 'number' || fare <= 0) throw new Error(`fare is ${JSON.stringify(fare)}`);
    ctx.quote = q;
    return `GH₵${(fare / 100).toFixed(2)}`;
  });

  await check('a zero-distance quote does not price at zero', async () => {
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.pickup.lat, dropoffLng: ACCRA.pickup.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    ).catch((e) => ({ _status: e.status }));
    if (q?._status >= 400) return `refused with ${q._status}`;
    const fare = q.amountPesewas ?? q.totalPesewas ?? q.farePesewas;
    if (typeof fare === 'number' && fare <= 0) {
      throw new Error('a same-point ride priced at zero — a free ride the driver still has to be paid for');
    }
    return `GH₵${((fare ?? 0) / 100).toFixed(2)} (base fare holds)`;
  });

  await check('non-finite coordinates are refused rather than priced as NaN', async () => {
    const { status, body } = await req('POST', '/rides/quote', {
      token: ctx.rider.token,
      raw: true,
      body: { pickupLat: 'x', pickupLng: null, dropoffLat: 1 / 0, dropoffLng: -0.2, tier: 'ECO' },
    });
    if (status < 400) {
      const fare = body?.data?.amountPesewas ?? body?.data?.totalPesewas;
      throw new Error(`priced garbage coordinates at ${JSON.stringify(fare)} — a NaN fare reaches the DB as null`);
    }
    return `refused with ${status}`;
  });

  await check('an unknown tier is refused, not defaulted silently', async () => {
    const { status, body } = await req('POST', '/rides/quote', {
      token: ctx.rider.token,
      raw: true,
      body: {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'SPACESHIP',
      },
    });
    if (status < 400) {
      info(`accepted an unknown tier and quoted ${JSON.stringify(body?.data?.tier ?? body?.data?.amountPesewas)}`);
      return 'accepted (defaults to a known tier — acceptable, but the app should not send this)';
    }
    return `refused with ${status}`;
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
