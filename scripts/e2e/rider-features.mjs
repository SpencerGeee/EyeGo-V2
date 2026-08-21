/**
 * The rider surfaces the first two suites did not reach — the group/bus half of
 * the product, invites and joining, promotions, payment methods, support, the
 * activity and notification tabs, and the account checklist. Together with
 * `rider-happy-path` and `rider-edges` this covers every `xxxApi.method` the
 * rider app calls.
 *
 *   node scripts/e2e/rider-features.mjs
 */

import {
  section, check, fail, summary,
  GET, POST, PATCH, DEL, req,
  makeRider, makeDriver, goOnline, ACCRA,
} from './lib.mjs';

const ctx = {};

async function main() {
  section('setup');
  await check('a rider, plus a driver publishing a bus to book seats on', async () => {
    [ctx.rider, ctx.friend, ctx.driver] = await Promise.all([
      makeRider('E2E Features Rider'),
      makeRider('E2E Invited Friend'),
      makeDriver({ name: 'E2E Bus Driver', seaterCount: 14 }),
    ]);
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    const r = await POST(
      '/driver/trips',
      {
        originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
        destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
        departureTime: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
        availableSeats: 8,
        tier: 'ECO',
      },
      { token: ctx.driver.token, headers: { 'Idempotency-Key': 'e2e-feat-' + Date.now() } },
    );
    ctx.tripId = (r.trip ?? r).id;
    if (!ctx.tripId) throw new Error('no trip published');
    return `trip ${ctx.tripId.slice(0, 8)}`;
  });
  if (!ctx.tripId) return;

  // ── discovery: home + select ──────────────────────────────────────────────
  section('finding a trip (home / select)');
  await check('search returns the bus with a price and free seats', async () => {
    const s = await GET(
      `/trips?originLat=${ACCRA.pickup.lat}&originLng=${ACCRA.pickup.lng}&destinationLat=${ACCRA.dropoff.lat}&destinationLng=${ACCRA.dropoff.lng}&radius=10`,
      { token: ctx.rider.token },
    );
    const list = s.trips ?? s.items ?? s;
    const found = (Array.isArray(list) ? list : []).find((t) => t.id === ctx.tripId);
    if (!found) throw new Error(`${Array.isArray(list) ? list.length : '?'} results, ours is not among them`);
    return `${found.farePerSeatPesewas}/seat · ${found.availableSeats} free`;
  });

  await check('trip detail, seat map and fare estimate all answer for a rider', async () => {
    const [d, seats, est] = await Promise.all([
      GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token }),
      GET(`/trips/${ctx.tripId}/seats`, { token: ctx.rider.token }),
      GET('/trips/fare-estimate?distanceKm=5.2&tier=ECO', { token: ctx.rider.token }),
    ]);
    const trip = d.trip ?? d;
    if (!Number.isFinite(trip.farePerSeatPesewas)) throw new Error('detail has no per-seat fare');
    if (trip.availableSeats == null) throw new Error('detail has no availableSeats');
    const seatList = seats.seats ?? seats;
    if (!Array.isArray(seatList)) throw new Error(`seat map shape: ${JSON.stringify(seats).slice(0, 140)}`);
    return `fare ${trip.farePerSeatPesewas} · ${seatList.length} seats · estimate ${Array.isArray(est) ? est.length : Object.keys(est).length} entries`;
  });

  await check('nearby drivers answer as bare pins with no identity', async () => {
    const n = await GET(`/trips/nearby-drivers?lat=${ACCRA.pickup.lat}&lng=${ACCRA.pickup.lng}`, { token: ctx.rider.token });
    const list = n.drivers ?? n;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(n).slice(0, 140)}`);
    for (const d of list) {
      for (const leaky of ['name', 'phone', 'plateNumber', 'profilePhoto']) {
        if (leaky in d) throw new Error(`a map pin carries the driver's ${leaky}`);
      }
    }
    return `${list.length} pins, coordinates only`;
  });

  // ── booking a seat, inviting, joining ─────────────────────────────────────
  section('seats, groups and invites');
  await check('rider books a seat', async () => {
    const b = await POST('/bookings', { tripId: ctx.tripId, seatNumber: 1, paymentMethod: 'CASH' }, { token: ctx.rider.token });
    ctx.bookingId = (b.booking ?? b).id;
    if (!ctx.bookingId) throw new Error(`no booking: ${JSON.stringify(b).slice(0, 180)}`);
    return ctx.bookingId.slice(0, 8);
  });

  await check('the booking reads back on its own', async () => {
    const b = await GET(`/bookings/${ctx.bookingId}`, { token: ctx.rider.token });
    const booking = b.booking ?? b;
    if (booking.id !== ctx.bookingId) throw new Error('got a different booking');
    if (!Number.isFinite(booking.fareAmountPesewas)) throw new Error('booking carries no fare');
    return `seat ${booking.seatNumber} · ${booking.fareAmountPesewas} · ${booking.status}`;
  });

  await check('another rider cannot read that booking', async () => {
    const { status } = await req('GET', `/bookings/${ctx.bookingId}`, { token: ctx.friend.token, raw: true });
    if (status < 400) throw new Error(`a stranger read someone else's booking (${status})`);
    return String(status);
  });

  await check('rider creates a ride group and gets a share token', async () => {
    const g = await POST(`/trips/${ctx.tripId}/group`, { isCoverAll: false }, { token: ctx.rider.token });
    const group = g.group ?? g;
    ctx.shareToken = group.shareToken;
    if (!ctx.shareToken) throw new Error(`no shareToken: ${JSON.stringify(g).slice(0, 180)}`);
    return ctx.shareToken.slice(0, 10);
  });

  await check('the public join page renders without a token', async () => {
    const j = await GET(`/trips/join/${ctx.shareToken}/data`);
    const data = j.trip ?? j;
    if (!data) throw new Error('empty join payload');
    const blob = JSON.stringify(data);
    if (blob.includes(ctx.driver.phone)) throw new Error("the public join page carries the driver's phone");
    return Object.keys(data).slice(0, 8).join(',');
  });

  await check('a friend joins through the invite and takes a seat', async () => {
    const before = await GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token });
    const seatsBefore = (before.trip ?? before).availableSeats;
    // `joinGroup` RESOLVES the invite to a trip — it does not book. The join
    // screen then sends the friend into seat selection, which is this second call.
    const resolved = await POST(`/bookings/join/${ctx.shareToken}`, {}, { token: ctx.friend.token });
    if (resolved.tripId !== ctx.tripId) throw new Error(`the invite resolved to ${resolved.tripId}`);
    const r = await POST('/bookings', { tripId: ctx.tripId, seatNumber: 3, paymentMethod: 'CASH' }, { token: ctx.friend.token });
    ctx.friendBookingId = (r.booking ?? r).id;
    const after = await GET(`/trips/${ctx.tripId}`, { token: ctx.rider.token });
    const seatsAfter = (after.trip ?? after).availableSeats;
    if (seatsAfter >= seatsBefore) throw new Error(`seats did not drop: ${seatsBefore} → ${seatsAfter}`);
    return `${seatsBefore} → ${seatsAfter}`;
  });

  await check('the group hub shows both members', async () => {
    const g = await GET(`/bookings/${ctx.bookingId}/group`, { token: ctx.rider.token });
    const group = g.group ?? g;
    // `getGroup` deliberately excludes the caller — the hub renders them as
    // "You" — so one other member is the right answer for two bookings.
    const members = group.members ?? group.bookings ?? [];
    if (members.length !== 1) throw new Error(`group shows ${members.length} other member(s), expected 1`);
    if (!Number.isFinite(group.fare?.totalPesewas ?? group.totalPesewas)) throw new Error('the hub has no money on it');
    return `1 other member: ${members[0].passengerName} in seat ${members[0].seatNumber}`;
  });

  await check('a joiner pricing their own pickup gets a deviation estimate, not a 500', async () => {
    const e = await GET(
      `/trips/${ctx.tripId}/deviation-estimate?lat=${ACCRA.nearPickup.lat}&lng=${ACCRA.nearPickup.lng}`,
      { token: ctx.friend.token },
    );
    if (!Number.isFinite(e.surcharge)) throw new Error(`shape: ${JSON.stringify(e).slice(0, 160)}`);
    if (e.surcharge < 0) throw new Error(`negative surcharge ${e.surcharge}`);
    return `+${e.extraKm}km → ${e.surcharge}`;
  });

  await check('heavy cargo actually changes the fare', async () => {
    const before = (await GET(`/bookings/${ctx.bookingId}`, { token: ctx.rider.token }));
    const fareBefore = (before.booking ?? before).fareAmountPesewas;
    await PATCH(`/bookings/${ctx.bookingId}/heavy-cargo`, { heavyCargo: true }, { token: ctx.rider.token });
    const after = (await GET(`/bookings/${ctx.bookingId}`, { token: ctx.rider.token }));
    const b = after.booking ?? after;
    if (b.heavyCargo !== true) throw new Error('the flag did not persist');
    // It was once a client-only toggle that changed the displayed price and
    // charged nothing.
    if (b.fareAmountPesewas === fareBefore) {
      throw new Error(`heavy cargo left the fare at ${fareBefore} — the surcharge is not charged`);
    }
    return `${fareBefore} → ${b.fareAmountPesewas}`;
  });

  await check('regenerating the invite issues a new token and kills the old one', async () => {
    const r = await POST(`/bookings/${ctx.bookingId}/invite/regenerate`, {}, { token: ctx.rider.token });
    const fresh = r.inviteToken ?? (r.group ?? r).shareToken;
    if (!fresh) throw new Error(`no token: ${JSON.stringify(r).slice(0, 160)}`);
    if (fresh === ctx.shareToken) throw new Error('regenerate returned the SAME token — a leaked link stays live');
    const { status } = await req('GET', `/trips/join/${ctx.shareToken}/data`, { raw: true });
    if (status < 400) throw new Error('the OLD invite link still works after regeneration');
    return 'new token issued, old one dead';
  });

  // ── promotions ────────────────────────────────────────────────────────────
  section('promotions');
  await check('the promotions screen has something to render', async () => {
    const p = await GET('/user/me/promotions', { token: ctx.rider.token });
    for (const k of ['applied', 'available', 'used', 'serverNowMs']) {
      if (!(k in p)) throw new Error(`payload has no ${k} — the screen renders all three lists`);
    }
    if (!Array.isArray(p.available)) throw new Error('available is not a list');
    return `${p.available.length} available · ${p.used.length} used · applied=${p.applied ? 'yes' : 'none'}`;
  });

  await check('an invalid promo code is refused with a reason', async () => {
    const { status, body } = await req('POST', `/bookings/${ctx.bookingId}/apply-promo`, {
      token: ctx.rider.token, raw: true, body: { code: 'DEFINITELY-NOT-A-CODE' },
    });
    if (status < 400) throw new Error('a nonsense promo code was accepted');
    if (!body?.message) throw new Error('refused with no message for the rider to read');
    return `${status} ${body.message}`.slice(0, 80);
  });

  await check('promo validation endpoint answers', async () => {
    const v = await GET('/bookings/promos/validate?code=NOPE', { token: ctx.rider.token });
    if (v.valid !== false) throw new Error(`a nonsense code validated as ${JSON.stringify(v).slice(0, 120)}`);
    return `valid=${v.valid}`;
  });

  // ── payments & wallet ─────────────────────────────────────────────────────
  section('payments & wallet');
  await check('payment methods list answers', async () => {
    const m = await GET('/wallet/payment-methods', { token: ctx.rider.token });
    const list = m.paymentMethods ?? m.methods ?? m;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(m).slice(0, 140)}`);
    return `${list.length} saved`;
  });

  await check('add-card initialize reaches the gateway (or refuses as one)', async () => {
    // The add-card flow is initialize → the rider pays 1 pesewa → verify. With no
    // live key locally the first leg cannot succeed; what must hold is that it
    // fails AS A GATEWAY, not as an unexplained 500.
    const { status, body } = await req('POST', '/wallet/payment-methods/initialize', { token: ctx.rider.token, raw: true, body: {} });
    if (status === 500) throw new Error(`initialize surfaced a 500: ${body?.message}`);
    if (status < 400) return `initialized: ${JSON.stringify(body?.data).slice(0, 100)}`;
    return `${status} ${body?.code ?? body?.message}`.slice(0, 90);
  });

  await check('a wallet top-up reaches the gateway rather than 500ing', async () => {
    const { status, body } = await req('POST', '/wallet/topup', {
      token: ctx.rider.token, raw: true, body: { amountPesewas: 5000, method: 'MOMO_MTN' },
    });
    if (status === 500) throw new Error(`top-up surfaced a 500: ${body?.message}`);
    return status < 400 ? 'accepted' : `${status} ${body?.code}`;
  });

  await check('paying for a booking reaches the gateway rather than 500ing', async () => {
    const { status, body } = await req('POST', '/payments/initiate', {
      token: ctx.rider.token, raw: true,
      body: { bookingId: ctx.bookingId, paymentMethod: 'MOMO_MTN', phone: ctx.rider.phone },
    });
    if (status === 500) throw new Error(`initiate surfaced a 500: ${body?.message}`);
    return status < 400 ? 'accepted' : `${status} ${body?.code}`;
  });

  // ── tabs ──────────────────────────────────────────────────────────────────
  section('activity, trips and notification tabs');
  await check('active bookings and history both answer', async () => {
    const [a, h] = await Promise.all([
      GET('/bookings/active', { token: ctx.rider.token }),
      GET('/bookings?limit=20', { token: ctx.rider.token }),
    ]);
    const active = a.bookings ?? a.booking ?? a;
    const hist = h.bookings ?? h.items ?? h;
    if (!Array.isArray(hist)) throw new Error(`history shape: ${JSON.stringify(h).slice(0, 140)}`);
    if (!hist.some((b) => b.id === ctx.bookingId)) throw new Error('the booking just made is not in history');
    return `active=${Array.isArray(active) ? active.length : active ? 1 : 0} · history=${hist.length}`;
  });

  await check('notifications list, unread count, mark-all-read', async () => {
    const [l, c] = await Promise.all([
      GET('/notifications?limit=20', { token: ctx.rider.token }),
      GET('/notifications/unread-count', { token: ctx.rider.token }),
    ]);
    const list = l.notifications ?? l;
    if (!Array.isArray(list)) throw new Error(`list shape: ${JSON.stringify(l).slice(0, 140)}`);
    if (!Number.isFinite(c.count ?? c.unread ?? c.unreadCount)) throw new Error(`count shape: ${JSON.stringify(c).slice(0, 140)}`);
    await PATCH('/notifications/read-all', {}, { token: ctx.rider.token });
    const after = await GET('/notifications/unread-count', { token: ctx.rider.token });
    const n = after.count ?? after.unread ?? after.unreadCount;
    if (n !== 0) throw new Error(`mark-all-read left ${n} unread`);
    return `${list.length} notifications, unread → 0`;
  });

  await check('the account checklist tells the profile tab what is missing', async () => {
    const c = await GET('/user/me/account-checklist', { token: ctx.rider.token });
    const checklist = c.checklist ?? c;
    if (typeof checklist !== 'object' || checklist == null) throw new Error(`shape: ${JSON.stringify(c).slice(0, 140)}`);
    return Object.keys(checklist).slice(0, 8).join(',');
  });

  // ── profile odds and ends ─────────────────────────────────────────────────
  section('profile: business, support, contact');
  await check('business mode persists', async () => {
    await PATCH('/user/me', { businessMode: true, businessName: 'E2E Ltd' }, { token: ctx.rider.token });
    const me = await GET('/user/me', { token: ctx.rider.token });
    const u = me.user ?? me;
    if (u.businessMode !== true) throw new Error(`businessMode came back ${u.businessMode}`);
    return `businessMode=${u.businessMode} name=${u.businessName ?? '(none)'}`;
  });

  await check('rider support ticket: create → list → read → reply', async () => {
    const c = await POST(
      '/user/me/support-tickets',
      { subject: 'E2E rider ticket', category: 'TRIP', message: 'raised by the e2e suite' },
      { token: ctx.rider.token },
    );
    const id = (c.ticket ?? c).id;
    if (!id) throw new Error(`create returned ${JSON.stringify(c).slice(0, 160)}`);
    await POST(`/user/me/support-tickets/${id}/messages`, { text: 'following up' }, { token: ctx.rider.token });
    const one = await GET(`/user/me/support-tickets/${id}`, { token: ctx.rider.token });
    const ticket = one.ticket ?? one;
    const msgs = ticket.messages ?? [];
    if (msgs.length < 2) throw new Error(`ticket has ${msgs.length} message(s), expected the description plus the reply`);
    return `${msgs.length} messages, status ${ticket.status}`;
  });

  await check('another rider cannot read that ticket', async () => {
    const l = await GET('/user/me/support-tickets', { token: ctx.friend.token });
    const list = l.tickets ?? l;
    const leaked = (Array.isArray(list) ? list : []).some((t) => t.subject === 'E2E rider ticket');
    if (leaked) throw new Error("another rider's ticket appears in this rider's list");
    return 'scoped to the owner';
  });

  await check('the masked contact relay answers for a rider on the trip', async () => {
    const { status, body } = await req('GET', `/trips/${ctx.tripId}/contact`, { token: ctx.rider.token, raw: true });
    if (status >= 500) throw new Error(`contact 500'd: ${body?.message}`);
    // No driver has been assigned to a SCHEDULED bus in this test, so a stated
    // refusal is correct; a 500 or a silent empty string is not.
    return status < 400 ? 'contact returned' : `${status} ${body?.code ?? body?.message}`.slice(0, 80);
  });

  await check('insurance upload endpoint rejects a bodyless request rather than 500ing', async () => {
    const { status, body } = await req('POST', '/user/me/insurance', { token: ctx.rider.token, raw: true, body: {} });
    if (status >= 500) throw new Error(`500 on an empty upload: ${body?.message}`);
    return `${status} ${body?.code ?? body?.message}`.slice(0, 80);
  });

  // ── the free-text trip request product ────────────────────────────────────
  section('on-demand trip request (free-text destination)');
  await check('rider raises a trip request, reads it, and cancels it', async () => {
    const r = await POST(
      '/trips/request',
      {
        destination: 'Kotoka International Airport',
        scheduledAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        seatCount: 1,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng,
      },
      { token: ctx.rider.token },
    );
    const id = r.requestId ?? (r.request ?? r).id;
    if (!id) throw new Error(`no request id: ${JSON.stringify(r).slice(0, 180)}`);
    const got = await GET(`/trips/request/${id}`, { token: ctx.rider.token });
    const status = (got.request ?? got).status;
    await DEL(`/trips/request/${id}`, { token: ctx.rider.token });
    return `raised (${status}) and cancelled`;
  });
}

main()
  .catch((e) => fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | ')))
  .finally(async () => {
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
