/**
 * ── "NOTIFY ME" ─────────────────────────────────────────────────────────────
 *
 * The browse page's empty state offers to tell a rider when a shared trip to
 * their destination opens. This suite proves the promise is kept:
 *
 *   1. create → refresh (same place) → list → validation → the 5-place cap
 *   2. delete is owner-only
 *   3. a driver publishing a matching trip claims the alert (exactly once)
 *   4. an alert whose pickup is across the country is NOT matched
 *
 * The push itself cannot be observed here (no device token), so the claim —
 * `notifiedAt` + `tripId` — is the evidence. It is written before the push.
 *
 *   node scripts/e2e/trip-alerts.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { section, check, summary, info, GET, POST, DEL, req, makeRider, makeDriver, ACCRA } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(path.join(here, '..', '..', 'eyego-api', 'package.json'));
apiRequire('dotenv').config({ path: path.join(here, '..', '..', 'eyego-api', '.env') });
const { PrismaClient } = apiRequire('@prisma/client');
const db = new PrismaClient();

const ctx = { trips: [] };
const KUMASI = { lat: 6.6885, lng: -1.6244 };
const alertOf = (r) => r.alert ?? r;

async function main() {
  ctx.rider = await makeRider('E2E Alert Rider');
  ctx.other = await makeRider('E2E Alert Other');

  section('create, refresh, list, cap');
  await check('a rider asks to hear about trips to Dansoman', async () => {
    const a = alertOf(await POST('/trips/alerts', {
      destinationName: 'Dansoman, Accra', destinationLat: ACCRA.dropoff.lat, destinationLng: ACCRA.dropoff.lng,
      originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng,
    }, { token: ctx.rider.token }));
    if (!a?.id) throw new Error(JSON.stringify(a).slice(0, 200));
    const hours = (new Date(a.expiresAt) - Date.now()) / 3.6e6;
    if (hours < 23 || hours > 24.1) throw new Error(`expires in ${hours.toFixed(1)} h, not 24`);
    ctx.alertId = a.id;
    return `alert ${a.id.slice(0, 8)} · ${hours.toFixed(1)} h`;
  });

  await check('asking again for the same place refreshes, it does not duplicate', async () => {
    const a = alertOf(await POST('/trips/alerts', {
      destinationName: 'Dansoman', destinationLat: ACCRA.dropoff.lat + 0.001, destinationLng: ACCRA.dropoff.lng,
      originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng,
    }, { token: ctx.rider.token }));
    if (a.id !== ctx.alertId) throw new Error('a second alert was created 100 m from the first');
    const { alerts } = await GET('/trips/alerts', { token: ctx.rider.token });
    if (alerts.length !== 1) throw new Error(`${alerts.length} open alerts`);
    return 'one alert';
  });

  await check('an alert with no destination is refused', async () => {
    const r = await req('POST', '/trips/alerts', { token: ctx.rider.token, raw: true, body: { destinationName: 'Nowhere' } });
    if (r.status !== 400) throw new Error(`${r.status}`);
    return '400';
  });

  await check('a sixth place is refused with a reason', async () => {
    ctx.extra = [];
    for (let i = 1; i <= 4; i += 1) {
      const a = alertOf(await POST('/trips/alerts', {
        destinationName: `Far place ${i}`, destinationLat: KUMASI.lat + i * 0.05, destinationLng: KUMASI.lng,
      }, { token: ctx.rider.token }));
      ctx.extra.push(a.id);
    }
    const r = await req('POST', '/trips/alerts', {
      token: ctx.rider.token, raw: true,
      body: { destinationName: 'One too many', destinationLat: KUMASI.lat + 0.5, destinationLng: KUMASI.lng },
    });
    if (r.status !== 409 || r.body?.code !== 'TOO_MANY_ALERTS') throw new Error(`${r.status} ${r.body?.code}`);
    return '409 TOO_MANY_ALERTS';
  });

  section('delete');
  await check('another rider cannot delete it', async () => {
    const r = await req('DELETE', `/trips/alerts/${ctx.extra[0]}`, { token: ctx.other.token, raw: true });
    if (r.status !== 404) throw new Error(`${r.status} — a stranger's delete was not refused`);
    return '404';
  });

  await check('the owner can, and the list shrinks', async () => {
    for (const id of ctx.extra) await DEL(`/trips/alerts/${id}`, { token: ctx.rider.token });
    const { alerts } = await GET('/trips/alerts', { token: ctx.rider.token });
    if (alerts.length !== 1 || alerts[0].id !== ctx.alertId) throw new Error(`${alerts.length} left`);
    return '1 left';
  });

  section('a matching trip claims the alert');
  await check('a pickup across the country does not match', async () => {
    const a = alertOf(await POST('/trips/alerts', {
      destinationName: 'Dansoman', destinationLat: ACCRA.dropoff.lat, destinationLng: ACCRA.dropoff.lng,
      originLat: KUMASI.lat, originLng: KUMASI.lng,
    }, { token: ctx.other.token }));
    ctx.farOriginId = a.id;
    return a.id.slice(0, 8);
  });

  await check('a driver publishes Accra Central → Dansoman', async () => {
    ctx.driver = await makeDriver({ name: 'E2E Alert Driver', seaterCount: 14 });
    const r = await POST('/driver/trips', {
      originLat: ACCRA.pickup.lat, originLng: ACCRA.pickup.lng, originName: 'Accra Central',
      destLat: ACCRA.dropoff.lat, destLng: ACCRA.dropoff.lng, destinationName: 'Dansoman',
      departureTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      availableSeats: 10, tier: 'ECO',
    }, { token: ctx.driver.token, headers: { 'Idempotency-Key': 'e2e-alert-' + Date.now() } });
    const trip = r.trip ?? r;
    if (!trip?.id) throw new Error(JSON.stringify(r).slice(0, 200));
    ctx.trips.push(trip.id);
    return trip.id.slice(0, 8);
  });

  await check('the rider’s alert is claimed for that trip', async () => {
    // The match runs unawaited after the publish answers.
    let row;
    for (let i = 0; i < 20; i += 1) {
      row = await db.tripAlert.findUnique({ where: { id: ctx.alertId } });
      if (row?.notifiedAt) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!row?.notifiedAt) throw new Error('never claimed — a matching trip opened and nobody was told');
    if (row.tripId !== ctx.trips[0]) throw new Error(`claimed for ${row.tripId}`);
    const { alerts } = await GET('/trips/alerts', { token: ctx.rider.token });
    if (alerts.some((a) => a.id === ctx.alertId)) throw new Error('a used alert is still listed as open');
    return 'claimed, off the list';
  });

  await check('the far-pickup alert is still waiting', async () => {
    const row = await db.tripAlert.findUnique({ where: { id: ctx.farOriginId } });
    if (row?.notifiedAt) throw new Error('matched a trip whose pickup is 200 km from the rider');
    return 'not matched';
  });
}

main()
  .catch((e) => info(`harness crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`))
  .finally(async () => {
    for (const id of ctx.trips) {
      await POST(`/driver/trips/${id}/cancel`, { reason: 'e2e teardown' }, { token: ctx.driver.token }).catch(() => {});
    }
    for (const r of [ctx.rider, ctx.other]) if (r?.id) await db.tripAlert.deleteMany({ where: { userId: r.id } }).catch(() => {});
    await db.$disconnect().catch(() => {});
    process.exit(summary() ? 1 : 0);
  });
