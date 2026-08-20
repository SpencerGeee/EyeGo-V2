'use strict';

/**
 * Fixture set for a full end-to-end pass over the admin console.
 *
 *   node prisma/seed-e2e-admin.js            # wipe previous e2e rows, insert fresh
 *   node prisma/seed-e2e-admin.js --keep     # insert without wiping
 *
 * WHY THIS EXISTS. Every console page is only as testable as the rows behind
 * it: an empty SOS queue and an empty SOS queue that is broken look identical.
 * This creates at least one row for every list, every filter value and every
 * moderation action the console can take, so a page that renders nothing is a
 * defect rather than an artefact of the database.
 *
 * Everything it writes carries an `e2e_` id prefix (or an `E2E` marker on the
 * unique columns that must stay human-shaped, like plate numbers), so a re-run
 * removes exactly what a previous run added and nothing an operator created.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const KEEP = process.argv.includes('--keep');

const P = 'e2e_';
const id = (s) => `${P}${s}`;

const now = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const ago = (ms) => new Date(now - ms);
const ahead = (ms) => new Date(now + ms);

/** Accra-area coordinates, so the fleet map has something plausible to draw. */
const ACCRA = { lat: 5.6037, lng: -0.187 };
const jitter = (base, spread = 0.06) => base + (Math.random() - 0.5) * spread;

const log = (m) => console.log(`  ${m}`);

// ── teardown ────────────────────────────────────────────────────────────────

/**
 * Order matters and is the reverse of creation: Postgres rejects a parent
 * delete while a child row still points at it, and Prisma will not infer the
 * order for us across this many tables.
 */
async function wipe() {
  const startsWith = { startsWith: P };
  const steps = [
    ['adminAuditLog', () => prisma.adminAuditLog.deleteMany({ where: { id: startsWith } })],
    // By PARENT, not by own id. Replies written during a test run through the
    // console get generated cuids, so an id-prefix match leaves them behind —
    // and a single orphan is enough for SupportTicket's RESTRICT foreign key to
    // block the ticket delete, which then blocks the user delete, which fails
    // the whole re-seed. Same reasoning for every child table below.
    ['ticketMessage', () => prisma.ticketMessage.deleteMany({ where: { ticketId: startsWith } })],
    ['supportTicket', () => prisma.supportTicket.deleteMany({ where: { OR: [{ id: startsWith }, { userId: startsWith }] } })],
    ['sosEvent', () => prisma.sosEvent.deleteMany({ where: { OR: [{ id: startsWith }, { tripId: startsWith }, { userId: startsWith }] } })],
    ['tripReport', () => prisma.tripReport.deleteMany({ where: { OR: [{ id: startsWith }, { tripId: startsWith }, { driverId: startsWith }] } })],
    ['driverRating', () => prisma.driverRating.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }, { userId: startsWith }] } })],
    ['passengerRating', () => prisma.passengerRating.deleteMany({ where: { id: startsWith } })],
    ['receipt', () => prisma.receipt.deleteMany({ where: { OR: [{ id: startsWith }, { bookingId: startsWith }, { userId: startsWith }] } })],
    ['driverReceipt', () => prisma.driverReceipt.deleteMany({ where: { id: startsWith } })],
    ['paymentTransaction', () => prisma.paymentTransaction.deleteMany({ where: { OR: [{ id: startsWith }, { bookingId: startsWith }, { userId: startsWith }] } })],
    ['walletTransaction', () => prisma.walletTransaction.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }] } })],
    ['riderWalletTransaction', () => prisma.riderWalletTransaction.deleteMany({ where: { OR: [{ id: startsWith }, { userId: startsWith }] } })],
    ['refund', () => prisma.refund.deleteMany({ where: { OR: [{ id: startsWith }, { userId: startsWith }, { bookingId: startsWith }] } })],
    ['adminNote', () => prisma.adminNote.deleteMany({ where: { OR: [{ id: startsWith }, { subjectId: startsWith }] } })],
    ['dispatchAction', () => prisma.dispatchAction.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }, { tripId: startsWith }] } })],
    ['onlineSession', () => prisma.onlineSession.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }] } })],
    ['tripEvent', () => prisma.tripEvent.deleteMany({ where: { OR: [{ id: startsWith }, { tripId: startsWith }] } })],
    ['booking', () => prisma.booking.deleteMany({ where: { OR: [{ id: startsWith }, { tripId: startsWith }, { userId: startsWith }] } })],
    ['trip', () => prisma.trip.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }, { requesterId: startsWith }, { routeId: startsWith }] } })],
    ['pulseSchedule', () => prisma.pulseSchedule.deleteMany({ where: { OR: [{ id: startsWith }, { routeId: startsWith }] } })],
    ['virtualStop', () => prisma.virtualStop.deleteMany({ where: { OR: [{ id: startsWith }, { routeId: startsWith }] } })],
    ['route', () => prisma.route.deleteMany({ where: { id: startsWith } })],
    ['vehicle', () => prisma.vehicle.deleteMany({ where: { OR: [{ id: startsWith }, { driverId: startsWith }] } })],
    ['driver', () => prisma.driver.deleteMany({ where: { id: startsWith } })],
    // Promotions created through the console during a run carry a cuid, so
    // match the code prefix the fixtures reserve as well as the id.
    ['promotion', () => prisma.promotion.deleteMany({ where: { OR: [{ id: startsWith }, { code: { startsWith: 'E2E' } }] } })],
    ['user', () => prisma.user.deleteMany({ where: { id: startsWith } })],
    ['adminUser', () => prisma.adminUser.deleteMany({ where: { OR: [{ id: startsWith }, { email: { startsWith: 'e2e.' } }] } })],
  ];
  for (const [name, run] of steps) {
    try {
      const r = await run();
      if (r.count) log(`removed ${r.count} ${name}`);
    } catch (e) {
      console.error(`  ! could not wipe ${name}: ${e.message}`);
    }
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const ROUTES = [
  {
    key: 'circle-madina',
    name: 'Circle → Madina',
    originName: 'Kwame Nkrumah Circle',
    destinationName: 'Madina Market',
    originLat: 5.5709, originLng: -0.2085,
    destLat: 5.6836, destLng: -0.1665,
    distanceKm: 15.4,
    stops: [
      ['Nima Junction', 5.5847, -0.1985],
      ['37 Military Hospital', 5.5901, -0.1872],
      ['Legon Main Gate', 5.6505, -0.1869],
    ],
  },
  {
    key: 'kaneshie-tema',
    name: 'Kaneshie → Tema Station',
    originName: 'Kaneshie Market',
    destinationName: 'Tema Station',
    originLat: 5.5641, originLng: -0.2325,
    destLat: 5.5478, destLng: -0.2005,
    distanceKm: 8.2,
    stops: [
      ['Obetsebi Lamptey', 5.5605, -0.2211],
      ['Korle Bu', 5.5364, -0.2249],
    ],
  },
  {
    key: 'airport-accramall',
    name: 'Airport City → Accra Mall',
    originName: 'Airport City',
    destinationName: 'Accra Mall',
    originLat: 5.6045, originLng: -0.1742,
    destLat: 5.6221, destLng: -0.1738,
    distanceKm: 4.6,
    stops: [['Shiashie', 5.6142, -0.1749]],
  },
];

const USERS = [
  { key: 'ama', name: 'Ama Boateng', phone: '+233201000001', email: 'ama.e2e@example.com', wallet: 4500 },
  { key: 'kofi', name: 'Kofi Mensah', phone: '+233201000002', email: 'kofi.e2e@example.com', wallet: 12000 },
  { key: 'akua', name: 'Akua Darko', phone: '+233201000003', email: 'akua.e2e@example.com', wallet: 0 },
  { key: 'yaw', name: 'Yaw Owusu', phone: '+233201000004', email: 'yaw.e2e@example.com', wallet: 800 },
  { key: 'esi', name: 'Esi Nkrumah', phone: '+233201000005', email: 'esi.e2e@example.com', wallet: 26000 },
  { key: 'kwame', name: 'Kwame Adjei', phone: '+233201000006', email: 'kwame.e2e@example.com', wallet: 300 },
  { key: 'abena', name: 'Abena Sarpong', phone: '+233201000007', email: 'abena.e2e@example.com', wallet: 7400 },
  {
    key: 'banned', name: 'Kojo Banned', phone: '+233201000008', email: 'kojo.e2e@example.com',
    wallet: 0, isBanned: true,
  },
  {
    key: 'biz', name: 'Naa Adjeley', phone: '+233201000009', email: 'naa.e2e@example.com',
    wallet: 55000, businessMode: true, businessCompanyName: 'Adjeley Consulting Ltd',
    businessTaxId: 'C0012345678', businessExpenseEmail: 'expenses.e2e@example.com',
  },
  { key: 'inactive', name: 'Deleted Account', phone: '+233201000010', wallet: 0, isActive: false },
];

const DRIVERS = [
  {
    key: 'kwesi', name: 'Kwesi Appiah', phone: '+233241000001', status: 'ACTIVE',
    isOnline: true, wallet: 34000, card: 'GHA-111111111-1',
    vehicle: { plate: 'GE-1001-E2E', make: 'Toyota', model: 'Hiace', year: 2019, seats: 14, tier: 'ECO', colour: 'White' },
  },
  {
    key: 'nana', name: 'Nana Yaa Asante', phone: '+233241000002', status: 'ACTIVE',
    isOnline: true, wallet: 18500, card: 'GHA-222222222-2',
    vehicle: { plate: 'GT-2002-E2E', make: 'Hyundai', model: 'Grand Starex', year: 2021, seats: 11, tier: 'COMFORT', colour: 'Silver' },
  },
  {
    key: 'ibrahim', name: 'Ibrahim Fuseini', phone: '+233241000003', status: 'ACTIVE',
    isOnline: true, wallet: 9100, card: 'GHA-333333333-3',
    vehicle: { plate: 'GR-3003-E2E', make: 'Mercedes-Benz', model: 'Sprinter', year: 2022, seats: 16, tier: 'PREMIUM', colour: 'Black' },
  },
  {
    key: 'selorm', name: 'Selorm Agbeko', phone: '+233241000004', status: 'ACTIVE',
    isOnline: false, wallet: 2200, card: 'GHA-444444444-4',
    vehicle: { plate: 'GW-4004-E2E', make: 'Nissan', model: 'Urvan', year: 2018, seats: 15, tier: 'ECO', colour: 'Blue' },
  },
  {
    key: 'pending1', name: 'Musah Alhassan', phone: '+233241000005', status: 'PENDING_REVIEW',
    isOnline: false, wallet: 0, card: 'GHA-555555555-5',
    docs: { GHANA_CARD: 'PENDING', DRIVERS_LICENSE: 'PENDING' },
    vehicle: { plate: 'GN-5005-E2E', make: 'Toyota', model: 'Hiace', year: 2017, seats: 14, tier: 'ECO', colour: 'Grey', verified: false },
  },
  {
    key: 'pending2', name: 'Comfort Owusu', phone: '+233241000006', status: 'PENDING_REVIEW',
    isOnline: false, wallet: 0, card: 'GHA-666666666-6',
    docs: { GHANA_CARD: 'VERIFIED', DRIVERS_LICENSE: 'PENDING' },
    vehicle: { plate: 'GS-6006-E2E', make: 'Kia', model: 'Carnival', year: 2020, seats: 11, tier: 'COMFORT', colour: 'Red', verified: false },
  },
  {
    key: 'pending3', name: 'Daniel Tetteh', phone: '+233241000007', status: 'PENDING_REVIEW',
    isOnline: false, wallet: 0, card: 'GHA-777777777-7',
    docs: { GHANA_CARD: 'REJECTED', DRIVERS_LICENSE: 'VERIFIED', GHANA_CARDReason: 'Photo is blurred — resubmit' },
    vehicle: { plate: 'GC-7007-E2E', make: 'Toyota', model: 'Coaster', year: 2016, seats: 22, tier: 'ECO', colour: 'Yellow', verified: false },
  },
  {
    key: 'suspended', name: 'Felix Adom', phone: '+233241000008', status: 'SUSPENDED',
    isOnline: false, wallet: 1500, card: 'GHA-888888888-8',
    vehicle: { plate: 'GX-8008-E2E', make: 'Toyota', model: 'Hiace', year: 2015, seats: 14, tier: 'ECO', colour: 'Green' },
  },
  {
    key: 'rejected', name: 'Solomon Baidoo', phone: '+233241000009', status: 'REJECTED',
    rejectionReason: 'Licence expired and not renewed within 30 days',
    isOnline: false, wallet: 0, card: 'GHA-999999999-9',
  },
];

const TIER_FARES = {
  ECO: { base: 500, perKm: 300 },
  COMFORT: { base: 800, perKm: 420 },
  PREMIUM: { base: 1200, perKm: 550 },
};

/**
 * One trip per status the state machine can hold, plus a completed-trip tail
 * spread across the last 30 days so revenue and analytics have a curve to draw
 * rather than a single spike.
 */
const TRIP_PLAN = [
  { key: 'req1', status: 'REQUESTED', driver: null, route: 'airport-accramall', tier: 'ECO', minsAgo: 2 },
  { key: 'match1', status: 'MATCHING', driver: null, route: 'circle-madina', tier: 'COMFORT', minsAgo: 4 },
  { key: 'sched1', status: 'SCHEDULED', driver: 'selorm', route: 'circle-madina', tier: 'ECO', minsAhead: 180 },
  { key: 'fill1', status: 'FILLING', driver: 'kwesi', route: 'kaneshie-tema', tier: 'ECO', minsAhead: 45 },
  { key: 'conf1', status: 'CONFIRMED', driver: 'nana', route: 'circle-madina', tier: 'COMFORT', minsAhead: 25 },
  { key: 'assign1', status: 'DRIVER_ASSIGNED', driver: 'kwesi', route: 'airport-accramall', tier: 'ECO', minsAgo: 6 },
  { key: 'reassign1', status: 'REASSIGNING', driver: null, route: 'kaneshie-tema', tier: 'COMFORT', minsAgo: 8 },
  { key: 'enroute1', status: 'DRIVER_EN_ROUTE', driver: 'nana', route: 'circle-madina', tier: 'COMFORT', minsAgo: 10 },
  { key: 'arrived1', status: 'ARRIVED_AT_PICKUP', driver: 'ibrahim', route: 'airport-accramall', tier: 'PREMIUM', minsAgo: 12 },
  { key: 'prog1', status: 'IN_PROGRESS', driver: 'kwesi', route: 'kaneshie-tema', tier: 'ECO', minsAgo: 22 },
  { key: 'prog2', status: 'IN_PROGRESS', driver: 'ibrahim', route: 'circle-madina', tier: 'PREMIUM', minsAgo: 35 },
  { key: 'cancel1', status: 'CANCELLED', driver: 'selorm', route: 'circle-madina', tier: 'ECO', minsAgo: 400, cancelledBy: 'RIDER', reason: 'Rider changed plans' },
  { key: 'cancel2', status: 'CANCELLED', driver: null, route: 'kaneshie-tema', tier: 'COMFORT', minsAgo: 900, cancelledBy: 'DRIVER', reason: 'Vehicle breakdown' },
  { key: 'nodrv1', status: 'NO_DRIVERS_FOUND', driver: null, route: 'airport-accramall', tier: 'PREMIUM', minsAgo: 300 },
  { key: 'exp1', status: 'EXPIRED', driver: null, route: 'kaneshie-tema', tier: 'ECO', minsAgo: 1500 },
  { key: 'noshow1', status: 'NO_SHOW', driver: 'selorm', route: 'circle-madina', tier: 'ECO', minsAgo: 2000 },
];

// ── build ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── EyeGo admin E2E fixtures ─────────────────────────────\n');

  if (!KEEP) {
    log('clearing previous e2e rows');
    await wipe();
  }

  // Routes + stops ----------------------------------------------------------
  for (const r of ROUTES) {
    await prisma.route.create({
      data: {
        id: id(`route_${r.key}`),
        name: r.name,
        originName: r.originName,
        destinationName: r.destinationName,
        originLat: r.originLat, originLng: r.originLng,
        destLat: r.destLat, destLng: r.destLng,
        distanceKm: r.distanceKm,
        isActive: true,
        isAdHoc: false,
      },
    });
    let seq = 1;
    for (const [name, lat, lng] of r.stops) {
      await prisma.virtualStop.create({
        data: { id: id(`stop_${r.key}_${seq}`), routeId: id(`route_${r.key}`), name, lat, lng, sequence: seq, isActive: true },
      });
      seq += 1;
    }
  }
  log(`${ROUTES.length} routes + stops`);

  // Users -------------------------------------------------------------------
  for (const u of USERS) {
    await prisma.user.create({
      data: {
        id: id(`user_${u.key}`),
        name: u.name,
        phone: u.phone,
        email: u.email ?? null,
        walletBalancePesewas: u.wallet ?? 0,
        isBanned: u.isBanned ?? false,
        isActive: u.isActive ?? true,
        businessMode: u.businessMode ?? false,
        businessCompanyName: u.businessCompanyName ?? null,
        businessTaxId: u.businessTaxId ?? null,
        businessExpenseEmail: u.businessExpenseEmail ?? null,
        preferredTier: 'ECO',
        createdAt: ago(Math.floor(Math.random() * 60) * DAY),
      },
    });
  }
  // An opening ledger row for every funded rider.
  //
  // Without this the wallet reconciles as DRIFTED: the balance column says
  // GH₵74 and the ledger explains none of it, which is exactly the condition
  // `riderWallet.reconcile()` exists to catch. Seeding a balance straight onto
  // the column and no row is the same mistake the ledger was built to stop, so
  // the fixtures must not make it either.
  for (const u of USERS.filter((x) => (x.wallet ?? 0) > 0)) {
    await prisma.riderWalletTransaction.create({
      data: {
        id: id(`rwtx_open_${u.key}`),
        userId: id(`user_${u.key}`),
        type: 'TOPUP',
        amountPesewas: u.wallet,
        description: 'Opening balance (fixture)',
        balanceBeforePesewas: 0,
        balanceAfterPesewas: u.wallet,
        createdAt: ago(30 * DAY),
      },
    });
  }
  log(`${USERS.length} users (1 banned, 1 deactivated, 1 business) + opening wallet ledger`);

  // Drivers + vehicles ------------------------------------------------------
  for (const d of DRIVERS) {
    const online = d.isOnline;
    await prisma.driver.create({
      data: {
        id: id(`driver_${d.key}`),
        name: d.name,
        phone: d.phone,
        status: d.status,
        rejectionReason: d.rejectionReason ?? null,
        isOnline: online,
        ghanaCardNumber: d.card ?? null,
        // Placeholder image hosts, not Cloudinary: the console only ever renders
        // these in an <img>, and a real upload is not what this pass is testing.
        ghanaCardPhoto: d.card ? `https://placehold.co/640x400/png?text=Ghana+Card+${encodeURIComponent(d.name)}` : null,
        licensePhoto: d.card ? `https://placehold.co/640x400/png?text=Licence+${encodeURIComponent(d.name)}` : null,
        profilePhoto: `https://placehold.co/200x200/png?text=${encodeURIComponent(d.name.split(' ')[0])}`,
        documentReview: d.docs ? JSON.stringify(buildDocReview(d.docs)) : null,
        currentLat: online ? jitter(ACCRA.lat) : null,
        currentLng: online ? jitter(ACCRA.lng) : null,
        currentHeading: online ? Math.floor(Math.random() * 360) : null,
        walletBalancePesewas: d.wallet ?? 0,
        payoutData: JSON.stringify({ type: 'mobile_money', provider: 'MTN', number: d.phone, name: d.name }),
        createdAt: ago(Math.floor(Math.random() * 90) * DAY),
      },
    });

    if (d.vehicle) {
      const v = d.vehicle;
      await prisma.vehicle.create({
        data: {
          id: id(`vehicle_${d.key}`),
          driverId: id(`driver_${d.key}`),
          plateNumber: v.plate,
          make: v.make, model: v.model, year: v.year,
          seaterCount: v.seats, tier: v.tier, colour: v.colour,
          frontPhoto: `https://placehold.co/640x400/png?text=${encodeURIComponent(v.make + ' front')}`,
          rearPhoto: `https://placehold.co/640x400/png?text=${encodeURIComponent(v.make + ' rear')}`,
          interiorPhoto: `https://placehold.co/640x400/png?text=Interior`,
          isVerified: v.verified ?? true,
          isActive: true,
        },
      });
    }
  }
  log(`${DRIVERS.length} drivers (3 pending review, 1 suspended, 1 rejected) + vehicles`);

  // Online sessions + dispatch actions --------------------------------------
  let n = 0;
  for (const d of DRIVERS.filter((x) => x.status === 'ACTIVE')) {
    for (let i = 0; i < 6; i += 1) {
      const start = ago((i + 1) * DAY + 8 * HOUR);
      await prisma.onlineSession.create({
        data: {
          id: id(`session_${d.key}_${i}`),
          driverId: id(`driver_${d.key}`),
          startTime: start,
          endTime: i === 0 && d.isOnline ? null : new Date(start.getTime() + (4 + Math.random() * 5) * HOUR),
        },
      });
      n += 1;
    }
  }
  log(`${n} online sessions`);

  // Trips, bookings and the money that follows them --------------------------
  const created = { trips: 0, bookings: 0, receipts: 0, payments: 0 };

  for (const t of TRIP_PLAN) {
    await makeTrip(t, created);
  }

  // Completed history: 30 days of finished trips so revenue/analytics curve.
  const activeDrivers = DRIVERS.filter((d) => d.status === 'ACTIVE');
  const routeKeys = ROUTES.map((r) => r.key);
  for (let i = 0; i < 45; i += 1) {
    const d = activeDrivers[i % activeDrivers.length];
    await makeTrip(
      {
        key: `done${i}`,
        status: 'COMPLETED',
        driver: d.key,
        route: routeKeys[i % routeKeys.length],
        tier: d.vehicle.tier,
        minsAgo: Math.floor((i / 45) * 30 * 24 * 60) + 60 + Math.floor(Math.random() * 600),
        seats: 2 + (i % 5),
      },
      created,
    );
  }
  log(`${created.trips} trips, ${created.bookings} bookings, ${created.receipts} receipts, ${created.payments} payment transactions`);

  // Driver wallet ledger ----------------------------------------------------
  n = 0;
  for (const d of DRIVERS.filter((x) => x.wallet > 0)) {
    let balance = 0;
    const rows = [
      { type: 'TOPUP', amount: 20000, desc: 'Wallet top-up (MTN MoMo)' },
      { type: 'COMMISSION', amount: -3400, desc: 'Platform commission — trip settlement' },
      { type: 'EARNING', amount: 12600, desc: 'Trip earnings' },
      { type: 'WITHDRAWAL', amount: -8000, desc: 'Withdrawal to MTN MoMo' },
    ];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const before = balance;
      balance += r.amount;
      await prisma.walletTransaction.create({
        data: {
          id: id(`wtx_${d.key}_${i}`),
          driverId: id(`driver_${d.key}`),
          type: r.type,
          amountPesewas: r.amount,
          description: r.desc,
          balanceBeforePesewas: before,
          balanceAfterPesewas: balance,
          createdAt: ago((rows.length - i) * DAY),
        },
      });
      n += 1;
    }
  }
  log(`${n} wallet transactions`);

  // SOS ---------------------------------------------------------------------
  const sosTrips = ['prog1', 'prog2', 'enroute1', 'done3', 'done7'];
  for (let i = 0; i < sosTrips.length; i += 1) {
    await prisma.sosEvent.create({
      data: {
        id: id(`sos_${i}`),
        tripId: id(`trip_${sosTrips[i]}`),
        userId: id(`user_${USERS[i % USERS.length].key}`),
        lat: jitter(ACCRA.lat), lng: jitter(ACCRA.lng),
        // First three open, last two already handled — the queue needs both.
        resolvedAt: i < 3 ? null : ago(i * HOUR),
        createdAt: ago(i * 40 * MIN + 5 * MIN),
      },
    });
  }
  log(`${sosTrips.length} SOS events (3 open, 2 resolved)`);

  // Trip reports ------------------------------------------------------------
  const reports = [
    { trip: 'done1', driver: 'kwesi', user: 'ama', type: 'PASSENGER_NO_SHOW', status: 'OPEN', details: 'Passenger never boarded at Nima Junction.' },
    { trip: 'done2', driver: 'nana', user: 'kofi', type: 'ABUSIVE_BEHAVIOUR', status: 'OPEN', details: 'Passenger was verbally abusive to other riders.' },
    { trip: 'done5', driver: 'ibrahim', user: 'akua', type: 'DAMAGE', status: 'OPEN', details: 'Seat cover torn; requesting repair contribution.' },
    { trip: 'done9', driver: 'kwesi', user: 'yaw', type: 'PAYMENT_DISPUTE', status: 'RESOLVED', details: 'Cash short by GHS 5.', resolved: true },
    { trip: 'noshow1', driver: 'selorm', user: 'esi', type: 'PASSENGER_NO_SHOW', status: 'RESOLVED', details: 'No-show confirmed; fee retained.', resolved: true },
  ];
  for (let i = 0; i < reports.length; i += 1) {
    const r = reports[i];
    await prisma.tripReport.create({
      data: {
        id: id(`report_${i}`),
        tripId: id(`trip_${r.trip}`),
        driverId: id(`driver_${r.driver}`),
        reportedUserId: id(`user_${r.user}`),
        type: r.type,
        details: r.details,
        status: r.status,
        resolvedAt: r.resolved ? ago(i * HOUR) : null,
        createdAt: ago((i + 1) * 6 * HOUR),
      },
    });
  }
  log(`${reports.length} trip reports (3 open, 2 resolved)`);

  // Support tickets ---------------------------------------------------------
  const tickets = [
    { user: 'ama', subject: 'Charged twice for one booking', status: 'OPEN', priority: 'HIGH', category: 'PAYMENT' },
    { user: 'kofi', subject: 'Driver took a longer route', status: 'OPEN', priority: 'NORMAL', category: 'TRIP' },
    { user: 'akua', subject: 'Cannot add my MTN MoMo number', status: 'OPEN', priority: 'NORMAL', category: 'ACCOUNT' },
    { user: 'yaw', subject: 'Lost phone in the van', status: 'OPEN', priority: 'URGENT', category: 'SAFETY' },
    { user: 'esi', subject: 'Refund for cancelled ride', status: 'CLOSED', priority: 'NORMAL', category: 'PAYMENT' },
    { user: 'abena', subject: 'App crashes on the map screen', status: 'CLOSED', priority: 'LOW', category: 'TECHNICAL' },
  ];
  for (let i = 0; i < tickets.length; i += 1) {
    const t = tickets[i];
    await prisma.supportTicket.create({
      data: {
        id: id(`ticket_${i}`),
        userId: id(`user_${t.user}`),
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        createdAt: ago((i + 1) * 5 * HOUR),
      },
    });
    await prisma.ticketMessage.create({
      data: {
        id: id(`tmsg_${i}_0`),
        ticketId: id(`ticket_${i}`),
        senderId: id(`user_${t.user}`),
        senderRole: 'USER',
        text: `${t.subject}. Please look into this — it happened on my last trip.`,
        createdAt: ago((i + 1) * 5 * HOUR),
      },
    });
    if (t.status === 'CLOSED') {
      await prisma.ticketMessage.create({
        data: {
          id: id(`tmsg_${i}_1`),
          ticketId: id(`ticket_${i}`),
          senderId: 'admin',
          senderRole: 'ADMIN',
          text: 'Resolved — the amount has been returned to your wallet. Thank you for your patience.',
          createdAt: ago((i + 1) * 4 * HOUR),
        },
      });
    }
  }
  log(`${tickets.length} support tickets (4 open, 2 closed) with messages`);

  // Promotions --------------------------------------------------------------
  const promos = [
    { code: 'E2EWELCOME', pct: 20, cap: 1000, active: true, uses: 143, max: 1000, days: 30 },
    { code: 'E2EWEEKEND', pct: 15, cap: 800, active: true, uses: 62, max: null, days: 7 },
    { code: 'E2ESTUDENT', pct: 25, cap: 1500, active: false, uses: 890, max: 900, days: 60 },
    { code: 'E2EEXPIRED', pct: 50, cap: 2500, active: true, uses: 500, max: 500, days: -3 },
  ];
  for (let i = 0; i < promos.length; i += 1) {
    const p = promos[i];
    await prisma.promotion.create({
      data: {
        id: id(`promo_${i}`),
        code: p.code,
        discountPercent: p.pct,
        maxDiscountPesewas: p.cap,
        active: p.active,
        usageCount: p.uses,
        maxRedemptions: p.max,
        expiry: ahead(p.days * DAY),
      },
    });
  }
  log(`${promos.length} promotions (2 live, 1 disabled, 1 expired)`);

  // Pulse schedules ---------------------------------------------------------
  const pulses = [
    { route: 'circle-madina', tier: 'ECO', time: '06:30', days: 'MON,TUE,WED,THU,FRI', seats: 14 },
    { route: 'circle-madina', tier: 'COMFORT', time: '17:45', days: 'MON,TUE,WED,THU,FRI', seats: 11 },
    { route: 'kaneshie-tema', tier: 'ECO', time: '07:00', days: 'SAT,SUN', seats: 15 },
  ];
  for (let i = 0; i < pulses.length; i += 1) {
    const p = pulses[i];
    await prisma.pulseSchedule.create({
      data: {
        id: id(`pulse_${i}`),
        routeId: id(`route_${p.route}`),
        tier: p.tier,
        departureTime: p.time,
        daysOfWeek: p.days,
        maxSeats: p.seats,
        isActive: true,
      },
    });
  }
  log(`${pulses.length} pulse schedules`);

  // Ratings -----------------------------------------------------------------
  n = 0;
  for (let i = 0; i < 24; i += 1) {
    const d = activeDrivers[i % activeDrivers.length];
    const u = USERS[i % 7];
    try {
      await prisma.driverRating.create({
        data: {
          id: id(`rating_${i}`),
          driverId: id(`driver_${d.key}`),
          userId: id(`user_${u.key}`),
          tripId: id(`trip_done${i}`),
          stars: [5, 5, 4, 5, 3, 4, 5, 2][i % 8],
          comment: i % 3 === 0 ? 'Smooth ride, left on time.' : null,
          createdAt: ago(i * 12 * HOUR),
        },
      });
      n += 1;
    } catch { /* trip_doneN may not exist for every index */ }
  }
  log(`${n} driver ratings`);

  // Console operators, one per role, so RBAC can actually be exercised -------
  const bcrypt = require('bcryptjs');
  const PASSWORD = 'EyeGoE2E!Test7';
  const hash = await bcrypt.hash(PASSWORD, 10);
  const operators = [
    ['super', 'e2e.super@eyego.app', 'E2E Superadmin', 'SUPERADMIN'],
    ['ops', 'e2e.ops@eyego.app', 'E2E Ops Lead', 'OPS'],
    ['finance', 'e2e.finance@eyego.app', 'E2E Finance', 'FINANCE'],
    ['support', 'e2e.support@eyego.app', 'E2E Support', 'SUPPORT'],
    ['viewer', 'e2e.viewer@eyego.app', 'E2E Viewer', 'VIEWER'],
    ['disabled', 'e2e.disabled@eyego.app', 'E2E Disabled', 'OPS'],
  ];
  for (const [key, email, name, role] of operators) {
    await prisma.adminUser.create({
      data: {
        id: id(`admin_${key}`),
        email, name, role,
        passwordHash: hash,
        isActive: key !== 'disabled',
        mustChangePassword: false,
      },
    });
  }
  log(`${operators.length} admin operators — password for all: ${PASSWORD}`);

  console.log('\n  Sign in at http://localhost:4000/login');
  console.log(`  e2e.super@eyego.app / ${PASSWORD}\n`);
}

/**
 * documentReview is a JSON string the driver app and console both parse. The
 * keys MUST be the document types drivers.service.getDocuments() looks up —
 * DRIVERS_LICENSE / GHANA_CARD / PROFILE_PHOTO. Any other spelling is simply
 * not found, and an unfound entry falls through to the "grandfathered"
 * VERIFIED default, so a pending driver renders as fully verified.
 */
function buildDocReview(docs) {
  const out = {};
  for (const [field, state] of Object.entries(docs)) {
    if (field.endsWith('Reason')) continue;
    out[field] = {
      status: state,
      reviewedAt: state === 'PENDING' ? null : ago(2 * DAY).toISOString(),
      rejectionReason: docs[`${field}Reason`] ?? null,
    };
  }
  return out;
}

async function makeTrip(t, counters) {
  const route = ROUTES.find((r) => r.key === t.route);
  const driver = t.driver ? DRIVERS.find((d) => d.key === t.driver) : null;
  const fare = TIER_FARES[t.tier];
  const departure = t.minsAhead ? ahead(t.minsAhead * MIN) : ago(t.minsAgo * MIN);
  const seats = t.seats ?? (2 + Math.floor(Math.random() * 4));
  const maxSeats = driver?.vehicle?.seats ?? 14;

  const terminal = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'NO_DRIVERS_FOUND'].includes(t.status);
  const live = ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'].includes(t.status);

  await prisma.trip.create({
    data: {
      id: id(`trip_${t.key}`),
      shortId: `E2E${t.key.toUpperCase().slice(0, 8)}`,
      driverId: driver ? id(`driver_${driver.key}`) : null,
      vehicleId: driver?.vehicle ? id(`vehicle_${driver.key}`) : null,
      routeId: id(`route_${route.key}`),
      requesterId: id(`user_${USERS[Math.floor(Math.random() * 7)].key}`),
      tier: t.tier,
      status: t.status,
      pickupLat: route.originLat, pickupLng: route.originLng, pickupAddress: route.originName,
      dropoffLat: route.destLat, dropoffLng: route.destLng, dropoffAddress: route.destinationName,
      departureTime: departure,
      requestedAt: departure,
      assignedAt: driver ? departure : null,
      departedAt: live || t.status === 'COMPLETED' ? departure : null,
      arrivedAt: t.status === 'ARRIVED_AT_PICKUP' || t.status === 'COMPLETED' ? departure : null,
      completedAt: t.status === 'COMPLETED' ? new Date(departure.getTime() + 40 * MIN) : null,
      cancelledAt: t.status === 'CANCELLED' ? departure : null,
      cancelledBy: t.cancelledBy ?? null,
      cancellationReason: t.reason ?? null,
      baseFarePesewas: fare.base,
      perKmRatePesewas: fare.perKm,
      surgeMultiplier: t.status === 'IN_PROGRESS' ? 1.3 : 1,
      commissionRate: 0.15,
      confirmedSeats: terminal && t.status !== 'COMPLETED' ? 0 : seats,
      maxSeats,
      createdAt: departure,
    },
  });
  counters.trips += 1;

  const perSeat = Math.round(fare.base + fare.perKm * route.distanceKm);
  const bookingStatus = {
    COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW',
    EXPIRED: 'EXPIRED', NO_DRIVERS_FOUND: 'CANCELLED',
    IN_PROGRESS: 'BOARDED', ARRIVED_AT_PICKUP: 'PAID', DRIVER_EN_ROUTE: 'PAID',
    DRIVER_ASSIGNED: 'PAID', CONFIRMED: 'CONFIRMED', FILLING: 'SEAT_HELD',
    SCHEDULED: 'CONFIRMED', REQUESTED: 'PENDING', MATCHING: 'PENDING', REASSIGNING: 'PAID',
  }[t.status] ?? 'PENDING';

  for (let s = 0; s < seats; s += 1) {
    const user = USERS[(s + counters.trips) % 7];
    const bookingId = id(`booking_${t.key}_${s}`);
    const commission = Math.round(perSeat * 0.15);
    await prisma.booking.create({
      data: {
        id: bookingId,
        tripId: id(`trip_${t.key}`),
        userId: id(`user_${user.key}`),
        seatNumber: bookingStatus === 'CANCELLED' || bookingStatus === 'EXPIRED' ? null : s + 1,
        fareAmountPesewas: perSeat,
        commissionAmountPesewas: commission,
        paymentMethod: s % 3 === 0 ? 'CASH' : s % 3 === 1 ? 'WALLET' : 'CARD',
        paymentStatus: ['COMPLETED', 'BOARDED', 'PAID'].includes(bookingStatus) ? 'PAID' : 'PENDING',
        status: bookingStatus,
        holdExpiresAt: bookingStatus === 'SEAT_HELD' ? ahead(8 * MIN) : null,
        cancelledAt: bookingStatus === 'CANCELLED' ? departure : null,
        cancellationReason: bookingStatus === 'CANCELLED' ? (t.reason ?? 'Trip cancelled') : null,
        createdAt: departure,
      },
    });
    counters.bookings += 1;

    if (bookingStatus === 'COMPLETED') {
      await prisma.receipt.create({
        data: {
          id: id(`receipt_${t.key}_${s}`),
          bookingId,
          userId: id(`user_${user.key}`),
          receiptNumber: `E2E-${t.key}-${s}`.toUpperCase(),
          totalPaidPesewas: perSeat,
          platformFeePesewas: commission,
          driverEarningsPesewas: perSeat - commission,
          paymentMethod: s % 3 === 0 ? 'CASH' : s % 3 === 1 ? 'WALLET' : 'CARD',
          paidAt: new Date(departure.getTime() + 40 * MIN),
          createdAt: new Date(departure.getTime() + 40 * MIN),
        },
      });
      counters.receipts += 1;

      await prisma.paymentTransaction.create({
        data: {
          id: id(`ptx_${t.key}_${s}`),
          bookingId,
          userId: id(`user_${user.key}`),
          amountPesewas: perSeat,
          currency: 'GHS',
          status: 'SUCCESS',
          paystackRef: `e2e_ref_${t.key}_${s}`,
          createdAt: departure,
        },
      });
      counters.payments += 1;
    }
  }

  if (driver && ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'].includes(t.status)) {
    await prisma.dispatchAction.create({
      data: {
        id: id(`dispatch_${t.key}`),
        driverId: id(`driver_${driver.key}`),
        tripId: id(`trip_${t.key}`),
        action: 'ACCEPTED',
        createdAt: departure,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error('\n✗ seed failed:', e.message);
    if (e.meta) console.error('  meta:', JSON.stringify(e.meta));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
