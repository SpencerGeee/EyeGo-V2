/**
 * HOW MANY TIMES THE RIDE STORE WAKES A COMPONENT UP.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Nineteen components subscribed to `useRideStore()` with no selector. Zustand
 * without a selector notifies on EVERY `setState`, so each of those nineteen
 * re-rendered whenever any field changed — and two of the fields in that store
 * are `driverLocation` and `tripEta`, which change on every GPS frame for the
 * whole length of a trip.
 *
 * "This made it faster" is a claim. This is the measurement behind it, and it
 * runs against the REAL zustand and the REAL subscription semantics rather than
 * a model of them — the only thing simulated is the sequence of writes, which
 * is drawn from what the app actually does during one booking and one ride.
 *
 *   node scripts/bench/ride-store-renders.mjs
 *
 * It needs no device, no server and no build, so it can be re-run whenever
 * somebody wonders whether a new whole-store subscription matters.
 */
import { createStore } from 'zustand/vanilla';

/** The fields nineteen components were reading, and the two that never stop. */
function makeStore() {
  return createStore(() => ({
    origin: null,
    destination: null,
    selectedTrip: null,
    selectedSeat: null,
    activeBooking: null,
    driverLocation: null,
    tripEta: null,
    guestInfo: null,
    scheduledTime: null,
    pendingTripRequestId: null,
    selectedTier: null,
    computedFare: null,
    pendingPromoCode: null,
    requestSeatCount: 1,
    requestCoverAll: false,
    rideTier: 'ECO',
    doorstepPickup: null,
    heavyLoad: false,
  }));
}

/**
 * One realistic session: a rider picks a pickup and destination, steps the seat
 * count, chooses a tier, books — and then rides for eight minutes while the
 * driver's position streams in.
 *
 * The location cadence is the app's own: `useDriverLocation` reports on a
 * distance filter that works out to roughly one frame a second in traffic.
 */
function session() {
  const writes = [];
  const push = (field, value) => writes.push({ field, value });

  // ── booking ──
  push('origin', { lat: 5.6, lng: -0.18 });
  for (let i = 0; i < 6; i++) push('destination', { q: `search ${i}` }); // typing
  push('destination', { lat: 5.65, lng: -0.2 });
  push('rideTier', 'COMFORT');
  push('doorstepPickup', true);
  for (let i = 1; i <= 3; i++) push('requestSeatCount', i);            // stepper
  push('computedFare', 5239);
  push('selectedTrip', { id: 't1' });
  push('activeBooking', { id: 'b1' });

  // ── the ride: eight minutes of location frames, plus an ETA every 15s ──
  for (let s = 0; s < 8 * 60; s++) {
    push('driverLocation', { lat: 5.6 + s * 1e-5, lng: -0.18, heading: 90 });
    if (s % 15 === 0) push('tripEta', 8 - Math.floor(s / 60));
  }
  return writes;
}

/** The 19 sites, and the fields each one actually reads. */
const SUBSCRIBERS = [
  ['activity', ['pendingTripRequestId']],
  ['trips', ['activeBooking']],
  ['promotions', ['activeBooking', 'pendingPromoCode']],
  ['guest-selection', ['guestInfo']],
  ['reserve', ['selectedTrip', 'origin', 'destination']],
  ['cancel', ['selectedTrip']],
  ['chat', ['selectedTrip']],
  ['complete', ['activeBooking', 'selectedTrip']],
  ['dispute', ['selectedTrip']],
  ['invite', ['activeBooking', 'selectedTrip', 'computedFare', 'guestInfo']],
  ['payment', ['selectedTrip', 'selectedSeat', 'activeBooking', 'computedFare', 'pendingPromoCode', 'guestInfo']],
  ['rate-tip', ['activeBooking', 'selectedTrip']],
  ['seat', ['selectedTrip']],
  ['sos', ['driverLocation']],
  ['ride/[id]', ['selectedTrip', 'activeBooking', 'origin', 'destination', 'computedFare', 'guestInfo']],
  ['RequestStage', ['origin', 'destination', 'requestSeatCount', 'requestCoverAll']],
  ['SearchStage', ['origin']],
  ['SelectStage', ['origin', 'destination', 'guestInfo', 'scheduledTime']],
  ['TripStatusListener', ['activeBooking', 'selectedTrip']],
];

function run() {
  const writes = session();

  // ── BEFORE: no selector. Zustand notifies on every setState. ──
  const a = makeStore();
  let whole = 0;
  const offA = [];
  for (let i = 0; i < SUBSCRIBERS.length; i++) offA.push(a.subscribe(() => { whole++; }));
  for (const w of writes) a.setState({ [w.field]: w.value });
  offA.forEach((f) => f());

  // ── AFTER: a selector per subscriber, comparing only what it reads. ──
  const b = makeStore();
  let selected = 0;
  const offB = [];
  for (const [, fields] of SUBSCRIBERS) {
    let prev = fields.map((f) => b.getState()[f]);
    offB.push(
      b.subscribe((state) => {
        const next = fields.map((f) => state[f]);
        if (next.some((v, i) => v !== prev[i])) {
          prev = next;
          selected++;
        }
      }),
    );
  }
  for (const w of writes) b.setState({ [w.field]: w.value });
  offB.forEach((f) => f());

  const drop = (100 * (whole - selected)) / whole;
  console.log('');
  console.log('  RIDE STORE — component wake-ups over one booking + an 8-minute ride');
  console.log('  ' + '─'.repeat(66));
  console.log(`  store writes in the session        ${writes.length}`);
  console.log(`  subscribing components             ${SUBSCRIBERS.length}`);
  console.log('');
  console.log(`  BEFORE  useRideStore()             ${whole.toLocaleString()} re-renders`);
  console.log(`  AFTER   useRideStore(selector)     ${selected.toLocaleString()} re-renders`);
  console.log(`  removed                            ${(whole - selected).toLocaleString()}  (${drop.toFixed(1)}%)`);
  console.log('');
  console.log('  Of the subscribers, exactly one reads driverLocation. The other');
  console.log('  eighteen were being woken by every GPS frame for the whole ride.');
  console.log('');
  return { whole, selected };
}

run();
