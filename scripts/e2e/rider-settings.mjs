/**
 * Everything the rider can touch that is NOT the booking flow.
 *
 * rider-happy-path covers quote→book→dispatch→complete and rider-edges covers
 * cancellation, chat, SOS and disputes. This file covers the rest of the app:
 * every screen under profile/, every toggle in settings, saved places, the
 * wallet, promos, and the trip-adjacent reads (contact, receipt, public
 * tracking) that only exist once a real trip does.
 *
 * The bias here is "does the setting survive a round trip". A settings screen
 * that renders a switch, PATCHes it, and shows it back from local state looks
 * identical to one that persists — until the user reinstalls. So every toggle
 * is written, re-read from a FRESH GET, and compared.
 *
 *   node scripts/e2e/rider-settings.mjs
 */

import {
  BASE, section, check, info, summary,
  GET, POST, PATCH, PUT, DEL, req,
  makeRider, makeDriver, goOnline, until, ACCRA,
} from './lib.mjs';

const ctx = {};

/** A request we EXPECT to be refused. Asserts it fails cleanly, not with a 500. */
async function refused(method, path, { token, body, allow = [400, 401, 402, 403, 404, 409, 422] } = {}) {
  const { status, body: resBody } = await req(method, path, { token, body, raw: true });
  if (status >= 500) throw new Error(`${method} ${path} → ${status} (a 5xx, not a refusal): ${JSON.stringify(resBody).slice(0, 200)}`);
  if (status < 400) throw new Error(`${method} ${path} → ${status}, but this should have been refused`);
  if (!allow.includes(status)) throw new Error(`${method} ${path} → ${status}, expected one of ${allow.join('/')}`);
  return `${status} ${resBody?.message || resBody?.error?.code || ''}`.trim();
}

async function main() {
  section('0 · rider');
  await check('rider signs up', async () => {
    ctx.rider = await makeRider('Settings Rider');
    return ctx.rider.phone;
  });
  if (!ctx.rider) return;
  const T = { token: ctx.rider.token };

  // ── profile ───────────────────────────────────────────────────────────────
  section('1 · profile · edit');

  // Email is unique per account, so it must be unique per RUN too.
  ctx.email = `ama.e2e.${Date.now()}@example.com`;

  await check('PATCH /user/me persists name and email to a fresh GET', async () => {
    await PATCH('/user/me', { name: 'Ama Mensah', email: ctx.email }, T);
    const me = await GET('/user/me', T);
    const u = me.user ?? me;
    if (u.name !== 'Ama Mensah') throw new Error(`name came back ${JSON.stringify(u.name)}`);
    if (u.email !== ctx.email) throw new Error(`email came back ${JSON.stringify(u.email)}`);
    return '';
  });

  await check('an email already on another account is refused BY NAME, not "try again"', async () => {
    const other = await makeRider('Email Twin');
    const { status, body } = await req('PATCH', '/user/me', { token: other.token, raw: true, body: { email: ctx.email } });
    if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 160)}`);
    if (status !== 409) throw new Error(`expected 409, got ${status}`);
    const msg = body?.message || '';
    if (/try again/i.test(msg) || !/email/i.test(msg)) {
      throw new Error(`a permanent condition was reported as retryable: ${JSON.stringify(msg)}`);
    }
    return msg;
  });

  await check('preferredTier persists (it is what pre-selects the tier card)', async () => {
    await PATCH('/user/me', { preferredTier: 'COMFORT' }, T);
    const u = (await GET('/user/me', T)).user ?? (await GET('/user/me', T));
    if (u.preferredTier !== 'COMFORT') throw new Error(`preferredTier=${JSON.stringify(u.preferredTier)}`);
    await PATCH('/user/me', { preferredTier: 'ECO' }, T);
    return '';
  });

  await check('a malformed email is refused, not stored', async () => {
    const detail = await refused('PATCH', '/user/me', { ...T, body: { email: 'not-an-email' } });
    const u = (await GET('/user/me', T)).user ?? {};
    if (u.email === 'not-an-email') throw new Error('the bad email was stored anyway');
    return detail;
  });

  await check('an unknown tier is refused', () => refused('PATCH', '/user/me', { ...T, body: { preferredTier: 'LUXURY' } }));

  section('2 · profile · business mode');

  await check('business profile round-trips (company, tax id, expense email)', async () => {
    await PATCH('/user/me', {
      businessMode: true,
      businessCompanyName: 'Mensah Logistics',
      businessTaxId: 'C00123456X',
      businessExpenseEmail: 'expenses@mensah.example',
    }, T);
    const u = (await GET('/user/me', T)).user ?? {};
    const wrong = [];
    if (u.businessMode !== true) wrong.push(`businessMode=${u.businessMode}`);
    if (u.businessCompanyName !== 'Mensah Logistics') wrong.push(`company=${JSON.stringify(u.businessCompanyName)}`);
    if (u.businessTaxId !== 'C00123456X') wrong.push(`taxId=${JSON.stringify(u.businessTaxId)}`);
    if (u.businessExpenseEmail !== 'expenses@mensah.example') wrong.push(`expenseEmail=${JSON.stringify(u.businessExpenseEmail)}`);
    if (wrong.length) throw new Error(wrong.join('; '));
    return '';
  });

  await check('a malformed expense email is refused', () =>
    refused('PATCH', '/user/me', { ...T, body: { businessExpenseEmail: 'nope' } }));

  await check('business mode switches back off', async () => {
    await PATCH('/user/me', { businessMode: false }, T);
    const u = (await GET('/user/me', T)).user ?? {};
    if (u.businessMode !== false) throw new Error(`businessMode=${u.businessMode}`);
    return '';
  });

  section('3 · profile · avatar');

  await check('POST /user/avatar accepts a real image and the URL survives a GET', async () => {
    // Smallest valid PNG: 1x1, transparent. Multer + sharp both accept it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png');
    const res = await fetch(`${BASE}/v1/user/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.rider.token}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    const url = json?.data?.avatarUrl ?? json?.data?.url ?? json?.data?.avatar;
    if (!url) throw new Error(`upload succeeded but returned no URL: ${JSON.stringify(json).slice(0, 200)}`);
    const u = (await GET('/user/me', T)).user ?? {};
    if (!u.avatarUrl && !u.avatar) throw new Error('avatar uploaded but /user/me still has no avatar — it was not persisted');
    return String(url).slice(0, 60);
  });

  await check('a non-image upload is refused, not stored', async () => {
    const form = new FormData();
    form.append('avatar', new Blob([Buffer.from('#!/bin/sh\nrm -rf /')], { type: 'text/plain' }), 'evil.sh');
    const res = await fetch(`${BASE}/v1/user/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.rider.token}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (res.status >= 500) throw new Error(`${res.status} — a 5xx, not a refusal`);
    if (res.ok) throw new Error('a shell script was accepted as an avatar');
    return String(res.status);
  });

  section('4 · profile · push token');

  await check('POST /user/fcm-token is accepted', async () => {
    await POST('/user/fcm-token', { fcmToken: `e2e-token-${Date.now()}` }, T);
    return '';
  });

  await check('an empty fcm token is refused', () => refused('POST', '/user/fcm-token', { ...T, body: { fcmToken: '' } }));

  // ── saved places ──────────────────────────────────────────────────────────
  section('5 · saved places');

  await check('POST /user/me/saved-places creates Home', async () => {
    const r = await POST('/user/me/saved-places', {
      label: 'Home', address: 'Osu, Accra', lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng,
    }, T);
    const place = r.place ?? r;
    if (!place?.id) throw new Error(`no id back: ${JSON.stringify(r).slice(0, 160)}`);
    ctx.homeId = place.id;
    return `id=${place.id.slice(0, 8)}`;
  });

  await check('GET /user/me/saved-places lists it', async () => {
    const r = await GET('/user/me/saved-places', T);
    const places = r.places ?? r.savedPlaces ?? r;
    if (!Array.isArray(places)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 160)}`);
    if (!places.some((p) => p.label === 'Home')) throw new Error('Home is not in the list');
    return `${places.length} place(s)`;
  });

  await check('saving Home twice replaces the slot rather than duplicating it', async () => {
    await POST('/user/me/saved-places', {
      label: 'Home', address: 'Cantonments, Accra', lat: 5.585, lng: -0.175,
    }, T);
    const r = await GET('/user/me/saved-places', T);
    const places = r.places ?? r.savedPlaces ?? r;
    const homes = places.filter((p) => p.label === 'Home');
    if (homes.length !== 1) {
      throw new Error(`${homes.length} rows labelled Home — Home is a SLOT, so the second save must overwrite the first`);
    }
    if (homes[0].address !== 'Cantonments, Accra') throw new Error(`slot kept the old address: ${homes[0].address}`);
    ctx.homeId = homes[0].id;
    return '';
  });

  await check('a custom label coexists with Home', async () => {
    const r = await POST('/user/me/saved-places', {
      label: 'Gym', address: 'Airport Residential', lat: 5.6, lng: -0.18, icon: 'dumbbell',
    }, T);
    ctx.gymId = (r.place ?? r)?.id;
    const list = await GET('/user/me/saved-places', T);
    const places = list.places ?? list.savedPlaces ?? list;
    if (places.length < 2) throw new Error(`expected Home + Gym, got ${places.length}`);
    return '';
  });

  await check('a place with a non-numeric lat is refused', () =>
    refused('POST', '/user/me/saved-places', { ...T, body: { label: 'Bad', address: 'x', lat: 'north', lng: -0.18 } }));

  await check('DELETE removes the place', async () => {
    await DEL(`/user/me/saved-places/${ctx.gymId}`, T);
    const list = await GET('/user/me/saved-places', T);
    const places = list.places ?? list.savedPlaces ?? list;
    if (places.some((p) => p.id === ctx.gymId)) throw new Error('still listed after DELETE');
    return '';
  });

  await check('deleting an unknown place 404s rather than 500s', () =>
    refused('DELETE', '/user/me/saved-places/clzzzzzzzzzzzzzzzzzzzzzzz', T));

  await check("another rider cannot delete this rider's saved place", async () => {
    const other = await makeRider('Nosy Rider');
    return refused('DELETE', `/user/me/saved-places/${ctx.homeId}`, { token: other.token });
  });

  // ── notification preferences ──────────────────────────────────────────────
  section('6 · settings · notifications');

  // NOTE ON DEFAULTS. A new account's blob is `{}` and stays that way until the
  // rider touches a switch. That is deliberate and it is consistent: the screen
  // merges over its own DEFAULT_PREFS, and push.service's `prefAllows` treats a
  // missing key as ALLOWED. Both ends therefore read an untouched account as
  // "everything on". What must hold is that an explicit choice survives, and
  // that setting one switch does not silently reset the rest.
  const NOTIF_KEYS = ['driverArriving', 'tripStarted', 'tripCompleted', 'chatMessages', 'paymentConfirmations', 'promotions', 'newFeatures', 'safetyAlerts'];

  await check('GET /user/me/notifications answers with a blob', async () => {
    const r = await GET('/user/me/notifications', T);
    const prefs = r.prefs ?? r.preferences ?? r;
    if (prefs == null || typeof prefs !== 'object') throw new Error(`got ${JSON.stringify(r).slice(0, 160)}`);
    return Object.keys(prefs).length ? Object.keys(prefs).join(',') : '(empty — client defaults apply)';
  });

  await check('every switch the screen renders is accepted by the server', async () => {
    const off = Object.fromEntries(NOTIF_KEYS.map((k) => [k, false]));
    await PATCH('/user/me/notifications', off, T);
    const r = await GET('/user/me/notifications', T);
    const prefs = r.prefs ?? r.preferences ?? r;
    const dropped = NOTIF_KEYS.filter((k) => prefs[k] !== false);
    if (dropped.length) throw new Error(`the screen can toggle these but the server did not store them: ${dropped.join(', ')}`);
    return `${NOTIF_KEYS.length} switches`;
  });

  await check('toggling one back on does not reset the others', async () => {
    await PATCH('/user/me/notifications', { safetyAlerts: true }, T);
    const r = await GET('/user/me/notifications', T);
    const prefs = r.prefs ?? r.preferences ?? r;
    if (prefs.safetyAlerts !== true) throw new Error('safetyAlerts did not turn on');
    if (prefs.promotions !== false) throw new Error('a PATCH of one field reset the others — this is a PUT pretending to be a PATCH');
    return '';
  });

  await check('a non-boolean switch value is refused', () =>
    refused('PATCH', '/user/me/notifications', { ...T, body: { promotions: 'yes' } }));

  section('7 · settings · app preferences');

  await check('GET /user/me/preferences answers', async () => {
    const r = await GET('/user/me/preferences', T);
    ctx.prefs = r.preferences ?? r;
    if (ctx.prefs == null) throw new Error('null preferences');
    return Object.keys(ctx.prefs).join(',') || '(empty)';
  });

  await check('PATCH /user/me/preferences round-trips a value', async () => {
    await PATCH('/user/me/preferences', { theme: 'dark', language: 'en' }, T);
    const r = await GET('/user/me/preferences', T);
    const prefs = r.preferences ?? r;
    if (prefs.theme !== 'dark') throw new Error(`theme came back ${JSON.stringify(prefs.theme)} — the settings screen would forget the user's theme on reinstall`);
    return '';
  });

  // ── safety & privacy ──────────────────────────────────────────────────────
  section('8 · settings · safety');

  await check('GET /user/me/safety-settings answers with a blob', async () => {
    const r = await GET('/user/me/safety-settings', T);
    const s = r.settings ?? r.safetySettings ?? r;
    if (s == null || typeof s !== 'object') throw new Error(`got ${JSON.stringify(r).slice(0, 160)}`);
    // Like notifications, an untouched account is `{}` and safety.tsx merges
    // over its own DEFAULTS. What matters is that a written value comes back.
    return Object.keys(s).length ? Object.keys(s).join(',') : '(empty — client defaults apply)';
  });

  await check('every safety switch the screen renders is accepted and persists', async () => {
    await PUT('/user/me/safety-settings', { shareTrip: true, rideCheck: false, speedAlerts: true, nightSafety: true }, T);
    const r = await GET('/user/me/safety-settings', T);
    const s = r.settings ?? r.safetySettings ?? r;
    if (s.shareTrip !== true || s.rideCheck !== false || s.speedAlerts !== true || s.nightSafety !== true) {
      throw new Error(`came back ${JSON.stringify({ shareTrip: s.shareTrip, rideCheck: s.rideCheck, speedAlerts: s.speedAlerts, nightSafety: s.nightSafety })}`);
    }
    return '';
  });

  await check('a non-boolean safety value is refused', () =>
    refused('PUT', '/user/me/safety-settings', { ...T, body: { shareTrip: 'on' } }));

  section('9 · settings · privacy');

  // The three keys privacy.tsx actually sends (setToggle at lines 188/199/210).
  const PRIVACY_KEYS = ['locationSharing', 'marketingNotifs', 'analytics'];

  await check('every privacy switch the screen renders round-trips', async () => {
    await PUT('/user/me/privacy-settings', { locationSharing: false, marketingNotifs: true, analytics: false }, T);
    const after = await GET('/user/me/privacy-settings', T);
    const q = after.settings ?? after.privacySettings ?? after;
    const expected = { locationSharing: false, marketingNotifs: true, analytics: false };
    const stuck = PRIVACY_KEYS.filter((k) => q[k] !== expected[k]);
    if (stuck.length) throw new Error(`the screen can toggle these but they did not persist: ${stuck.join(', ')}`);
    return PRIVACY_KEYS.join(',');
  });

  await check('a privacy PUT of one field leaves the others alone', async () => {
    await PUT('/user/me/privacy-settings', { analytics: true }, T);
    const after = await GET('/user/me/privacy-settings', T);
    const q = after.settings ?? after.privacySettings ?? after;
    if (q.analytics !== true) throw new Error('analytics did not turn on');
    if (q.marketingNotifs !== true) throw new Error('writing one field wiped the others — privacy.tsx sends single-key patches');
    return '';
  });

  section('10 · settings · emergency contacts');

  await check('PUT /user/me/emergency-contacts stores and returns them', async () => {
    await PUT('/user/me/emergency-contacts', {
      contacts: [
        { name: 'Kwame', phone: '233201112222' },
        { name: 'Akosua', phone: '233203334444' },
      ],
    }, T);
    const r = await GET('/user/me/emergency-contacts', T);
    const list = r.contacts ?? r;
    if (!Array.isArray(list) || list.length !== 2) throw new Error(`got ${JSON.stringify(r).slice(0, 200)}`);
    if (!list.some((c) => c.name === 'Kwame')) throw new Error('Kwame is missing');
    return `${list.length} contact(s)`;
  });

  await check('a fourth contact is refused (the cap is 3)', () =>
    refused('PUT', '/user/me/emergency-contacts', {
      ...T,
      body: { contacts: [1, 2, 3, 4].map((n) => ({ name: `C${n}`, phone: `23320000000${n}` })) },
    }));

  await check('a contact with no phone is refused', () =>
    refused('PUT', '/user/me/emergency-contacts', { ...T, body: { contacts: [{ name: 'Nameless', phone: '' }] } }));

  await check('syncing an empty list clears them', async () => {
    await PUT('/user/me/emergency-contacts', { contacts: [] }, T);
    const r = await GET('/user/me/emergency-contacts', T);
    const list = r.contacts ?? r;
    if (list.length !== 0) throw new Error(`${list.length} contact(s) survived the clear`);
    // Put them back — the SOS section below needs one.
    await PUT('/user/me/emergency-contacts', { contacts: [{ name: 'Kwame', phone: '233201112222' }] }, T);
    return '';
  });

  section('11 · account checklist');

  await check('the checklist reflects what we actually filled in', async () => {
    const r = await GET('/user/me/account-checklist', T);
    const c = r.checklist ?? r;
    const items = Array.isArray(c) ? c : c.items;
    if (!Array.isArray(items)) throw new Error(`no items array: ${JSON.stringify(c).slice(0, 200)}`);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    // We set all three above. If the checklist still calls them outstanding it
    // is reading different columns from the ones the profile screens write.
    for (const id of ['name', 'email', 'emergency_contact']) {
      if (!byId[id]) throw new Error(`the checklist has no "${id}" item`);
      if (byId[id].done !== true) throw new Error(`"${id}" reads incomplete, but we set it earlier in this run`);
    }
    if (typeof c.completeness === 'number' && c.completeness <= 0) throw new Error(`completeness is ${c.completeness}`);
    return `${items.filter((i) => i.done).length}/${items.length} done, ${c.completeness ?? '?'}%`;
  });

  // ── wallet & money ────────────────────────────────────────────────────────
  section('12 · wallet');

  // /v1/wallet is the RIDER wallet (rider.wallet.routes.js). The driver wallet
  // is a different router mounted at /v1/driver/wallet — that is the one with a
  // root GET. There is deliberately no GET /v1/wallet.
  await check('GET /wallet/balance returns integer pesewas and a currency', async () => {
    const b = await GET('/wallet/balance', T);
    const bal = b.balancePesewas ?? b.balance;
    if (!Number.isInteger(bal)) throw new Error(`balance is ${JSON.stringify(bal)} — money must be integer pesewas`);
    if (b.currency && b.currency !== 'GHS') throw new Error(`currency is ${b.currency}`);
    ctx.balance = bal;
    return `${bal} pesewas ${b.currency ?? ''}`.trim();
  });

  await check("the driver wallet root is not reachable with a rider's token", () =>
    refused('GET', '/driver/wallet', T));

  await check('GET /wallet/transactions returns a list, not an object of one', async () => {
    const t = await GET('/wallet/transactions', T);
    const list = t.transactions ?? t.items ?? t;
    if (!Array.isArray(list)) throw new Error(`not a list: ${JSON.stringify(t).slice(0, 200)}`);
    for (const row of list) {
      const amt = row.amountPesewas ?? row.amount;
      if (amt != null && !Number.isInteger(amt)) throw new Error(`transaction ${row.id} has fractional money: ${amt}`);
    }
    return `${list.length} row(s)`;
  });

  await check('GET /user/me/wallet (the profile header) answers with balance + promos', async () => {
    const r = await GET('/user/me/wallet', T);
    if (r == null) throw new Error('null');
    const bal = r.walletBalancePesewas ?? r.balancePesewas ?? r.wallet?.balancePesewas;
    if (!Number.isInteger(bal)) throw new Error(`no integer balance in ${JSON.stringify(r).slice(0, 200)}`);
    if (bal !== ctx.balance) throw new Error(`the profile header says ${bal} but /wallet/balance says ${ctx.balance}`);
    if (!Array.isArray(r.promos)) throw new Error('no promos array — the header renders a promo count');
    return `balance=${bal} promos=${r.promos.length}`;
  });

  await check('a top-up below the GH₵1 floor is refused', () =>
    refused('POST', '/wallet/topup', { ...T, body: { amountPesewas: 50 } }));

  await check('a top-up in cedis-shaped floats is refused (the unit is pesewas)', () =>
    refused('POST', '/wallet/topup', { ...T, body: { amountPesewas: 10.5 } }));

  await check('a real top-up reaches the gateway rather than 500ing', async () => {
    const { status, body } = await req('POST', '/wallet/topup', {
      ...T, raw: true, body: { amountPesewas: 500, method: 'MOMO_MTN' },
    });
    if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 200)}`);
    return `${status} ${body?.message || body?.error?.code || 'ok'}`.slice(0, 80);
  });

  await check('withdraw is a driver route — a rider token is refused, not served', () =>
    refused('POST', '/wallet/withdraw', { ...T, body: { amountPesewas: 100 } }));

  section('13 · wallet · send money');

  await check('sending to yourself is refused', () =>
    refused('POST', '/wallet/send', { ...T, body: { phone: ctx.rider.phone, amountPesewas: 100 } }));

  await check('sending more than the balance is refused, not 500', () =>
    refused('POST', '/wallet/send', { ...T, body: { phone: '233209998888', amountPesewas: 99_999_999 } }));

  await check('sending a fractional amount is refused', () =>
    refused('POST', '/wallet/send', { ...T, body: { phone: '233209998888', amountPesewas: 12.34 } }));

  section('14 · payment methods');

  await check('GET /wallet/payment-methods returns a list', async () => {
    const r = await GET('/wallet/payment-methods', T);
    const list = r.methods ?? r.paymentMethods ?? r;
    if (!Array.isArray(list)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 200)}`);
    return `${list.length} method(s)`;
  });

  await check('deleting an unknown payment method 404s rather than 500s', () =>
    refused('DELETE', '/wallet/payment-methods/clzzzzzzzzzzzzzzzzzzzzzzz', T));

  await check('card-save initialisation reaches the gateway rather than 500ing', async () => {
    const { status, body } = await req('POST', '/wallet/payment-methods/initialize', { ...T, raw: true, body: {} });
    if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 200)}`);
    return `${status} ${body?.message || 'ok'}`.slice(0, 80);
  });

  // ── promotions ────────────────────────────────────────────────────────────
  section('15 · promotions');

  await check('GET /user/me/promotions returns the three buckets the screen renders', async () => {
    const r = await GET('/user/me/promotions', T);
    const flat = JSON.stringify(r);
    if (r == null) throw new Error('null');
    if (!/applied|available|used/i.test(flat)) {
      throw new Error(`the promotions screen renders applied/available/used but the server sent ${flat.slice(0, 200)}`);
    }
    return Object.keys(r).join(',');
  });

  await check('an unknown promo code answers valid:false, it does not error', async () => {
    const r = await GET('/bookings/promos/validate?code=DEFINITELYNOTAREALCODE', T);
    if (r.valid !== false) throw new Error(`valid=${r.valid} for a made-up code`);
    return r.message || '';
  });

  await check('no code at all is a 400', () => refused('GET', '/bookings/promos/validate', T));

  await check('a repeated code param does not 500 (Express hands you an array)', async () => {
    const { status, body } = await req('GET', '/bookings/promos/validate?code=AAA&code=BBB', { ...T, raw: true });
    if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 200)} — .toUpperCase() on an array`);
    return String(status);
  });

  // ── support ───────────────────────────────────────────────────────────────
  section('16 · support tickets');

  await check('a ticket can be raised and read back', async () => {
    const r = await POST('/user/me/support-tickets', { subject: 'Lost phone', message: 'I left my phone in the car.' }, T);
    const ticket = r.ticket ?? r;
    if (!ticket?.id) throw new Error(`no ticket id: ${JSON.stringify(r).slice(0, 160)}`);
    ctx.ticketId = ticket.id;
    const one = await GET(`/user/me/support-tickets/${ticket.id}`, T);
    const t = one.ticket ?? one;
    if (t.subject !== 'Lost phone') throw new Error(`subject came back ${JSON.stringify(t.subject)}`);
    return `id=${ticket.id.slice(0, 8)}`;
  });

  await check('a reply lands on the thread', async () => {
    await POST(`/user/me/support-tickets/${ctx.ticketId}/messages`, { text: 'Any update?' }, T);
    const one = await GET(`/user/me/support-tickets/${ctx.ticketId}`, T);
    const t = one.ticket ?? one;
    const msgs = t.messages ?? [];
    if (!msgs.some((m) => (m.text ?? m.message) === 'Any update?')) {
      throw new Error(`the reply is not on the thread: ${JSON.stringify(msgs).slice(0, 200)}`);
    }
    return `${msgs.length} message(s)`;
  });

  await check('an empty ticket is refused', () =>
    refused('POST', '/user/me/support-tickets', { ...T, body: { subject: '', message: '' } }));

  await check("another rider cannot read this rider's ticket", async () => {
    const other = await makeRider('Nosy Rider 2');
    return refused('GET', `/user/me/support-tickets/${ctx.ticketId}`, { token: other.token });
  });

  // ── notifications feed ────────────────────────────────────────────────────
  section('17 · notifications feed');

  await check('GET /notifications answers with a list and an unread count', async () => {
    const list = await GET('/notifications', T);
    const items = list.notifications ?? list.items ?? list;
    if (!Array.isArray(items)) throw new Error(`not a list: ${JSON.stringify(list).slice(0, 200)}`);
    ctx.notifications = items;
    const c = await GET('/notifications/unread-count', T);
    const count = c.count ?? c.unread ?? c;
    if (!Number.isInteger(count)) throw new Error(`unread-count is ${JSON.stringify(c)}`);
    return `${items.length} item(s), ${count} unread`;
  });

  await check('read-all is idempotent and leaves zero unread', async () => {
    await PATCH('/notifications/read-all', {}, T);
    await PATCH('/notifications/read-all', {}, T);
    const c = await GET('/notifications/unread-count', T);
    const count = c.count ?? c.unread ?? c;
    if (count !== 0) throw new Error(`${count} still unread after read-all`);
    return '';
  });

  // ── the trip-adjacent surface ─────────────────────────────────────────────
  // Everything below needs a real trip: contact masking, the public tracking
  // page, receipts, heavy cargo. These are rider *features* that the booking
  // suite drives past without asserting.
  section('18 · a real trip to read against');

  await check('map reads answer before any trip exists', async () => {
    const est = await GET(`/trips/fare-estimate?pickupLat=${ACCRA.pickup.lat}&pickupLng=${ACCRA.pickup.lng}&dropoffLat=${ACCRA.dropoff.lat}&dropoffLng=${ACCRA.dropoff.lng}&tier=ECO`, T);
    const amt = est.amountPesewas ?? est.fareAmountPesewas ?? est.estimate?.amountPesewas;
    if (amt != null && !Number.isInteger(amt)) throw new Error(`fare-estimate returned fractional money: ${amt}`);
    return `estimate keys: ${Object.keys(est).slice(0, 6).join(',')}`;
  });

  await check('GET /trips/nearby-drivers answers with pins only (no personal fields)', async () => {
    const r = await GET(`/trips/nearby-drivers?lat=${ACCRA.pickup.lat}&lng=${ACCRA.pickup.lng}`, T);
    const drivers = r.drivers ?? r;
    if (!Array.isArray(drivers)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 200)}`);
    for (const d of drivers) {
      for (const leak of ['phone', 'name', 'ghanaCardNumber', 'email']) {
        if (d[leak]) throw new Error(`a map pin leaked ${leak} — the pin feed is public-ish and must carry id+coords only`);
      }
    }
    return `${drivers.length} pin(s)`;
  });

  await check('GET /trips/pulse answers', async () => {
    const r = await GET('/trips/pulse', T);
    const s = r.schedules ?? r;
    if (!Array.isArray(s)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 160)}`);
    return `${s.length}`;
  });

  await check('driver online, rider books, driver accepts', async () => {
    ctx.driver = await makeDriver({ name: 'Settings Driver' });
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);

    const q = await POST('/rides/quote', {
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, tier: 'ECO',
    }, T);
    const ride = await POST('/rides', {
      quoteId: q.quoteId,
      pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng, pickupAddress: 'Osu',
      dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng, dropoffAddress: 'Dansoman',
      tier: 'ECO', paymentMethod: 'CASH', seatCount: 1,
    }, T);
    ctx.tripId = ride.tripId ?? ride.trip?.id ?? ride.id;
    if (!ctx.tripId) throw new Error(`no trip id: ${JSON.stringify(ride).slice(0, 200)}`);

    // POST /rides answers with the TRIP, not the booking. The booking id comes
    // from the rider's own active booking — which is also how the app finds it.
    const active = await GET('/bookings/active', T);
    ctx.bookingId = (active.booking ?? active)?.id;

    // The offer is READ, not pushed — /rides/driver/state is what the driver
    // app polls. The cascade offers to candidates in turn, so 120s is the
    // window it may take to reach us, not a guess.
    await until(
      async () => {
        const s = await GET('/rides/driver/state', { token: ctx.driver.token });
        const o = s.offer ?? s.pendingOffer;
        return o?.tripId === ctx.tripId ? o : null;
      },
      { timeoutMs: 120_000, everyMs: 700, label: 'the offer to reach this driver' },
    );
    await POST(`/rides/${ctx.tripId}/accept`, {}, { token: ctx.driver.token });
    return `trip=${ctx.tripId.slice(0, 8)}`;
  });

  if (ctx.tripId) {
    section('19 · trip-adjacent rider reads');

    await check('GET /trips/:id/contact gives the rider a number to call', async () => {
      const r = await GET(`/trips/${ctx.tripId}/contact`, T);
      const p = r.phone ?? r;
      if (!p) throw new Error(`no phone: ${JSON.stringify(r).slice(0, 160)}`);
      return String(p).replace(/\d(?=\d{3})/g, '•');
    });

    await check("a rider not on the trip cannot read the driver's number", async () => {
      const other = await makeRider('Nosy Rider 3');
      return refused('GET', `/trips/${ctx.tripId}/contact`, { token: other.token });
    });

    await check('GET /trips/:id returns a fare on a ROUTELESS on-demand trip', async () => {
      const t = await GET(`/trips/${ctx.tripId}`, T);
      const trip = t.trip ?? t;
      if (trip.route) info('this trip has a route — the routeless branch was not exercised');
      // getTrip's routeless branch fills these three from the charged bookings;
      // the bus branch fills them from calculateFare(trip.route).
      const fare = trip.totalTripCostPesewas ?? trip.farePerSeatPesewas ?? trip.fare;
      if (fare == null) throw new Error(`no fare on the trip: ${Object.keys(trip).join(',')}`);
      if (!Number.isInteger(fare)) throw new Error(`fare is fractional: ${fare}`);
      if (fare <= 0) throw new Error(`fare is ${fare} — an on-demand trip priced at zero, which is the routeless bug`);
      return `${fare} pesewas`;
    });

    await check('GET /trips/:id/deviation-estimate does not 500 on a routeless trip', async () => {
      const { status, body } = await req(
        'GET',
        `/trips/${ctx.tripId}/deviation-estimate?lat=${ACCRA.nearPickup.lat}&lng=${ACCRA.nearPickup.lng}`,
        { ...T, raw: true },
      );
      if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 200)}`);
      return `${status} ${body?.data?.surchargePesewas ?? body?.message ?? ''}`.slice(0, 80);
    });

    await check('the public tracking page draws a road line for a routeless trip', async () => {
      const t = await GET(`/trips/${ctx.tripId}`, T);
      const trip = t.trip ?? t;
      ctx.shortId = trip.shortId ?? trip.trackingId ?? trip.shareToken;
      if (!ctx.shortId) { info('no shortId on the trip — nothing to track'); return 'skipped'; }
      // Deliberately unauthenticated: this is the link you text your sister.
      const r = await GET(`/trips/track/${ctx.shortId}/data`);
      if (!r.route) throw new Error('tracking page has no route — an on-demand trip has no Route row, so this is the synthesised one');
      if (r.route.originLat == null || r.route.destLat == null) {
        throw new Error('the synthesised route carries no coordinates, so the page cannot place the pins');
      }
      const flat = JSON.stringify(r);
      for (const leak of ['ghanaCardNumber', 'refreshToken', 'passwordHash']) {
        if (flat.includes(leak)) throw new Error(`the PUBLIC tracking payload leaks ${leak}`);
      }
      /**
       * `path` (the road line) is NOT asserted here, deliberately.
       * `peekRouteForTrip` is read-only by contract — it serves what the trip's
       * own traffic already computed and never issues a billable Directions
       * call — so on a local stack with no MAPBOX_ACCESS_TOKEN it is null for
       * every trip. Failing on it would be testing the .env, not the code. What
       * IS asserted above is the part this codebase gets wrong: the synthesised
       * route for a trip that has no Route row.
       */
      if (r.path?.geometry) {
        const coords = r.path.geometry.coordinates ?? r.path.geometry;
        if (Array.isArray(coords) && coords.length === 2) {
          throw new Error('the path is a two-point straight line, not a road line');
        }
        return `route + ${coords?.length ?? '?'} path points`;
      }
      info('no road line — peekRouteForTrip is read-only and this stack has no Directions token');
      return 'route coordinates present';
    });

    await check('a CONFIRMED booking refuses add-on changes, and the fare does not move', async () => {
      if (!ctx.bookingId) { info('no bookingId'); return 'skipped'; }
      // The driver has accepted, so the booking is CONFIRMED. Heavy cargo is a
      // pre-confirmation add-on: allowing it here would reprice a fare the
      // rider has already agreed to and the driver has already been quoted.
      const before = await GET(`/bookings/${ctx.bookingId}`, T);
      const f0 = (before.booking ?? before).fareAmountPesewas;
      const detail = await refused('PATCH', `/bookings/${ctx.bookingId}/heavy-cargo`, { ...T, body: { heavyCargo: true } });
      const after = await GET(`/bookings/${ctx.bookingId}`, T);
      const f1 = (after.booking ?? after).fareAmountPesewas;
      if (f0 !== f1) throw new Error(`the change was refused but the fare moved anyway: ${f0} → ${f1}`);
      return detail;
    });

    await check('a non-boolean heavy-cargo value is refused by the validator', () =>
      refused('PATCH', `/bookings/${ctx.bookingId}/heavy-cargo`, { ...T, body: { heavyCargo: 'yes' } }));

    await check('a NaN pickup is refused rather than written into the fare', async () => {
      if (!ctx.bookingId) return 'skipped';
      const detail = await refused('PATCH', `/bookings/${ctx.bookingId}/pickup`, { ...T, body: { lat: 'here', lng: -0.18 } });
      const after = await GET(`/bookings/${ctx.bookingId}`, T);
      const b = after.booking ?? after;
      if (b.fareAmountPesewas != null && !Number.isFinite(b.fareAmountPesewas)) {
        throw new Error('the booking fare is NaN after a malformed pickup');
      }
      return detail;
    });

    await check('POST /trips/:id/emergency is accepted instantly', async () => {
      const r = await POST(`/trips/${ctx.tripId}/emergency`, {
        latitude: ACCRA.pickup.lat, longitude: ACCRA.pickup.lng, timestamp: new Date().toISOString(),
      }, T);
      if (r?.alertReceived !== true) throw new Error(`SOS not acknowledged: ${JSON.stringify(r).slice(0, 160)}`);
      return '';
    });

    await check('GET /bookings history contains this booking', async () => {
      const r = await GET('/bookings?page=1&limit=20', T);
      const list = r.bookings ?? r;
      if (!Array.isArray(list)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 200)}`);
      if (ctx.bookingId && !list.some((b) => b.id === ctx.bookingId)) {
        throw new Error('the booking the rider just made is not in their own history');
      }
      if (r.totalPages != null && !Number.isInteger(r.totalPages)) throw new Error('totalPages is not an integer');
      return `${list.length} of ${r.total ?? '?'}`;
    });

    section('20 · after completion');

    await check('the trip completes and a receipt is issued', async () => {
      const D = { token: ctx.driver.token };
      // Drive it: en-route → arrived → start → complete.
      for (const step of ['en-route', 'arrived', 'start']) {
        const { status, body } = await req('POST', `/rides/${ctx.tripId}/${step}`, { ...D, raw: true, body: {} });
        if (status >= 500) throw new Error(`${step} → ${status}: ${JSON.stringify(body).slice(0, 160)}`);
      }
      await POST(`/rides/${ctx.tripId}/complete`, {}, D);
      // `/receipts/:bookingId` is the one the complete screen reads. A CASH
      // ride has no gateway Receipt row by design — `/trips/:id/receipt` is
      // built on that table and legitimately 404s here — so the money is
      // asserted where the app actually looks for it.
      const rec = await until(
        async () => {
          const r = await GET(`/receipts/${ctx.bookingId}`, T);
          const rr = r.receipt ?? r;
          return rr?.fareBreakdown || rr?.totalPaidPesewas != null ? rr : null;
        },
        { timeoutMs: 20_000, label: 'a receipt' },
      );
      const fb = rec.fareBreakdown;
      const total = fb?.total ?? rec.totalPaidPesewas;
      if (!Number.isFinite(total)) throw new Error(`no total: keys ${Object.keys(rec).join(',')}`);
      if (total <= 0) throw new Error(`receipt total is ${total}`);
      return `total=${total} receiptNo=${rec.receiptNumber ?? 'none (cash)'}`;
    });

    await check('the trip really did reach COMPLETED', async () => {
      const t = await GET(`/trips/${ctx.tripId}`, T);
      const trip = t.trip ?? t;
      if (trip.status !== 'COMPLETED') throw new Error(`status is ${trip.status}`);
      return trip.status;
    });

    await check('the share link stops tracking the driver once the trip ends', async () => {
      if (!ctx.shortId) return 'skipped';
      const r = await GET(`/trips/track/${ctx.shortId}/data`);
      if (r.ended !== true) throw new Error(`the page still reports a live trip: ended=${r.ended}`);
      if (r.driver || r.vehicle || r.path) throw new Error('an ended share link still carries driver/vehicle/position');
      if (r.route && (r.route.originLat != null || r.route.destLat != null)) {
        throw new Error("an ended share link still carries the rider's coordinates");
      }
      return 'names only';
    });

    await check('the completed trip shows up in the activity tab', async () => {
      const r = await GET('/bookings?page=1&limit=20&status=COMPLETED', T);
      const list = r.bookings ?? r;
      if (!Array.isArray(list)) throw new Error(`not a list: ${JSON.stringify(r).slice(0, 160)}`);
      if (!list.length) throw new Error('a trip was just completed but the COMPLETED filter is empty');
      return `${list.length} completed`;
    });

    await check('a tip is charged in pesewas, not cedis', async () => {
      if (!ctx.bookingId) return 'skipped';
      const { status, body } = await req('POST', `/bookings/${ctx.bookingId}/tip`, {
        ...T, raw: true, body: { amountPesewas: 500 },
      });
      if (status >= 500) throw new Error(`${status}: ${JSON.stringify(body).slice(0, 200)}`);
      return `${status} ${body?.data?.reference ? 'reference issued' : body?.message || ''}`.slice(0, 80);
    });

    await check('a fractional tip is refused', () =>
      refused('POST', `/bookings/${ctx.bookingId}/tip`, { ...T, body: { amountPesewas: 5.5 } }));
  }

  // ── account deletion, last ────────────────────────────────────────────────
  section('21 · account deletion');

  await check('DELETE /user/me deactivates and the token stops working', async () => {
    const doomed = await makeRider('Doomed Rider');
    await DEL('/user/me', { token: doomed.token });
    const { status } = await req('GET', '/user/me', { token: doomed.token, raw: true });
    if (status < 400) throw new Error(`the token still works after account deletion (${status})`);
    return String(status);
  });
}

main()
  .catch((e) => {
    console.error('\n\x1b[31mFATAL\x1b[0m', e.stack || e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Never leave a driver in the pool: the next suite's cascade would offer to them.
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    ctx.driverSock?.close();
    const bad = summary();
    if (bad) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
  });
