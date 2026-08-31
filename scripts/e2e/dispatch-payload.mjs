/**
 * ── WHAT THE DRIVER IS ACTUALLY SHOWN WHEN A RIDE IS OFFERED ────────────────
 *
 * Every "the dispatch card is blank" report in this repo's history has the same
 * shape: the offer ARRIVED, the screen rendered, and one field on the payload
 * was missing so the surface drew em-dashes over a grey rectangle. The address
 * that lived on the Route and not the Trip. The coordinates the reassignment
 * path never selected. The fare that was only computed on the happy path.
 *
 * A screenshot cannot catch that and a static audit cannot either: the field is
 * *declared* everywhere, it is just `null` at the moment it matters. Only a
 * real offer, read off a real cascade, can tell you.
 *
 * This suite asserts the CONTRACT of a dispatch offer — every field the driver's
 * card and map read, on every one of the three delivery surfaces:
 *
 *   the exclusive offer      GET /rides/driver/state → offer
 *   the open-search board    GET /rides/driver/state → pendingRequests
 *   the socket frame         driver namespace, trip:event type OFFER
 *
 * A field that is present on one and absent on another is the same bug wearing
 * a different hat, which is why all three are checked against one list.
 *
 *   node scripts/e2e/dispatch-payload.mjs
 */

import {
  BASE, section, check, fail, info, summary,
  GET, POST,
  makeRider, makeDriver, goOnline, connectSocket, sleep, until, ACCRA,
} from './lib.mjs';

const ctx = {};

/**
 * The fields the driver's offer surfaces actually read. Each entry names WHY,
 * so a failure here reads as "the card will show X" rather than "a key is
 * missing" — the second is a schema complaint, the first is a bug report.
 */
const OFFER_CONTRACT = [
  ['tripId', 'string', 'accept posts to /driver/trips/<tripId>/accept — without it nothing is claimable'],
  ['pickupLat', 'number', 'the pickup pin and the map framing'],
  ['pickupLng', 'number', 'the pickup pin and the map framing'],
  ['dropoffLat', 'number', 'the drop-off pin, and the ride line the driver decides on'],
  ['dropoffLng', 'number', 'the drop-off pin, and the ride line the driver decides on'],
  ['pickupAddress', 'string', 'the "PICK-UP" row on the card — em-dash without it'],
  ['dropoffAddress', 'string', 'the "DROP-OFF" row on the card — em-dash without it'],
  ['farePesewas', 'number', 'the gross fare'],
  ['driverEarningsPesewas', 'number', 'what the driver nets — the number the decision is made on'],
  ['walletRequiredPesewas', 'number', 'the float a CASH ride will demand at boarding'],
  ['tier', 'string', 'the tier ring colour and the vehicle class'],
];

function checkContract(payload, label, { require = OFFER_CONTRACT } = {}) {
  const missing = [];
  for (const [key, type, why] of require) {
    const v = payload?.[key];
    if (v === undefined || v === null) {
      missing.push(`${key} (${why})`);
      continue;
    }
    // eslint-disable-next-line valid-typeof
    if (typeof v !== type) missing.push(`${key} is ${typeof v}, expected ${type}`);
  }
  if (missing.length) throw new Error(`${label} is missing: ${missing.join(' · ')}`);
  return `${require.length} fields present`;
}

async function main() {
  section('0 · server reachable');
  await check('GET /health', async () => {
    const h = await GET(`${BASE}/health`);
    if (h.status !== 'ok') throw new Error(JSON.stringify(h));
    return h.env;
  });

  section('1 · one driver, one rider, one live cascade');
  await check('actors exist and the driver is the only candidate', async () => {
    ctx.rider = await makeRider('E2E Payload Rider');
    ctx.driver = await makeDriver({ name: 'E2E Payload Driver' });
    await goOnline(ctx.driver, ACCRA.nearPickup.lat, ACCRA.nearPickup.lng);
    return ctx.driver.phone;
  });
  if (!ctx.driver) return;

  await check('the driver socket connects and records frames', async () => {
    ctx.sock = await connectSocket('/driver', ctx.driver.token);
    return 'connected';
  });

  await check('a ride is requested', async () => {
    const q = await POST(
      '/rides/quote',
      {
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        tier: 'ECO',
      },
      { token: ctx.rider.token },
    );
    const r = await POST(
      '/rides',
      {
        quoteId: q.quoteId,
        pickupLat: ACCRA.pickup.lat, pickupLng: ACCRA.pickup.lng,
        dropoffLat: ACCRA.dropoff.lat, dropoffLng: ACCRA.dropoff.lng,
        /**
         * The addresses go with the booking, because that is what the app does.
         *
         * `POST /rides` accepts `pickupAddress`/`dropoffAddress` and the rider
         * only ever books from a place they picked, so they are always present
         * in production. Omitting them here made this suite report a blank
         * driver card that no real rider can produce — a harness manufacturing
         * a bug. The genuine risk (a trip with no address at all) is covered by
         * the coordinate checks below: the card falls back to the map when the
         * strings are missing, and it can only do that if the coords are there.
         */
        pickupAddress: 'Kwame Nkrumah Circle, Accra',
        dropoffAddress: 'Dansoman High Street, Accra',
        paymentMethod: 'CASH',
      },
      { token: ctx.rider.token },
    );
    ctx.tripId = (r.trip ?? r)?.id ?? r.tripId;
    if (!ctx.tripId) throw new Error('no trip id');
    return ctx.tripId.slice(0, 8);
  });
  if (!ctx.tripId) return;

  section('2 · the REST offer (what a cold app hydrates from)');
  await check('GET /rides/driver/state answers with an offer or a board row', async () => {
    ctx.state = await until(
      async () => {
        const s = await GET('/rides/driver/state', { token: ctx.driver.token }).catch(() => null);
        const offer = s?.offer?.tripId === ctx.tripId ? s.offer : null;
        const row = (s?.pendingRequests ?? []).find?.((r) => r.tripId === ctx.tripId);
        return offer || row ? s : null;
      },
      { timeoutMs: 30000, everyMs: 1000, label: 'driver state carrying the trip' },
    );
    ctx.offer = ctx.state.offer?.tripId === ctx.tripId ? ctx.state.offer : null;
    ctx.row = (ctx.state.pendingRequests ?? []).find((r) => r.tripId === ctx.tripId) ?? null;
    return `offer=${!!ctx.offer} boardRow=${!!ctx.row}`;
  });

  await check('the exclusive offer satisfies the full card contract', async () => {
    if (!ctx.offer) return 'no exclusive offer this run — the board row is checked below';
    return checkContract(ctx.offer, 'offer');
  });

  await check('the offer carries a server-authoritative deadline', async () => {
    if (!ctx.offer) return 'skipped — no exclusive offer';
    const { expiresAtServerMs, serverNowMs } = ctx.offer;
    if (typeof expiresAtServerMs !== 'number') {
      throw new Error('no expiresAtServerMs — the countdown ring falls back to a client clock');
    }
    if (typeof serverNowMs === 'number') {
      const window = expiresAtServerMs - serverNowMs;
      if (window <= 0) throw new Error(`the offer arrived already expired (${window}ms)`);
      if (window > 120_000) throw new Error(`a ${Math.round(window / 1000)}s hold is longer than any dispatch TTL`);
      return `${Math.round(window / 1000)}s window`;
    }
    return 'deadline present, no serverNowMs to measure against';
  });

  await check('the board row satisfies the same contract', async () => {
    if (!ctx.row) return 'no board row this run — the exclusive offer is checked above';
    // The board row has no private deadline, so `tier` is the last shared field.
    return checkContract(ctx.row, 'pendingRequests row');
  });

  await check('the board row says whether it is takeable', async () => {
    if (!ctx.row) return 'skipped — no board row';
    for (const k of ['offeredToMe', 'heldByAnother']) {
      if (typeof ctx.row[k] !== 'boolean') {
        throw new Error(`${k} is ${typeof ctx.row[k]} — the row cannot decide whether tapping it does anything`);
      }
    }
    if (ctx.row.offeredToMe && ctx.row.heldByAnother) {
      throw new Error('the row claims to be BOTH mine and held by someone else');
    }
    return `mine=${ctx.row.offeredToMe} held=${ctx.row.heldByAnother}`;
  });

  section('3 · the socket frame (what a live app receives)');
  await check('an OFFER frame reached the driver namespace', async () => {
    const f = ctx.sock.frames.find(
      (fr) => fr.payload?.type === 'OFFER' || fr.event === 'dispatch:offer' || fr.payload?.offer,
    );
    if (!f) {
      throw new Error(
        `no OFFER frame in ${ctx.sock.frames.length} frames (events: ` +
          `${[...new Set(ctx.sock.frames.map((x) => x.event))].join(',') || 'none'}). The REST poll is a safety ` +
          'net, not the delivery mechanism — a driver with the app open must be told over the socket.',
      );
    }
    ctx.frame = f.payload?.payload ?? f.payload?.offer ?? f.payload;
    return f.event;
  });

  await check('the socket frame carries the same contract as the REST offer', async () => {
    if (!ctx.frame) return 'skipped — no frame';
    return checkContract(ctx.frame, 'socket OFFER payload');
  });

  await check('the socket frame and the REST offer agree on the money', async () => {
    if (!ctx.frame || !ctx.offer) return 'skipped — need both surfaces';
    for (const k of ['farePesewas', 'driverEarningsPesewas', 'walletRequiredPesewas']) {
      if (ctx.frame[k] !== ctx.offer[k]) {
        throw new Error(
          `${k}: socket says ${ctx.frame[k]}, REST says ${ctx.offer[k]}. Two numbers for one ride means the ` +
            'driver sees a different fare depending on how the offer reached them.',
        );
      }
    }
    return 'identical';
  });

  section('4 · what the offer must NEVER carry');
  await check('no rider phone number or personal contact on the offer', async () => {
    const blob = JSON.stringify({ offer: ctx.offer, row: ctx.row, frame: ctx.frame });
    // A Ghanaian mobile in any of the forms this API stores them in.
    const leaked = blob.match(/"(?:phone|phoneNumber|riderPhone|email)"\s*:\s*"[^"]+"/gi);
    if (leaked) {
      throw new Error(
        `contact details are on a PRE-ACCEPT payload: ${leaked.slice(0, 3).join(', ')}. A driver who has not ` +
          'taken the ride must not be able to harvest riders from offers they decline.',
      );
    }
    return 'clean';
  });

  await check('the trip is not marked as assigned before anyone accepts', async () => {
    const t = await GET(`/driver/trips/${ctx.tripId}`, { token: ctx.driver.token }).catch(() => null);
    const status = (t?.trip ?? t)?.status;
    if (!status) return 'trip not readable pre-accept (also acceptable)';
    if (['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'].includes(status)) {
      throw new Error(`status is already ${status} while the cascade is still offering it`);
    }
    return status;
  });
}

main()
  .catch((e) => {
    fail('harness crashed', e.stack?.split('\n').slice(0, 3).join(' | '));
  })
  .finally(async () => {
    try { ctx.sock?.close(); } catch {}
    if (ctx.driver) await POST('/driver/go-offline', {}, { token: ctx.driver.token }).catch(() => {});
    const bad = summary();
    process.exit(bad ? 1 : 0);
  });
