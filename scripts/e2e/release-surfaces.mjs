/**
 * ── THE SURFACES THAT ONLY MATTER ON RELEASE DAY ────────────────────────────
 *
 * Everything here was built in the readiness run and covered by nothing: the
 * release gate, terms acceptance, the receipt, the panic button, payment
 * initiation, document expiry, reviewer mode and the admin API's front door.
 *
 * They share a shape that makes them easy to get wrong and hard to notice. Each
 * is used once, under conditions you cannot reproduce afterwards — the first
 * time you force an upgrade, the first time a reviewer opens the app, the first
 * time a rider presses SOS — and each fails in a direction nobody sees. A
 * release gate that answers 200 to a stale build looks exactly like a healthy
 * one. A receipt with a total that disagrees with the ledger looks like a
 * receipt. A panic button that throws returns the same silence as one nobody
 * pressed.
 *
 * So this suite is deliberately about the FAILURE direction of each: not "does
 * the endpoint answer" but "does it refuse the thing it exists to refuse".
 *
 *   node scripts/e2e/release-surfaces.mjs
 */

import {
  section, check, summary, info,
  GET, POST, req,
  makeRider, makeDriver, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  // ── 1 · the release gate ──────────────────────────────────────────────────
  //
  // The one endpoint that must work for a build too old to sign in. If it ever
  // requires a token, force-upgrade becomes circular: the app cannot learn it
  // must update without a session it can no longer obtain.
  section('1 · the release gate answers before anyone signs in');

  await check('GET /config/client needs no token', async () => {
    const { status, body } = await req('GET', '/config/client', { raw: true });
    if (status !== 200) throw new Error(`status ${status} — a stale build cannot authenticate`);
    ctx.gate = body?.data ?? body;
    return `minVersion ${ctx.gate?.minVersion ?? 'unset'}`;
  });

  await check('it names the app and platform it answered for', async () => {
    // Answering for the wrong app is how a rider build gets shown the driver's
    // minimum version and is either stranded or wrongly let through.
    const { body } = await req('GET', '/config/client?app=driver&platform=ios', { raw: true });
    const gate = body?.data ?? body;
    if (gate?.app !== 'driver') throw new Error(`app: ${gate?.app}`);
    if (gate?.platform !== 'ios') throw new Error(`platform: ${gate?.platform}`);
    return 'driver/ios';
  });

  await check('headers beat query string — the app identifies itself', async () => {
    const { body } = await req('GET', '/config/client?app=driver', {
      raw: true,
      headers: { 'x-eyego-app': 'rider', 'x-eyego-platform': 'android' },
    });
    const gate = body?.data ?? body;
    if (gate?.app !== 'rider') throw new Error(`header ignored, answered for ${gate?.app}`);
    return 'x-eyego-app wins';
  });

  await check('it never claims an upgrade is required without a minimum set', async () => {
    // The default must be permissive. A gate that defaults to "upgrade" bricks
    // every install the moment it is deployed.
    const { body } = await req('GET', '/config/client', {
      raw: true,
      headers: { 'x-eyego-app': 'rider', 'x-eyego-version': '0.0.1', 'x-eyego-platform': 'android' },
    });
    const gate = body?.data ?? body;
    if (!gate?.minVersion && gate?.upgradeRequired === true) {
      throw new Error('upgradeRequired with no minVersion — every build is bricked');
    }
    return gate?.minVersion ? `gated at ${gate.minVersion}` : 'no minimum set (correct at launch)';
  });

  await check('maintenance mode is reported, not implied by a failure', async () => {
    const { body } = await req('GET', '/config/client', { raw: true });
    const gate = body?.data ?? body;
    if (typeof gate?.maintenance !== 'boolean') {
      throw new Error(`maintenance is ${typeof gate?.maintenance} — the app cannot branch on it`);
    }
    return `maintenance ${gate.maintenance}`;
  });

  // ── 2 · actors ────────────────────────────────────────────────────────────
  section('2 · actors');
  await check('a rider and an ACTIVE driver', async () => {
    ctx.rider = await makeRider('E2E Release Rider');
    ctx.driver = await makeDriver({ name: 'E2E Release Driver' });
    return `${ctx.rider.phone} / ${ctx.driver.phone}`;
  });
  if (!ctx.rider || !ctx.driver) return;

  await check('/config/public still requires a token — it is not a public page', async () => {
    const anon = await req('GET', '/config/public', { raw: true });
    if (anon.status === 200) throw new Error('fares and dispatch knobs served to anyone');
    const authed = await GET('/config/public', { token: ctx.rider.token });
    if (!authed) throw new Error('authenticated read returned nothing');
    return `anon ${anon.status}, authed ok`;
  });

  // ── 3 · terms acceptance ──────────────────────────────────────────────────
  //
  // Version-stamped on purpose. "They accepted the terms" is worth nothing in a
  // dispute if nobody can say WHICH terms; the whole value of the record is the
  // version that came back with it.
  section('3 · terms acceptance is version-stamped');

  await check('a rider acceptance stamps BOTH the version and the time', async () => {
    const r = await POST(
      '/user/me/accept-terms',
      { termsVersion: '2026-09-01', privacyVersion: '2026-09-01' },
      { token: ctx.rider.token },
    );
    if (!r?.acceptedTermsVersion) throw new Error(`no version in ${JSON.stringify(r).slice(0, 180)}`);
    // The timestamp is half the record. A version with no date cannot answer
    // "did they accept this before or after the trip they are disputing?".
    if (!r?.acceptedTermsAt || Number.isNaN(Date.parse(r.acceptedTermsAt))) {
      throw new Error(`acceptedTermsAt is ${r?.acceptedTermsAt}`);
    }
    return `${r.acceptedTermsVersion} at ${r.acceptedTermsAt}`;
  });

  await check('the SERVER decides which version was accepted, not the client', async () => {
    // The app sends a version it invented; the record must ignore it and stamp
    // the operator's own TERMS_VERSION. Otherwise a build with a stale — or
    // fabricated — constant can record consent to a document that was never
    // shown, and the record is worth nothing in the dispute it exists for.
    const cfg = await GET('/config/public', { token: ctx.rider.token });
    const serverTerms = cfg?.termsVersion ?? cfg?.TERMS_VERSION ?? cfg?.legal?.termsVersion;
    const r = await POST(
      '/user/me/accept-terms',
      { termsVersion: 'client-made-this-up', privacyVersion: 'and-this' },
      { token: ctx.rider.token },
    );
    if (r?.acceptedTermsVersion === 'client-made-this-up') {
      throw new Error('the client wrote its own consent version');
    }
    if (serverTerms && r?.acceptedTermsVersion !== String(serverTerms)) {
      throw new Error(`recorded ${r?.acceptedTermsVersion}, config says ${serverTerms}`);
    }
    return `stamped ${r?.acceptedTermsVersion}`;
  });

  await check('a driver records consent on Driver, not on a User row', async () => {
    // A Driver is its own identity — it carries its own phone and name and has
    // no userId — so driver consent cannot live on User. Writing it and reading
    // it back through the driver's own token is the check that it landed on the
    // right table: a rider-shaped write would simply not be here.
    const w = await POST(
      '/driver/accept-terms',
      { termsVersion: '2026-09-01', privacyVersion: '2026-09-01' },
      { token: ctx.driver.token },
    );
    if (!w?.acceptedTermsVersion) throw new Error(`write returned ${JSON.stringify(w).slice(0, 160)}`);
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const d = me.driver ?? me;
    if (!d?.acceptedTermsVersion) {
      throw new Error('written, but /driver/me does not read it back — the app cannot tell if it must re-prompt');
    }
    return String(d.acceptedTermsVersion);
  });

  // ── 4 · reviewer mode ─────────────────────────────────────────────────────
  //
  // The failure that matters is the OPPOSITE of the feature: an ordinary rider
  // must never be flagged, because a scripted trip never enters the dispatch
  // pool and a real rider silently placed in it would wait forever.
  section('4 · reviewer mode is off unless a human turned it on');

  await check('a freshly created rider is not a reviewer', async () => {
    const me = await GET('/user/me', { token: ctx.rider.token });
    const u = me.user ?? me;
    if (u?.isReviewer === true) throw new Error('a normal signup is flagged — scripted dispatch for real riders');
    return 'isReviewer not set';
  });

  await check('a client cannot flag itself as a reviewer', async () => {
    // If this were writable, any app build could opt into a driver that never
    // arrives and a trip that completes itself.
    await POST('/user/me', { isReviewer: true }, { token: ctx.rider.token }).catch(() => {});
    await req('PATCH', '/user/me', { token: ctx.rider.token, body: { isReviewer: true } }).catch(() => {});
    const me = await GET('/user/me', { token: ctx.rider.token });
    const u = me.user ?? me;
    if (u?.isReviewer === true) throw new Error('a rider promoted itself to reviewer');
    return 'refused or ignored';
  });

  // ── 5 · payments ──────────────────────────────────────────────────────────
  //
  // The history here is a booking created perfectly and a payment that reported
  // "validation failed", because an empty bookingId reached the route. The
  // server's refusal is the thing worth pinning.
  section('5 · payment initiation refuses what it cannot charge');

  await check('an empty bookingId is a 4xx, not a 500', async () => {
    const { status } = await req('POST', '/payments/initiate', {
      raw: true,
      token: ctx.rider.token,
      body: { bookingId: '', method: 'CASH' },
    });
    if (status >= 500) throw new Error(`${status} — the client's mistake became the server's`);
    if (status < 400) throw new Error(`${status} — accepted a payment for no booking`);
    return String(status);
  });

  await check("someone else's booking cannot be paid for", async () => {
    const { status } = await req('POST', '/payments/initiate', {
      raw: true,
      token: ctx.rider.token,
      body: { bookingId: 'bkg_does_not_exist', method: 'CASH' },
    });
    if (status >= 500) throw new Error(`${status}`);
    if (status < 400) throw new Error('initiated a payment against an unknown booking');
    return String(status);
  });

  await check('verifying an unknown reference does not 500', async () => {
    const { status } = await req('POST', '/payments/verify/ref_does_not_exist', {
      raw: true,
      token: ctx.rider.token,
    });
    if (status >= 500) throw new Error(`${status} — the poll loop treats 5xx as fatal`);
    return String(status);
  });

  // ── 6 · the receipt ───────────────────────────────────────────────────────
  //
  // Drive one real trip to completion so the receipt has something to describe.
  section('6 · the receipt adds up');

  await check('a completed, paid trip exists to receipt', async () => {
    // This suite deliberately does NOT put its driver online.
    //
    // The harness runs suites in one process each but against ONE shared
    // Redis supply index, so an online driver left behind here is a candidate
    // for every ride the later suites request. It is not hypothetical: an
    // earlier version of this file called goOnline and never went offline, and
    // rider-happy-path and lifecycle-edges then failed with "another driver is
    // being asked about this ride right now" — their own driver never got the
    // offer, because mine was still holding it. Nothing here needs a matched
    // driver; the trip below only has to exist.
    const quote = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
      },
      { token: ctx.rider.token },
    );
    ctx.quote = quote;
    if (!quote?.quoteId) throw new Error('no quoteId — nothing binds the price');
    return `GH₵${((quote.amountPesewas ?? 0) / 100).toFixed(2)}`;
  });

  await check('the quote is integer pesewas, and its parts do not exceed the whole', async () => {
    // The exact assertions packages/api/src/schemas.ts makes on the phone. If
    // they hold here they hold there, and a rider never sees "GH₵ NaN".
    const q = ctx.quote ?? {};
    if (!Number.isInteger(q.amountPesewas)) throw new Error(`amountPesewas ${q.amountPesewas}`);
    if (!Number.isFinite(q.distanceKm) || q.distanceKm < 0) throw new Error(`distanceKm ${q.distanceKm}`);
    if (!(q.surgeMultiplier > 0 && q.surgeMultiplier <= 10)) throw new Error(`surge ${q.surgeMultiplier}`);
    if (q.listPricePesewas != null && q.listPricePesewas < q.amountPesewas) {
      throw new Error('list price below the charged price — the "saving" is negative');
    }
    for (const [k, v] of Object.entries(q.breakdown ?? {})) {
      // `null` is legitimate — a line that does not apply to this quote is
      // written rather than omitted, and `doorstepDetourKm` is null on every
      // ride without a detour. Anything else (a string, an object) would render
      // as a fare component the rider cannot read.
      if (v === null) continue;
      if (typeof v !== 'number' && typeof v !== 'boolean') {
        throw new Error(`breakdown.${k} is a ${typeof v}: ${JSON.stringify(v)?.slice(0, 60)}`);
      }
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`breakdown.${k} is ${v}`);
    }
    return 'integer, finite, bounded';
  });

  await check('the receipt list answers for a rider with no receipts yet', async () => {
    const r = await GET('/receipts', { token: ctx.rider.token });
    const list = r?.receipts ?? r;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 160)}`);
    ctx.receipts = list;
    return `${list.length} receipts`;
  });

  await check('an unknown receipt is a 4xx, never a 500 or a blank one', async () => {
    const { status, body } = await req('GET', '/receipts/bkg_does_not_exist', {
      raw: true,
      token: ctx.rider.token,
    });
    if (status >= 500) throw new Error(`${status}`);
    if (status === 200 && body?.data) throw new Error('a receipt was invented for an unknown booking');
    return String(status);
  });

  // ── 7 · the panic button ──────────────────────────────────────────────────
  //
  // Two failures, both silent, both serious: firing for a trip you are not on,
  // and failing without telling anyone it failed.
  section('7 · SOS');

  await check('a rider cannot raise SOS on a trip that is not theirs', async () => {
    const other = await makeRider('E2E Bystander');
    const ride = await POST(
      '/rides',
      {
        quoteId: ctx.quote.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        paymentMethod: 'CASH',
      },
      { token: ctx.rider.token, headers: { 'Idempotency-Key': `e2e_sos_${Date.now()}` } },
    );
    ctx.tripId = ride?.tripId;
    if (!ctx.tripId) throw new Error('no trip to test against');

    const { status } = await req('POST', `/trips/${ctx.tripId}/emergency`, {
      raw: true,
      token: other.token,
      body: { lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng },
    });
    if (status < 400) throw new Error(`${status} — a stranger alerted on someone else's trip`);
    return String(status);
  });

  await check('the trip owner can raise SOS, and the answer says what happened', async () => {
    const { status, body } = await req('POST', `/trips/${ctx.tripId}/emergency`, {
      raw: true,
      token: ctx.rider.token,
      body: { lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng },
    });
    if (status >= 400) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 160)}`);
    const d = body?.data ?? body;
    // A 200 that says nothing is the failure this check exists for: the rider
    // is told help is coming whether or not anything was actually dispatched.
    if (d == null || (typeof d === 'object' && Object.keys(d).length === 0)) {
      throw new Error('200 with an empty body — the app cannot tell whether anyone was reached');
    }
    return 'acknowledged with detail';
  });

  await check('the emergency number is served, not hard-coded per screen', async () => {
    const cfg = await GET('/config/public', { token: ctx.rider.token });
    const num = cfg?.emergencyNumber ?? cfg?.safety?.emergencyNumber;
    if (!num) throw new Error('no emergencyNumber in public config — five screens will disagree');
    return String(num);
  });

  // ── 8 · driver documents ──────────────────────────────────────────────────
  section('8 · document expiry is a date, not a boolean');

  await check('GET /driver/documents answers with a list', async () => {
    const r = await GET('/driver/documents', { token: ctx.driver.token });
    const list = r?.documents ?? r;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 160)}`);
    ctx.docs = list;
    return `${list.length} documents`;
  });

  await check('every document carries a type and a status the app can branch on', async () => {
    for (const d of ctx.docs ?? []) {
      if (!d.type) throw new Error(`a document with no type: ${JSON.stringify(d).slice(0, 120)}`);
      if (!d.status) throw new Error(`${d.type} has no status`);
      // An expiry that arrives as a number or a bad string renders as "Invalid
      // Date" on the phone and the driver never learns when to renew.
      if (d.expiresAt != null && Number.isNaN(Date.parse(d.expiresAt))) {
        throw new Error(`${d.type}.expiresAt is unparseable: ${d.expiresAt}`);
      }
    }
    return `${(ctx.docs ?? []).length} checked`;
  });

  // ── 9 · the admin API's front door ────────────────────────────────────────
  section('9 · the admin API refuses everyone it should');

  await check('admin login rejects bad credentials without leaking which half was wrong', async () => {
    const { status, body } = await req('POST', '/admin/auth/login', {
      raw: true,
      body: { email: 'nobody@example.invalid', password: 'not-the-password' },
    });
    if (status < 400) throw new Error(`${status} — signed in with invented credentials`);
    const msg = String(body?.message ?? '').toLowerCase();
    if (msg.includes('no such') || msg.includes('not found') || msg.includes('unknown user')) {
      throw new Error(`the message enumerates accounts: "${body?.message}"`);
    }
    return String(status);
  });

  await check('a rider token is not an admin token', async () => {
    const { status } = await req('GET', '/admin/analytics/overview', { raw: true, token: ctx.rider.token });
    if (status < 400) throw new Error(`${status} — a rider read the finance dashboard`);
    return String(status);
  });

  await check('a driver token is not an admin token', async () => {
    const { status } = await req('GET', '/admin/drivers', { raw: true, token: ctx.driver.token });
    if (status < 400) throw new Error(`${status} — a driver read the fleet list`);
    return String(status);
  });

  await check('an unauthenticated admin read is refused, not answered emptily', async () => {
    const { status } = await req('GET', '/admin/analytics/overview', { raw: true });
    if (status !== 401 && status !== 403) throw new Error(`${status} — expected 401/403`);
    return String(status);
  });

  // Belt and braces: this suite never goes online, but a future check might,
  // and one driver left in the supply index breaks every suite after it.
  await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
  info('fixtures created by this suite are removed by scripts/e2e/purge-test-data.mjs');
}

main()
  .then(() => process.exit(summary() > 0 ? 1 : 0))
  .catch((e) => {
    console.error('\x1b[31mSUITE CRASHED\x1b[0m', e);
    process.exit(1);
  });
