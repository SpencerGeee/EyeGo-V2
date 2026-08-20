/**
 * The parts of the rider that are not the happy path — which is where the bugs
 * live. Cancellation and its fee, chat in both directions, SOS, disputes,
 * scheduling, the wallet ledger, the settings screens that must actually
 * persist, and account deletion, which has to genuinely revoke.
 *
 *   node scripts/e2e/rider-edges.mjs
 */

import {
  BASE, section, check, fail, summary,
  GET, POST, PATCH, PUT, DEL, req,
  makeRider, makeDriver, goOnline, connectSocket, sleep, until, ACCRA,
} from './lib.mjs';

const ctx = {};

/** Book a ride and get it to `stopAt`, returning { tripId, bookingId }. */
async function rideTo(stopAt, rider, driver) {
  // Presence is a Redis key with a TTL that a live socket refreshes. This
  // harness holds no driver socket between scenarios, so re-assert it or the
  // driver silently drops out of the pool between rides and no offer arrives.
  await goOnline(driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng).catch(() => {});
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
  const tripId = r.tripId ?? r.trip?.id;
  if (stopAt === 'REQUESTED') return { tripId, quote: q };

  await until(
    async () => {
      const s = await GET('/rides/driver/state', { token: driver.token });
      const offer = s.offer ?? s.pendingOffer;
      return offer?.tripId === tripId ? offer : null;
    },
    { timeoutMs: 20000, label: 'offer to reach the driver' },
  );
  await POST(`/rides/${tripId}/accept`, {}, { token: driver.token });
  if (stopAt === 'DRIVER_ASSIGNED') return { tripId, quote: q };

  for (const verb of ['en-route', 'arrived', 'start']) {
    await POST(`/rides/${tripId}/${verb}`, {}, { token: driver.token });
    if (stopAt === verb) return { tripId, quote: q };
  }
  return { tripId, quote: q };
}

async function bookingIdFor(rider, tripId) {
  const h = await GET('/bookings?limit=30', { token: rider.token });
  const list = h.bookings ?? h.items ?? h;
  const b = (Array.isArray(list) ? list : []).find((x) => (x.tripId ?? x.trip?.id) === tripId);
  return b?.id ?? null;
}

async function main() {
  section('setup');
  await check('two riders and one driver exist', async () => {
    [ctx.rider, ctx.rider2, ctx.driver] = await Promise.all([
      makeRider('E2E Edges Rider'),
      makeRider('E2E Recipient'),
      makeDriver({ name: 'E2E Edges Driver' }),
    ]);
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    return `${ctx.rider.phone} / ${ctx.rider2.phone} / ${ctx.driver.phone}`;
  });
  if (!ctx.rider) return;

  // ── cancellation ──────────────────────────────────────────────────────────
  section('cancellation');
  await check('cancel before a driver is found is free', async () => {
    const { tripId } = await rideTo('REQUESTED', ctx.rider, ctx.driver);
    const r = await POST(`/rides/${tripId}/cancel`, { reason: 'changed my mind' }, { token: ctx.rider.token });
    const fee = r.cancellationFeePesewas ?? r.feePesewas ?? 0;
    if (fee > 0) throw new Error(`charged ${fee} pesewas to cancel a ride nobody had accepted`);
    const a = await GET('/rides/active', { token: ctx.rider.token });
    if (a.trip) throw new Error(`still shows an active trip (${a.trip.status}) after cancelling`);
    return 'free, and the active ride cleared';
  });

  await check('cancel after assignment quotes a fee before charging it', async () => {
    const { tripId } = await rideTo('DRIVER_ASSIGNED', ctx.rider, ctx.driver);
    ctx.assignedTripId = tripId;
    const bookingId = await bookingIdFor(ctx.rider, tripId);
    if (!bookingId) throw new Error('no booking row for the assigned trip');
    ctx.assignedBookingId = bookingId;
    const res = await GET(`/cancellation/${bookingId}/fee`, { token: ctx.rider.token });
    const terms = res.cancellationFeePesewas ?? res;
    const amount = terms.feeAmountPesewas;
    if (!Number.isFinite(amount)) throw new Error(`fee endpoint returned ${JSON.stringify(res).slice(0, 220)}`);
    // A hailed ride must NOT be priced off `departureTime` — that put every
    // hailed cancellation in the no-show bucket at 100% of the fare.
    if (terms.feeType === 'NO_SHOW') {
      throw new Error(`a hailed ride quoted NO_SHOW at ${terms.feePercentage}% (${amount} of ${terms.fareAmountPesewas})`);
    }
    if (amount > terms.fareAmountPesewas) throw new Error(`fee ${amount} exceeds the fare ${terms.fareAmountPesewas}`);
    ctx.quotedFee = amount;
    return `${terms.feeType} · ${amount} of ${terms.fareAmountPesewas} · ${terms.secondsSinceAssigned}s since assigned, grace ${terms.freeCancelSeconds}s`;
  });


  await check('the fee actually charged equals the fee that was quoted', async () => {
    const r = await POST(
      `/cancellation/${ctx.assignedBookingId}/cancel`,
      { reason: 'driver too far', note: 'e2e' },
      { token: ctx.rider.token },
    );
    const charged = r.cancellationFeePesewas ?? r.feePesewas ?? 0;
    if (ctx.quotedFee != null && charged !== ctx.quotedFee) {
      throw new Error(`quoted ${ctx.quotedFee} but charged ${charged}`);
    }
    return `charged ${charged}`;
  });

  await check('the driver is released after a rider cancel', async () => {
    const s = await until(
      async () => {
        const st = await GET('/rides/driver/state', { token: ctx.driver.token });
        return st.trip == null ? st : null;
      },
      { timeoutMs: 12000, label: 'driver to be freed' },
    );
    return `online=${s.driver?.isOnline}`;
  });

  // ── chat ──────────────────────────────────────────────────────────────────
  section('chat');
  await check('a live ride exists to chat on', async () => {
    const { tripId } = await rideTo('en-route', ctx.rider, ctx.driver);
    ctx.chatTripId = tripId;
    ctx.riderSock = await connectSocket('/passenger', ctx.rider.token);
    ctx.driverSock = await connectSocket('/driver', ctx.driver.token);
    ctx.riderSock.emit('passenger:join_trip_room', { tripId });
    ctx.driverSock.emit('driver:join_tracking', { tripId });
    await sleep(1200);
    return tripId.slice(0, 8);
  });

  await check('rider → driver message arrives', async () => {
    const text = 'e2e rider says hello ' + Date.now();
    const waiting = ctx.driverSock.waitFor(
      (f) => f.event === 'chat:message' && f.payload?.text === text,
      12000,
      'chat:message on the driver',
    );
    ctx.riderSock.emit('chat:send', { tripId: ctx.chatTripId, text, timestamp: Date.now() });
    const f = await waiting;
    if (!f.payload?.senderRole) throw new Error('message carries no senderRole — the bubble cannot pick a side');
    return `senderRole=${f.payload.senderRole}`;
  });

  await check('driver → rider message arrives', async () => {
    const text = 'e2e driver says hello ' + Date.now();
    const waiting = ctx.riderSock.waitFor(
      (f) => f.event === 'chat:message' && f.payload?.text === text,
      12000,
      'chat:message on the rider',
    );
    ctx.driverSock.emit('chat:send', { tripId: ctx.chatTripId, text, timestamp: Date.now() });
    const f = await waiting;
    return `senderRole=${f.payload?.senderRole}`;
  });

  await check('chat history replays on re-join', async () => {
    const sock = await connectSocket('/passenger', ctx.rider.token);
    const waiting = sock.waitFor((f) => f.event === 'chat:history', 12000, 'chat:history');
    sock.emit('passenger:join_trip_room', { tripId: ctx.chatTripId });
    const f = await waiting;
    sock.close();
    const n = Array.isArray(f.payload) ? f.payload.length : 0;
    if (n < 2) throw new Error(`history had ${n} messages, expected the 2 just sent`);
    return `${n} messages`;
  });

  // ── SOS ───────────────────────────────────────────────────────────────────
  section('safety');
  await check('SOS raises an alert on the live trip', async () => {
    const r = await POST(
      `/trips/${ctx.chatTripId}/emergency`,
      { lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng, message: 'e2e test' },
      { token: ctx.rider.token },
    );
    return JSON.stringify(r).slice(0, 160);
  });

  await check('emergency contacts round-trip', async () => {
    const put = await PUT(
      '/user/me/emergency-contacts',
      { contacts: [{ name: 'E2E Kin', phone: '233200000001' }] },
      { token: ctx.rider.token },
    );
    const got = await GET('/user/me/emergency-contacts', { token: ctx.rider.token });
    const list = got.contacts ?? got;
    if (!Array.isArray(list) || !list.length) throw new Error(`read back ${JSON.stringify(got).slice(0, 160)}`);
    if (list[0].name !== 'E2E Kin') throw new Error('the contact that came back is not the one saved');
    return `${list.length} contact(s)`;
  });

  await check('safety settings persist', async () => {
    await PUT('/user/me/safety-settings', { shareTrip: true, speedAlerts: true }, { token: ctx.rider.token });
    const s = await GET('/user/me/safety-settings', { token: ctx.rider.token });
    const settings = s.safetySettings ?? s.settings ?? s;
    if (settings.shareTrip !== true) throw new Error(`shareTrip came back ${JSON.stringify(settings)}`);
    return JSON.stringify(settings).slice(0, 140);
  });

  await check('notification preferences persist AND are the shape the push gate reads', async () => {
    await PATCH('/user/me/notifications', { driverArriving: false, tripStarted: false }, { token: ctx.rider.token });
    const p = await GET('/user/me/notifications', { token: ctx.rider.token });
    const prefs = p.notificationPrefs ?? p.preferences ?? p.prefs ?? p;
    if (prefs.driverArriving !== false) {
      throw new Error(`toggled driverArriving off, read back ${JSON.stringify(prefs).slice(0, 160)}`);
    }
    return JSON.stringify(prefs).slice(0, 160);
  });

  // ── the ride finishes so the money paths have something to work on ────────
  section('completion, dispute, receipt');
  await check('the live ride completes', async () => {
    // rideTo stopped at en-route; walk the rest of the rail before completing.
    for (const verb of ['arrived', 'start']) {
      await POST(`/rides/${ctx.chatTripId}/${verb}`, {}, { token: ctx.driver.token }).catch(() => {});
    }
    await POST(`/rides/${ctx.chatTripId}/complete`, {}, { token: ctx.driver.token });
    ctx.chatBookingId = await bookingIdFor(ctx.rider, ctx.chatTripId);
    if (!ctx.chatBookingId) throw new Error('no booking row after completion');
    return ctx.chatBookingId.slice(0, 8);
  });

  await check('a tip reaches the gateway (and a gateway refusal is not a 500)', async () => {
    const { status, body } = await req('POST', `/bookings/${ctx.chatBookingId}/tip`, {
      token: ctx.rider.token,
      raw: true,
      body: { amountPesewas: 500 },
    });
    if (status < 400) return `accepted: ${JSON.stringify(body?.data).slice(0, 120)}`;
    // With no live Paystack key the charge cannot succeed here. What must hold
    // is that the request got PAST the argument plumbing (it used to die on
    // `amount` vs `amountPesewas`, then on `method: CASH`) and that a gateway
    // refusal is reported as one rather than as an unexplained server crash.
    if (status === 500) {
      throw new Error(`gateway failure surfaced as a 500: ${body?.message}`);
    }
    if (body?.code !== 'PAYMENT_PROVIDER_ERROR') {
      throw new Error(`refused with ${status} ${body?.code}: ${body?.message}`);
    }
    return `reached the gateway; refused ${status} ${body.code} (no live key locally)`;
  });

  await check('rider can raise a dispute on the completed booking', async () => {
    const r = await POST(
      `/bookings/${ctx.chatBookingId}/dispute`,
      { reason: 'OVERCHARGED', details: 'e2e dispute' },
      { token: ctx.rider.token },
    );
    return JSON.stringify(r).slice(0, 160);
  });

  await check('a second rider cannot dispute somebody else\'s booking', async () => {
    const { status } = await req('POST', `/bookings/${ctx.chatBookingId}/dispute`, {
      token: ctx.rider2.token,
      raw: true,
      body: { reason: 'OVERCHARGED', details: 'not mine' },
    });
    if (status < 400) throw new Error(`accepted with ${status} — any rider can dispute any booking`);
    return String(status);
  });

  // ── wallet ────────────────────────────────────────────────────────────────
  section('wallet');
  await check('balance reads', async () => {
    const b = await GET('/wallet/balance', { token: ctx.rider.token });
    ctx.balance = b.balancePesewas ?? b.walletBalancePesewas ?? b.balance;
    if (!Number.isFinite(ctx.balance)) throw new Error(`shape: ${JSON.stringify(b).slice(0, 160)}`);
    return `${ctx.balance} pesewas`;
  });

  await check('send money to a rider with an empty wallet is refused, not silently zeroed', async () => {
    const { status, body } = await req('POST', '/wallet/send', {
      token: ctx.rider.token,
      raw: true,
      body: { recipientPhone: ctx.rider2.phone, amountPesewas: 100000 },
    });
    if (status < 400) throw new Error(`sent 1000 GHS from an empty wallet and got ${status}`);
    if (status !== 402 && body?.code !== 'INSUFFICIENT_WALLET') {
      return `refused with ${status} ${body?.code ?? ''} (expected 402/INSUFFICIENT_WALLET)`;
    }
    return `${status} ${body?.code}`;
  });

  await check('a fractional (cedis) amount is rejected rather than transferred 100x wrong', async () => {
    const { status, body } = await req('POST', '/wallet/send', {
      token: ctx.rider.token,
      raw: true,
      body: { recipientPhone: ctx.rider2.phone, amountPesewas: 12.5 },
    });
    if (status < 400) throw new Error('accepted a fractional pesewa amount');
    return `${status} ${body?.code ?? body?.message ?? ''}`.slice(0, 100);
  });

  await check('transactions list reads', async () => {
    const t = await GET('/wallet/transactions?limit=10', { token: ctx.rider.token });
    const list = t.transactions ?? t.items ?? t;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(t).slice(0, 160)}`);
    return `${list.length} rows`;
  });

  // ── scheduling ────────────────────────────────────────────────────────────
  section('scheduling');
  await check('schedule a ride for tomorrow', async () => {
    const when = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    const r = await POST(
      '/trips/schedule',
      {
        destination: 'Kotoka International Airport',
        scheduledAt: when,
        seatCount: 1,
        pickupLat: ACCRA.pickup.lat,
        pickupLng: ACCRA.pickup.lng,
        pickupName: 'Accra Central',
        destLat: ACCRA.dropoff.lat,
        destLng: ACCRA.dropoff.lng,
      },
      { token: ctx.rider.token },
    );
    ctx.scheduledId = r.id ?? r.intent?.id ?? r.scheduledRide?.id;
    if (!ctx.scheduledId) throw new Error(`no id in ${JSON.stringify(r).slice(0, 200)}`);
    return ctx.scheduledId.slice(0, 8);
  });

  await check('it appears in the scheduled list', async () => {
    const l = await GET('/trips/scheduled', { token: ctx.rider.token });
    const list = l.intents ?? l.rides ?? l.scheduled ?? l.items ?? l;
    if (!Array.isArray(list)) throw new Error(`shape: ${JSON.stringify(l).slice(0, 200)}`);
    if (!list.some((x) => x.id === ctx.scheduledId)) {
      throw new Error(`${list.length} scheduled rides, none is the one just created`);
    }
    return `${list.length} scheduled`;
  });

  await check('cancelling it removes it', async () => {
    await DEL(`/trips/scheduled/${ctx.scheduledId}`, { token: ctx.rider.token });
    const l = await GET('/trips/scheduled', { token: ctx.rider.token });
    const list = l.intents ?? l.rides ?? l.scheduled ?? l.items ?? l;
    const still = (Array.isArray(list) ? list : []).find((x) => x.id === ctx.scheduledId);
    if (still && !['CANCELLED', 'EXPIRED'].includes(still.status)) {
      throw new Error(`still listed as ${still.status}`);
    }
    return still ? `listed as ${still.status}` : 'gone';
  });

  // ── places & profile ──────────────────────────────────────────────────────
  section('places & profile');
  await check('saved place create → list → delete', async () => {
    const c = await POST(
      '/user/me/saved-places',
      { label: 'Home', address: 'Osu, Accra', lat: ACCRA.pickup.lat, lng: ACCRA.pickup.lng },
      { token: ctx.rider.token },
    );
    const id = c.id ?? c.place?.id ?? c.savedPlace?.id;
    if (!id) throw new Error(`create returned ${JSON.stringify(c).slice(0, 160)}`);
    const l = await GET('/user/me/saved-places', { token: ctx.rider.token });
    const list = l.places ?? l.savedPlaces ?? l;
    if (!Array.isArray(list) || !list.some((p) => p.id === id)) throw new Error('not in the list after creating');
    await DEL(`/user/me/saved-places/${id}`, { token: ctx.rider.token });
    const l2 = await GET('/user/me/saved-places', { token: ctx.rider.token });
    const list2 = l2.places ?? l2.savedPlaces ?? l2;
    if ((Array.isArray(list2) ? list2 : []).some((p) => p.id === id)) throw new Error('still there after delete');
    return 'created, listed, deleted';
  });

  await check('privacy settings persist', async () => {
    await PUT('/user/me/privacy-settings', { locationSharing: false, analytics: false }, { token: ctx.rider.token });
    const s = await GET('/user/me/privacy-settings', { token: ctx.rider.token });
    const v = s.privacySettings ?? s.settings ?? s;
    if (v.locationSharing !== false) throw new Error(JSON.stringify(v).slice(0, 160));
    return JSON.stringify(v).slice(0, 120);
  });

  await check('the platform config the apps read is reachable and typed', async () => {
    const cfg = await GET('/config/public', { token: ctx.rider.token });
    const c = cfg.config ?? cfg;
    const keys = Object.keys(c || {});
    if (!keys.length) throw new Error('empty config');
    return `${keys.length} keys: ${keys.slice(0, 8).join(',')}`;
  });

  // ── account deletion ──────────────────────────────────────────────────────
  section('account deletion');
  await check('DELETE /user/me succeeds', async () => {
    await DEL('/user/me', { token: ctx.rider2.token });
    return '';
  });

  await check('the deleted account cannot mint a new access token', async () => {
    const { status } = await req('POST', '/auth/refresh', {
      raw: true,
      body: { refreshToken: ctx.rider2.refreshToken },
    });
    if (status < 400) throw new Error(`refresh still works (${status}) — deletion did not sign the phone out`);
    return String(status);
  });

  await check('the deleted phone can sign up again', async () => {
    const otp = await POST('/auth/request-otp', { phone: ctx.rider2.phone });
    const auth = await POST('/auth/verify-otp', { phone: ctx.rider2.phone, otp: otp._dev_otp });
    if (!auth.accessToken) throw new Error('no token');
    if (auth.user?.name) throw new Error(`the old name (${auth.user.name}) survived deletion`);
    return `isNewUser=${auth.isNewUser}`;
  });
}

main()
  .catch((e) => fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | ')))
  .finally(async () => {
    try { ctx.riderSock?.close(); } catch {}
    try { ctx.driverSock?.close(); } catch {}
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
