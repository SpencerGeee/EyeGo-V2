/**
 * Every driver surface that is not the ride itself — the tabs, the profile, the
 * settings, the group/bus product, and the passenger-handling a driver does at
 * the kerb. Written screen by screen against `apps/driver/app`, so a feature
 * that exists in the UI and not on the server shows up here rather than on a
 * driver's phone.
 *
 *   node scripts/e2e/driver-features.mjs
 */

import {
  section, check, fail, summary,
  GET, POST, PATCH, DEL, req,
  makeRider, makeDriver, goOnline, sleep, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  section('setup');
  await check('an ACTIVE driver with a 14-seat minibus', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Feature Driver', seaterCount: 14, tier: 'ECO' });
    return ctx.driver.phone;
  });
  if (!ctx.driver) return;

  // ── home tab ──────────────────────────────────────────────────────────────
  section('home tab');
  await check('go online → go offline → go online again', async () => {
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    await POST('/driver/go-offline', {}, { token: ctx.driver.token });
    const off = await GET('/driver/me', { token: ctx.driver.token });
    if ((off.driver ?? off).isOnline !== false) throw new Error('still online after go-offline');
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const on = await GET('/driver/me', { token: ctx.driver.token });
    if ((on.driver ?? on).isOnline !== true) throw new Error('still offline after go-online');
    return 'toggles both ways';
  });

  await check('pending trip requests list answers', async () => {
    const r = await GET('/driver/trip-requests/pending', { token: ctx.driver.token });
    const list = r.requests ?? r;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 160)}`);
    return `${list.length} pending`;
  });

  await check('the demand heatmap answers with points', async () => {
    const h = await GET(`/heatmap?lat=${ACCRA.pickup.lat}&lng=${ACCRA.pickup.lng}&radiusKm=8`, { token: ctx.driver.token });
    const pts = h.points ?? h.cells ?? h.zones ?? h;
    if (!Array.isArray(pts) && typeof h !== 'object') throw new Error(`shape: ${JSON.stringify(h).slice(0, 160)}`);
    return Array.isArray(pts) ? `${pts.length} points` : Object.keys(h).slice(0, 5).join(',');
  });

  await check('upcoming scheduled trips answer', async () => {
    const s = await GET('/driver/scheduled/upcoming', { token: ctx.driver.token });
    const list = s.scheduled ?? s.trips ?? s.upcoming ?? s;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(s).slice(0, 160)}`);
    return `${list.length}`;
  });

  await check('pausing requests takes the driver out of dispatch, and unpausing puts them back', async () => {
    await PATCH('/driver/requests-paused', { paused: true }, { token: ctx.driver.token });
    const paused = await POST('/driver/presence', { lat: ACCRA.nearPickup.lat, lng: ACCRA.nearPickup.lng }, { token: ctx.driver.token });
    // The toggle exists so a driver can finish their lunch without going fully
    // offline. If it does not reach dispatch it is decoration.
    if (paused.dispatchable === true) throw new Error('paused, but presence still reports dispatchable — the pause does not reach dispatch');
    await PATCH('/driver/requests-paused', { paused: false }, { token: ctx.driver.token });
    const live = await POST('/driver/presence', { lat: ACCRA.nearPickup.lat, lng: ACCRA.nearPickup.lng }, { token: ctx.driver.token });
    if (live.dispatchable === false) throw new Error(`unpaused but still not dispatchable: ${live.reason}`);
    return `paused → dispatchable=${paused.dispatchable} (${paused.reason ?? 'no reason'}); unpaused → ${live.dispatchable}`;
  });

  section('destination mode');
  await check('set → read → clear a destination', async () => {
    await POST(
      '/driver/destination',
      { lat: ACCRA.dropoff.lat, lng: ACCRA.dropoff.lng, address: 'Home, Dansoman' },
      { token: ctx.driver.token },
    );
    const got = await GET('/driver/destination', { token: ctx.driver.token });
    const d = got.destination ?? got;
    if (!d || d.active !== true || d.address !== 'Home, Dansoman') {
      throw new Error(`read back ${JSON.stringify(got).slice(0, 180)}`);
    }
    await DEL('/driver/destination', { token: ctx.driver.token });
    const after = await GET('/driver/destination', { token: ctx.driver.token });
    const a = after.destination ?? after;
    if (a && a.active === true) throw new Error('destination survived the clear');
    return 'set, read, cleared';
  });

  // ── the group / bus product ───────────────────────────────────────────────
  section('create a group trip (map-pin product)');
  await check('fare estimate answers before publishing', async () => {
    const e = await GET('/driver/fare-estimate?distanceKm=5.2&tier=ECO&availableSeats=14', { token: ctx.driver.token });
    const est = e.fareEstimate ?? e;
    if (!Number.isFinite(est.farePerPersonPesewas)) throw new Error(`shape: ${JSON.stringify(e).slice(0, 200)}`);
    if (est.farePerPersonPesewas <= 0) throw new Error('a 5 km trip estimated at zero');
    return `per seat ${est.farePerPersonPesewas} · total ${est.totalTripCostPesewas} · driver ${est.driverEarningsPesewas}`;
  });

  await check('publish a trip, and it stores the WIRE tier not the UI id', async () => {
    const r = await POST(
      '/driver/trips',
      {
        originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
        destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
        departureTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        availableSeats: 6,
        // The driver app's create screen genuinely sends this UI id.
        tier: 'ECONOMY',
      },
      { token: ctx.driver.token, headers: { 'Idempotency-Key': 'e2e-' + Date.now() } },
    );
    const trip = r.trip ?? r;
    ctx.groupTripId = trip.id;
    if (!ctx.groupTripId) throw new Error(`no trip id: ${JSON.stringify(r).slice(0, 200)}`);
    if (trip.tier === 'ECONOMY') {
      throw new Error("Trip.tier stored as 'ECONOMY' — every Vehicle.tier is a wire value, so the tier filter matches no car");
    }
    if (trip.tier !== 'ECO') throw new Error(`tier stored as ${trip.tier}`);
    return `trip ${ctx.groupTripId.slice(0, 8)} tier=${trip.tier} seats=${trip.maxSeats} status=${trip.status}`;
  });

  await check('the published trip is publicly listed for riders to find', async () => {
    const rider = await makeRider('E2E Trip Finder');
    ctx.finder = rider;
    const s = await GET(
      `/trips?originLat=${ACCRA.pickup.lat}&originLng=${ACCRA.pickup.lng}&destinationLat=${ACCRA.dropoff.lat}&destinationLng=${ACCRA.dropoff.lng}&radius=10`,
      { token: rider.token },
    );
    const list = s.trips ?? s.items ?? s;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(s).slice(0, 160)}`);
    const found = list.find((t) => t.id === ctx.groupTripId);
    if (!found) throw new Error(`${list.length} results, the just-published trip is not among them`);
    if (!Number.isFinite(found.farePerSeatPesewas)) throw new Error('listed with no per-seat fare');
    if (found.availableSeats == null) throw new Error('listed with no seat count');
    return `listed at ${found.farePerSeatPesewas}/seat, ${found.availableSeats} free`;
  });

  await check('a rider books a seat on it and the seat count drops', async () => {
    const before = await GET(`/trips/${ctx.groupTripId}`, { token: ctx.finder.token });
    const seatsBefore = (before.trip ?? before).availableSeats;
    const b = await POST(`/trips/${ctx.groupTripId}/book`, { seatNumber: 2 }, { token: ctx.finder.token });
    ctx.groupBookingId = (b.booking ?? b).id;
    const after = await GET(`/trips/${ctx.groupTripId}`, { token: ctx.finder.token });
    const seatsAfter = (after.trip ?? after).availableSeats;
    if (seatsAfter !== seatsBefore - 1) throw new Error(`seats went ${seatsBefore} → ${seatsAfter} after one booking`);
    return `${seatsBefore} → ${seatsAfter}`;
  });

  await check('the same seat cannot be taken twice', async () => {
    const other = await makeRider('E2E Seat Rival');
    const { status, body } = await req('POST', `/trips/${ctx.groupTripId}/book`, {
      token: other.token, raw: true, body: { seatNumber: 2 },
    });
    if (status < 400) throw new Error('two riders hold seat 2');
    return `${status} ${body?.code ?? body?.message}`.slice(0, 80);
  });

  await check('the seat map shows the taken seat', async () => {
    // `/trips/:id/seats` is a RIDER route (`authenticate`, not
    // `authenticateDriver`) — the driver reads occupancy off `/driver/trips/:id`.
    const m = await GET(`/trips/${ctx.groupTripId}/seats`, { token: ctx.finder.token });
    const seats = m.seats ?? m;
    if (!Array.isArray(seats)) throw new Error(`shape: ${JSON.stringify(m).slice(0, 160)}`);
    const taken = seats.filter((s) => s.isOccupied ?? s.occupied ?? s.status === 'TAKEN');
    return `${seats.length} seats, ${taken.length} taken`;
  });

  section('passengers at the kerb');
  await check('driver adds a cash passenger with no phone', async () => {
    const r = await POST(
      `/driver/trips/${ctx.groupTripId}/add-cash-no-phone`,
      { seatNumber: 4 },
      { token: ctx.driver.token },
    );
    ctx.cashBookingId = r.bookingId ?? (r.booking ?? r)?.id;
    if (!ctx.cashBookingId) throw new Error(`no booking returned: ${JSON.stringify(r).slice(0, 180)}`);
    return `booking ${ctx.cashBookingId.slice(0, 8)}`;
  });

  await check('driver adds an offline passenger by phone, and the hold can be released', async () => {
    const r = await POST(
      `/driver/trips/${ctx.groupTripId}/add-offline-passenger`,
      { seatNumber: 5, phone: '233200000777' },
      { token: ctx.driver.token },
    );
    const bookingId = r.bookingId ?? (r.booking ?? r)?.id;
    if (!bookingId) throw new Error(`no booking: ${JSON.stringify(r).slice(0, 180)}`);
    // The 2026-08-19 finding: backing out of the OTP screen used to burn the
    // seat for the life of the trip because nothing released the hold.
    await POST(`/driver/trips/${ctx.groupTripId}/offline-hold/${bookingId}/release`, {}, { token: ctx.driver.token });
    // `/trips/:id/seats` is a RIDER route (`authenticate`, not
    // `authenticateDriver`) — the driver reads occupancy off `/driver/trips/:id`.
    const m = await GET(`/trips/${ctx.groupTripId}/seats`, { token: ctx.finder.token });
    const seats = m.seats ?? m;
    const seat5 = (Array.isArray(seats) ? seats : []).find((s) => (s.seatNumber ?? s.number) === 5);
    if (seat5 && (seat5.isOccupied ?? seat5.occupied)) throw new Error('seat 5 is still held after the release');
    return 'added and released, seat given back';
  });

  await check('driver boards the real rider', async () => {
    const { status, body } = await req('POST', `/driver/trips/${ctx.groupTripId}/board/${ctx.groupBookingId}`, {
      token: ctx.driver.token, raw: true,
    });
    if (status >= 500) throw new Error(`boarding 500'd: ${body?.message}`);
    if (status >= 400) return `refused ${status} ${body?.code ?? body?.message}`.slice(0, 100);
    return 'boarded';
  });

  section('trips tab');
  await check('active trip, all trips and one trip by id all answer', async () => {
    const [active, all, one] = await Promise.all([
      GET('/driver/trips/active', { token: ctx.driver.token }),
      GET('/driver/trips/all?limit=20', { token: ctx.driver.token }),
      GET(`/driver/trips/${ctx.groupTripId}`, { token: ctx.driver.token }),
    ]);
    const allList = all.trips ?? all.items ?? all;
    if (!Array.isArray(allList)) throw new Error(`/trips/all shape: ${JSON.stringify(all).slice(0, 140)}`);
    const trip = one.trip ?? one;
    if (trip.id !== ctx.groupTripId) throw new Error('by-id returned a different trip');
    return `${allList.length} in history · detail status=${trip.status}`;
  });

  await check('a driver cannot read a trip that is not theirs', async () => {
    const stranger = await makeDriver({ name: 'E2E Nosy Driver' });
    ctx.stranger = stranger;
    const { status } = await req('GET', `/driver/trips/${ctx.groupTripId}`, { token: stranger.token, raw: true });
    if (status < 400) throw new Error(`another driver read the trip (${status})`);
    return String(status);
  });

  await check('driver cancels the published trip, and the seat holders are released', async () => {
    await POST(`/driver/trips/${ctx.groupTripId}/cancel`, { reason: 'vehicle_issue', note: 'e2e' }, { token: ctx.driver.token });
    const t = await GET(`/trips/${ctx.groupTripId}`, { token: ctx.finder.token }).catch(() => null);
    const status = t ? (t.trip ?? t).status : 'unreadable';
    if (t && !['CANCELLED', 'REASSIGNING'].includes(status)) throw new Error(`trip is ${status} after a driver cancel`);
    return `trip is ${status}`;
  });

  // ── earnings tab ──────────────────────────────────────────────────────────
  section('earnings tab');
  await check('balance, transactions and breakdown all answer', async () => {
    const [b, t, br] = await Promise.all([
      GET('/driver/wallet/balance', { token: ctx.driver.token }),
      GET('/driver/earnings/transactions?limit=10', { token: ctx.driver.token }),
      GET('/driver/earnings/breakdown?period=week', { token: ctx.driver.token }),
    ]);
    if (!Number.isFinite(b.balancePesewas)) throw new Error(`balance shape: ${JSON.stringify(b).slice(0, 140)}`);
    const list = t.transactions ?? t;
    if (!Array.isArray(list)) throw new Error(`transactions shape: ${JSON.stringify(t).slice(0, 140)}`);
    return `balance ${b.balancePesewas} · ${list.length} rows · breakdown ${Object.keys(br.breakdown ?? br).slice(0, 5).join(',')}`;
  });

  await check('withdrawing more than the balance is refused', async () => {
    const { status, body } = await req('POST', '/driver/wallet/withdraw', {
      token: ctx.driver.token, raw: true, body: { amountPesewas: 99_999_00 },
    });
    if (status < 400) throw new Error('withdrew more than the wallet holds');
    return `${status} ${body?.code ?? body?.message}`.slice(0, 90);
  });

  await check('withdrawing below the platform minimum is refused, and says the minimum', async () => {
    const { status, body } = await req('POST', '/driver/wallet/withdraw', {
      token: ctx.driver.token, raw: true, body: { amountPesewas: 1 },
    });
    if (status < 400) throw new Error('withdrew 1 pesewa');
    if (!/GH|minimum|least/i.test(body?.message ?? '')) {
      throw new Error(`refused, but the message does not name the minimum: "${body?.message}"`);
    }
    return body.message.slice(0, 80);
  });

  await check('payout account round-trips', async () => {
    await PATCH(
      '/driver/wallet/payout-account',
      { type: 'momo', network: 'MTN MoMo', phone: '233200000123' },
      { token: ctx.driver.token },
    );
    const a = await GET('/driver/wallet/payout-account', { token: ctx.driver.token });
    const acct = a.payoutAccount ?? a.account ?? a;
    const num = acct.phone ?? acct.momoNumber ?? acct.number ?? acct.accountNumber;
    if (!num) throw new Error(`read back ${JSON.stringify(a).slice(0, 180)}`);
    if (acct.type !== 'momo') throw new Error(`type came back ${acct.type}`);
    return `${acct.network} ${num}`;
  });

  // ── quests, notifications, performance ────────────────────────────────────
  section('quests & notifications');
  await check('quests list, and an unearned one cannot be claimed', async () => {
    const q = await GET('/quests', { token: ctx.driver.token });
    const list = q.quests ?? q;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(q).slice(0, 160)}`);
    if (list.length) {
      const unearned = list.find((x) => !x.completed);
      if (unearned) {
        const { status } = await req('POST', `/quests/${unearned.id}/claim`, { token: ctx.driver.token, raw: true });
        if (status < 400) throw new Error('claimed a quest reward without completing the quest');
      }
    }
    return `${list.length} live quest(s)`;
  });

  await check('quest history answers', async () => {
    const h = await GET('/quests/history', { token: ctx.driver.token });
    const list = h.quests ?? h.history ?? h;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(h).slice(0, 160)}`);
    return `${list.length}`;
  });

  await check('driver notifications answer', async () => {
    const n = await GET('/driver/notifications?limit=20', { token: ctx.driver.token });
    const list = n.notifications ?? n;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(n).slice(0, 160)}`);
    return `${list.length}`;
  });

  // ── profile & settings ────────────────────────────────────────────────────
  section('profile & settings');
  await check('edit profile persists', async () => {
    await PATCH('/driver/me', { name: 'E2E Renamed Driver' }, { token: ctx.driver.token });
    const me = await GET('/driver/me', { token: ctx.driver.token });
    if ((me.driver ?? me).name !== 'E2E Renamed Driver') throw new Error('name did not persist');
    return '';
  });

  await check('a misdirected vehicle field is REJECTED, not silently dropped', async () => {
    // The F1 defect: `updateProfile` allow-listed a few fields and dropped the
    // rest with a 200, so onboarding "saved" a vehicle that never existed.
    const { status } = await req('PATCH', '/driver/me', {
      token: ctx.driver.token, raw: true, body: { vehicleMake: 'Nissan', vehiclePlate: 'GT-9999-24' },
    });
    if (status < 400) throw new Error('vehicle fields on /driver/me returned 200 and went nowhere');
    return String(status);
  });

  await check('preferences persist', async () => {
    await PATCH('/driver/preferences', { notificationsEnabled: false, navigationApp: 'waze' }, { token: ctx.driver.token });
    const me = await GET('/driver/me', { token: ctx.driver.token });
    // getMe FLATTENS the preferences blob onto the driver object — settings.tsx
    // reads res.data.data.notificationsEnabled, not .preferences.x.
    const d = me.driver ?? me;
    const prefs = { notificationsEnabled: d.notificationsEnabled, navigationApp: d.navigationApp };
    if (prefs.notificationsEnabled !== false) throw new Error(`read back ${JSON.stringify(prefs).slice(0, 140)}`);
    return JSON.stringify(prefs).slice(0, 110);
  });

  await check('emergency contact persists', async () => {
    await PATCH(
      '/driver/emergency-contact',
      { name: 'E2E Next of Kin', phone: '233200000999' },
      { token: ctx.driver.token },
    );
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const d = me.driver ?? me;
    // getMe must RETURN it, not just store it: safety.tsx reads it from the
    // profile, so a reinstall showed an empty field for an account that had one.
    const ec = d.emergencyContact;
    if (!ec || ec.phone !== '233200000999') {
      throw new Error(`/driver/me does not return the saved emergency contact: ${JSON.stringify(ec)}`);
    }
    return `${ec.name} · ${ec.phone}`;
  });

  await check('the vehicle screen gets the fields it renders', async () => {
    const me = await GET('/driver/me', { token: ctx.driver.token });
    const v = ((me.driver ?? me).vehicles ?? [])[0];
    if (!v) throw new Error('no vehicle');
    // `(profile)/vehicle.tsx` reads these. `seatCapacity` was the wrong name and
    // made every vehicle render its `?? 14` fallback.
    for (const k of ['make', 'model', 'year', 'plateNumber', 'seaterCount', 'tier', 'colour']) {
      if (!(k in v)) throw new Error(`vehicle payload has no ${k}`);
    }
    return `${v.make} ${v.model} · ${v.seaterCount} seats · ${v.colour}`;
  });

  await check('support ticket: create → list → reply', async () => {
    const c = await POST(
      '/driver/support-tickets',
      { subject: 'E2E ticket', category: 'TECHNICAL', description: 'raised by the e2e suite' },
      { token: ctx.driver.token },
    );
    const id = (c.ticket ?? c).id;
    if (!id) throw new Error(`create returned ${JSON.stringify(c).slice(0, 160)}`);
    await POST(`/driver/support-tickets/${id}/reply`, { message: 'a follow-up' }, { token: ctx.driver.token });
    const l = await GET('/driver/support-tickets', { token: ctx.driver.token });
    const list = l.tickets ?? l;
    const mine = (Array.isArray(list) ? list : []).find((t) => t.id === id);
    if (!mine) throw new Error('the ticket just created is not in the list');
    return `ticket ${id.slice(0, 8)} status=${mine.status}`;
  });

  await check('documents list answers', async () => {
    const d = await GET('/driver/documents', { token: ctx.driver.token });
    const list = d.documents ?? d;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(d).slice(0, 160)}`);
    return `${list.length}`;
  });

  section('routes with no UI (build or delete)');
  for (const [label, path] of [
    ['shifts/current', '/driver/shifts/current'],
    ['shifts/history', '/driver/shifts/history'],
    ['inspections', '/driver/inspections'],
    ['destination-filter', '/driver/destination-filter'],
  ]) {
    await check(`GET ${label} answers rather than erroring`, async () => {
      const { status, body } = await req('GET', path, { token: ctx.driver.token, raw: true });
      if (status >= 500) throw new Error(`${status}: ${body?.message}`);
      return `${status} — reachable, still no screen calls it`;
    });
  }

  section('account deletion');
  await check('driver deletes their account', async () => {
    await DEL('/driver/me', { token: ctx.stranger.token });
    return '';
  });

  await check('the deleted driver cannot refresh a token', async () => {
    const { status } = await req('POST', '/auth/driver/refresh', {
      raw: true, body: { refreshToken: ctx.stranger.refreshToken },
    });
    if (status < 400) throw new Error(`refresh still works (${status}) — deletion did not sign the phone out`);
    return String(status);
  });
}

main()
  .catch((e) => fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | ')))
  .finally(async () => {
    for (const d of [ctx.driver]) {
      if (d) await POST('/driver/go-offline', {}, { token: d.token }).catch(() => {});
    }
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
