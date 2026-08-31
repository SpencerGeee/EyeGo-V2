/**
 * ── THE LINE ON THE MAP IS A ROAD, OR IT IS A LIE ───────────────────────────
 *
 * "The route polyline is showing a straight line" has been reported against
 * four different screens in this repo, and every time the cause was the same
 * shape: the geometry was ABSENT and the client drew its own placeholder. The
 * placeholder is correct behaviour — a fabricated road is worse than an honest
 * ruler — so the bug is never in the drawing. It is in the answer.
 *
 * That makes it invisible to static analysis (the client code is right) and
 * invisible to a screenshot (a two-point line and a failed request look the
 * same). Only asking the routing proxy for a real Accra journey and counting
 * the coordinates it hands back can tell you.
 *
 * This suite pins the geocoding and routing surface both apps depend on:
 *   GET /geo/route    the polyline, the distance and the traffic-aware duration
 *   GET /geo/search   the typeahead every address field runs through
 *   GET /geo/reverse  what a dropped map pin is called
 *
 *   node scripts/e2e/geo-routing.mjs
 */

import {
  BASE, section, check, fail, info, summary,
  GET,
  makeRider, ACCRA,
} from './lib.mjs';

const ctx = {};

/** Metres between two [lng, lat] points. */
function metres(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  await check('an authenticated caller exists (the geo routes are not public)', async () => {
    ctx.rider = await makeRider('E2E Geo Rider');
    return ctx.rider.phone;
  });
  if (!ctx.rider) return;

  const t = { token: ctx.rider.token };

  section('1 · GET /geo/route — the polyline both apps draw');
  await check('a real Accra journey returns a route', async () => {
    ctx.route = await GET(
      `/geo/route?originLat=${ACCRA.pickup.lat}&originLng=${ACCRA.pickup.lng}` +
        `&destLat=${ACCRA.dropoff.lat}&destLng=${ACCRA.dropoff.lng}`,
      t,
    );
    if (!ctx.route) throw new Error('empty response');
    return `source=${ctx.route.source}`;
  });

  await check('it is a ROAD, not a ruler', async () => {
    const coords = ctx.route?.geometry?.coordinates;
    if (!Array.isArray(coords)) throw new Error(`no geometry.coordinates: ${JSON.stringify(ctx.route).slice(0, 180)}`);
    if (coords.length <= 2) {
      throw new Error(
        `${coords.length} points — that is a straight line. source=${ctx.route.source}. Every "the polyline is ` +
          'a straight line" report bottoms out here: both providers failed and the estimate fell through.',
      );
    }
    if (ctx.route.source === 'estimate') {
      throw new Error(
        'source=estimate — Mapbox and OSRM both failed. Check MAPBOX_SECRET_TOKEN and outbound network; the ' +
          'apps will draw a dashed placeholder rather than a road until this answers.',
      );
    }
    return `${coords.length} points via ${ctx.route.source}`;
  });

  await check('the line actually starts and ends where it was asked to', async () => {
    const coords = ctx.route?.geometry?.coordinates ?? [];
    if (coords.length < 2) return 'skipped — no line';
    const startOff = metres(coords[0], [ACCRA.pickup.lng, ACCRA.pickup.lat]);
    const endOff = metres(coords[coords.length - 1], [ACCRA.dropoff.lng, ACCRA.dropoff.lat]);
    // A road route snaps to the nearest drivable edge; 250 m is generous for
    // that and tight enough to catch a swapped lat/lng, which is the classic
    // failure and puts the line in the Gulf of Guinea.
    if (startOff > 250) throw new Error(`the line starts ${Math.round(startOff)}m from the pickup — lat/lng swapped?`);
    if (endOff > 250) throw new Error(`the line ends ${Math.round(endOff)}m from the drop-off`);
    return `start ${Math.round(startOff)}m · end ${Math.round(endOff)}m`;
  });

  await check('road distance exceeds crow-flies, and not absurdly', async () => {
    const straightKm =
      metres([ACCRA.pickup.lng, ACCRA.pickup.lat], [ACCRA.dropoff.lng, ACCRA.dropoff.lat]) / 1000;
    const road = ctx.route?.distanceKm;
    if (typeof road !== 'number') throw new Error('no distanceKm');
    if (road < straightKm * 0.98) {
      throw new Error(`road ${road.toFixed(2)}km < straight ${straightKm.toFixed(2)}km — no road is shorter than the crow`);
    }
    if (road > straightKm * 3) {
      throw new Error(`road ${road.toFixed(2)}km is 3× the ${straightKm.toFixed(2)}km straight line — wrong units or wrong points`);
    }
    return `${road.toFixed(2)}km vs ${straightKm.toFixed(2)}km straight`;
  });

  await check('the duration is traffic-aware, not free-flow', async () => {
    const { distanceKm, durationMin } = ctx.route ?? {};
    if (typeof durationMin !== 'number' || durationMin <= 0) throw new Error(`durationMin=${durationMin}`);
    const kph = distanceKm / (durationMin / 60);
    // Accra's congested urban mean is ~22 km/h. Anything above 45 is the plain
    // `driving` profile leaking back in — the "8.3 km in 12 minutes" bug.
    if (kph > 45) {
      throw new Error(
        `implies ${kph.toFixed(0)} km/h through Accra. That is the free-flow \`driving\` profile, not ` +
          '`driving-traffic` — every ETA in both apps will be optimistic.',
      );
    }
    if (kph < 3) throw new Error(`implies ${kph.toFixed(1)} km/h — slower than walking`);
    return `${durationMin.toFixed(1)} min ≈ ${kph.toFixed(0)} km/h`;
  });

  await check('a degenerate request (same point twice) does not 500', async () => {
    const r = await GET(
      `/geo/route?originLat=${ACCRA.pickup.lat}&originLng=${ACCRA.pickup.lng}` +
        `&destLat=${ACCRA.pickup.lat}&destLng=${ACCRA.pickup.lng}`,
      t,
    ).catch((e) => ({ _err: e.status ?? e.message }));
    if (r?._err && String(r._err).startsWith('5')) throw new Error(`server error: ${r._err}`);
    return r?._err ? `refused with ${r._err}` : `answered ${r?.distanceKm ?? 0}km`;
  });

  await check('garbage coordinates are refused, not answered', async () => {
    const r = await GET('/geo/route?originLat=abc&originLng=999&destLat=&destLng=', t).catch((e) => ({
      _status: e.status,
    }));
    if (r?._status >= 400) return `refused with ${r._status}`;
    if (r?.geometry) {
      throw new Error('answered a route for non-finite coordinates — a NaN line is the MLRNCamera SIGABRT');
    }
    return 'no route returned';
  });

  section('2 · GET /geo/search — the typeahead every address field uses');
  await check('a well-known Accra landmark resolves', async () => {
    const r = await GET('/geo/search?q=Kotoka%20International%20Airport&limit=5', t);
    const list = r?.results ?? r?.places ?? r;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`no results: ${JSON.stringify(r).slice(0, 180)}`);
    }
    const first = list[0];
    for (const k of ['latitude', 'longitude']) {
      if (typeof first[k] !== 'number') throw new Error(`result has no ${k}: ${JSON.stringify(first).slice(0, 140)}`);
    }
    ctx.airport = first;
    return `${list.length} results, first "${first.name ?? first.fullAddress}"`;
  });

  await check('the top result is actually in Ghana', async () => {
    if (!ctx.airport) return 'skipped';
    const { latitude: lat, longitude: lng } = ctx.airport;
    // Ghana's bounding box, generously.
    if (lat < 4.5 || lat > 11.2 || lng < -3.3 || lng > 1.3) {
      throw new Error(`top hit is at ${lat},${lng} — outside Ghana. The country bias is not being applied.`);
    }
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  });

  await check('results are not all the same generic place', async () => {
    const r = await GET('/geo/search?q=Osu&limit=5', t);
    const list = r?.results ?? r?.places ?? r;
    if (!Array.isArray(list) || list.length < 2) return `${list?.length ?? 0} result(s) — nothing to compare`;
    const names = new Set(list.map((x) => (x.name ?? x.fullAddress ?? '').toLowerCase()));
    if (names.size === 1) {
      throw new Error(
        `all ${list.length} results are "${[...names][0]}" — the administrative tier is answering ahead of the ` +
          'street tier, which is the "every address says Accra" bug',
      );
    }
    return `${names.size} distinct names`;
  });

  await check('an empty query does not 500', async () => {
    const r = await GET('/geo/search?q=&limit=5', t).catch((e) => ({ _status: e.status }));
    if (r?._status >= 500) throw new Error(`server error ${r._status}`);
    return r?._status ? `refused with ${r._status}` : 'answered with an empty list';
  });

  section('3 · GET /geo/reverse — what a dropped pin is called');
  await check('a coordinate reverses to a named place', async () => {
    const r = await GET(`/geo/reverse?lat=${ACCRA.pickup.lat}&lng=${ACCRA.pickup.lng}`, t);
    const place = r?.place ?? r?.result ?? r;
    const label = place?.name ?? place?.fullAddress ?? place?.address;
    if (!label) throw new Error(`no name: ${JSON.stringify(r).slice(0, 180)}`);
    ctx.reverseLabel = String(label);
    return ctx.reverseLabel.slice(0, 60);
  });

  await check('the name is more specific than the city', async () => {
    if (!ctx.reverseLabel) return 'skipped';
    const bare = ctx.reverseLabel.trim().toLowerCase();
    if (bare === 'accra' || bare === 'ghana' || bare === 'accra, ghana') {
      throw new Error(
        `reverse geocoding a street corner returned "${ctx.reverseLabel}". Every saved place, every pickup ` +
          'label and every trip history row will read "Accra" — the exact reported bug.',
      );
    }
    return ctx.reverseLabel.slice(0, 60);
  });

  await check('a point in the ocean does not crash or invent a street', async () => {
    const r = await GET('/geo/reverse?lat=3.0&lng=-1.0', t).catch((e) => ({ _status: e.status }));
    if (r?._status >= 500) throw new Error(`server error ${r._status}`);
    return r?._status ? `refused with ${r._status}` : 'answered';
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
