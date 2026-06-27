'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Fare helpers ────────────────────────────────────────────────
function ecoFare(km) { return +(3.50 + 0.38 * km).toFixed(2); }
function comfortFare(km) { return +(5.00 + 0.62 * km).toFixed(2); }

// ── Departure time helpers ──────────────────────────────────────
function nextDeparture(hoursFromNow) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hoursFromNow);
  return d;
}

async function main() {
  console.log('🌱 Seeding EyeGo database...');

  // ── Routes ───────────────────────────────────────────────────
  const routeData = [
    {
      id: 'r1',
      name: 'Circle–Tema Motorway',
      originName: 'Kwame Nkrumah Circle',
      destinationName: 'Tema Community 1',
      originLat: 5.5571, originLng: -0.2116,
      destLat: 5.6702, destLng: -0.0165,
      distanceKm: 34.2,
      stops: [
        { name: 'Kwame Nkrumah Circle', lat: 5.5571, lng: -0.2116, sequence: 1 },
        { name: 'Tetteh Quarshie Interchange', lat: 5.6274, lng: -0.1758, sequence: 2 },
        { name: 'Spintex Road Junction', lat: 5.6385, lng: -0.1352, sequence: 3 },
        { name: 'Tema Community 1', lat: 5.6702, lng: -0.0165, sequence: 4 },
      ],
    },
    {
      id: 'r2',
      name: 'Lapaz–East Legon',
      originName: 'Lapaz Junction',
      destinationName: 'East Legon',
      originLat: 5.6097, originLng: -0.2490,
      destLat: 5.6368, destLng: -0.1530,
      distanceKm: 18.7,
      stops: [
        { name: 'Lapaz Junction', lat: 5.6097, lng: -0.2490, sequence: 1 },
        { name: 'Achimota Mile 7', lat: 5.6249, lng: -0.2380, sequence: 2 },
        { name: 'Dzorwulu', lat: 5.6290, lng: -0.1940, sequence: 3 },
        { name: 'East Legon', lat: 5.6368, lng: -0.1530, sequence: 4 },
      ],
    },
    {
      id: 'r3',
      name: 'Achimota–Madina',
      originName: 'Achimota Overhead',
      destinationName: 'Madina Market',
      originLat: 5.6249, originLng: -0.2201,
      destLat: 5.6785, destLng: -0.1666,
      distanceKm: 22.4,
      stops: [
        { name: 'Achimota Overhead', lat: 5.6249, lng: -0.2201, sequence: 1 },
        { name: 'Haatso', lat: 5.6490, lng: -0.2020, sequence: 2 },
        { name: 'Adenta Barrier', lat: 5.6673, lng: -0.1750, sequence: 3 },
        { name: 'Madina Market', lat: 5.6785, lng: -0.1666, sequence: 4 },
      ],
    },
    {
      id: 'r4',
      name: 'Kasoa–Accra Mall',
      originName: 'Kasoa Barrier',
      destinationName: 'Accra Mall',
      originLat: 5.5355, originLng: -0.4242,
      destLat: 5.6245, destLng: -0.1774,
      distanceKm: 28.1,
      stops: [
        { name: 'Kasoa Barrier', lat: 5.5355, lng: -0.4242, sequence: 1 },
        { name: 'Mallam Junction', lat: 5.5622, lng: -0.2890, sequence: 2 },
        { name: 'Kwame Nkrumah Circle', lat: 5.5571, lng: -0.2116, sequence: 3 },
        { name: 'Accra Mall', lat: 5.6245, lng: -0.1774, sequence: 4 },
      ],
    },
    {
      id: 'r5',
      name: 'Spintex–Adenta',
      originName: 'Spintex Comm. 8',
      destinationName: 'Adenta Housing',
      originLat: 5.6385, originLng: -0.1352,
      destLat: 5.6673, destLng: -0.1750,
      distanceKm: 15.3,
      stops: [
        { name: 'Spintex Comm. 8', lat: 5.6385, lng: -0.1352, sequence: 1 },
        { name: 'Baatsona', lat: 5.6440, lng: -0.1530, sequence: 2 },
        { name: 'Adenta Housing', lat: 5.6673, lng: -0.1750, sequence: 3 },
      ],
    },
    {
      id: 'r6',
      name: 'Kaneshie–Airport',
      originName: 'Kaneshie Market',
      destinationName: 'Kotoka Airport',
      originLat: 5.5509, originLng: -0.2330,
      destLat: 5.6050, destLng: -0.1666,
      distanceKm: 12.8,
      stops: [
        { name: 'Kaneshie Market', lat: 5.5509, lng: -0.2330, sequence: 1 },
        { name: 'Obetsebi-Lamptey Circle', lat: 5.5700, lng: -0.2080, sequence: 2 },
        { name: 'Airport Hills', lat: 5.5970, lng: -0.1790, sequence: 3 },
        { name: 'Kotoka Airport', lat: 5.6050, lng: -0.1666, sequence: 4 },
      ],
    },
    {
      id: 'r7',
      name: 'Legon–Osu',
      originName: 'University of Ghana',
      destinationName: 'Osu Oxford St',
      originLat: 5.6502, originLng: -0.1868,
      destLat: 5.5545, destLng: -0.1751,
      distanceKm: 10.1,
      stops: [
        { name: 'University of Ghana', lat: 5.6502, lng: -0.1868, sequence: 1 },
        { name: 'Shiashie', lat: 5.6280, lng: -0.1850, sequence: 2 },
        { name: 'Osu Oxford St', lat: 5.5545, lng: -0.1751, sequence: 3 },
      ],
    },
    {
      id: 'r8',
      name: 'Dansoman–Tetteh Quarshie',
      originName: 'Dansoman Roundabout',
      destinationName: 'Tetteh Quarshie',
      originLat: 5.5380, originLng: -0.2610,
      destLat: 5.6274, destLng: -0.1758,
      distanceKm: 20.6,
      stops: [
        { name: 'Dansoman Roundabout', lat: 5.5380, lng: -0.2610, sequence: 1 },
        { name: 'Kwame Nkrumah Circle', lat: 5.5571, lng: -0.2116, sequence: 2 },
        { name: 'Adabraka', lat: 5.5720, lng: -0.2010, sequence: 3 },
        { name: 'Tetteh Quarshie', lat: 5.6274, lng: -0.1758, sequence: 4 },
      ],
    },
  ];

  const routes = {};
  for (const r of routeData) {
    const { stops, ...routeFields } = r;
    routes[r.id] = await prisma.route.upsert({
      where: { id: r.id },
      update: { name: r.name, isActive: true },
      create: {
        ...routeFields,
        isActive: true,
        virtualStops: { create: stops },
      },
    });
    console.log(`  ✓ Route: ${r.name}`);
  }

  // ── Drivers ──────────────────────────────────────────────────
  const driver1 = await prisma.driver.upsert({
    where: { phone: '+233244111001' },
    update: {},
    create: {
      phone: '+233244111001',
      name: 'Kwame Asante',
      status: 'ACTIVE',
      isOnline: true,
      currentLat: 5.5580,
      currentLng: -0.2130,
      walletBalance: 45.00,
      vehicles: {
        create: {
          plateNumber: 'GR-1234-23',
          make: 'Toyota',
          model: 'HiAce',
          year: 2019,
          seaterCount: 14,
          tier: 'ECO',
          isVerified: true,
          isActive: true,
        },
      },
    },
    include: { vehicles: true },
  });

  const driver2 = await prisma.driver.upsert({
    where: { phone: '+233244111002' },
    update: {},
    create: {
      phone: '+233244111002',
      name: 'Kofi Mensah',
      status: 'ACTIVE',
      isOnline: true,
      currentLat: 5.6385,
      currentLng: -0.1352,
      walletBalance: 80.00,
      vehicles: {
        create: {
          plateNumber: 'GR-5678-22',
          make: 'Mercedes',
          model: 'Sprinter',
          year: 2021,
          seaterCount: 14,
          tier: 'COMFORT',
          isVerified: true,
          isActive: true,
        },
      },
    },
    include: { vehicles: true },
  });

  console.log('  ✓ Drivers: Kwame Asante (ECO), Kofi Mensah (COMFORT)');

  const ecoVehicle = driver1.vehicles[0];
  const comfortVehicle = driver2.vehicles[0];

  // ── Pulse Schedules ──────────────────────────────────────────
  const scheduleData = [
    { id: 'ps1', routeId: 'r1', tier: 'ECO', departureTime: '06:30', daysOfWeek: "[1,2,3,4,5]", maxSeats: 14 },
    { id: 'ps2', routeId: 'r1', tier: 'COMFORT', departureTime: '07:00', daysOfWeek: "[1,2,3,4,5]", maxSeats: 14 },
    { id: 'ps3', routeId: 'r2', tier: 'ECO', departureTime: '07:15', daysOfWeek: "[1,2,3,4,5,6]", maxSeats: 14 },
    { id: 'ps4', routeId: 'r3', tier: 'ECO', departureTime: '07:45', daysOfWeek: "[1,2,3,4,5]", maxSeats: 14 },
    { id: 'ps5', routeId: 'r6', tier: 'COMFORT', departureTime: '08:00', daysOfWeek: "[1,2,3,4,5]", maxSeats: 14 },
    { id: 'ps6', routeId: 'r8', tier: 'ECO', departureTime: '08:30', daysOfWeek: "[1,2,3,4,5,6]", maxSeats: 14 },
  ];

  for (const s of scheduleData) {
    await prisma.pulseSchedule.upsert({
      where: { id: s.id },
      update: {},
      create: s,
    });
  }
  console.log('  ✓ Pulse schedules: 6 seeded');

  // ── Open Trips ────────────────────────────────────────────────
  // Note: No open trips are seeded. Only driver-published trips appear in search.
  // Completed trip below (trip-completed-1) is the only seeded trip.
  console.log('  ✓ Open trips: none seeded (live mode — only driver-published)');

  // ── Test Passengers ──────────────────────────────────────────
  const passengers = await Promise.all([
    prisma.user.upsert({
      where: { phone: '+233244000001' },
      update: { name: 'Ama Owusu' },
      create: { phone: '+233244000001', name: 'Ama Owusu', authProvider: 'PHONE', preferredTier: 'ECO' },
    }),
    prisma.user.upsert({
      where: { phone: '+233244000002' },
      update: {},
      create: { phone: '+233244000002', name: 'Kofi Boateng', authProvider: 'PHONE', preferredTier: 'ECO' },
    }),
    prisma.user.upsert({
      where: { phone: '+233244000003' },
      update: {},
      create: { phone: '+233244000003', name: 'Abena Mensah', authProvider: 'PHONE', preferredTier: 'ECO' },
    }),
  ]);
  console.log('  ✓ Test passengers: Ama Owusu, Kofi Boateng, Abena Mensah');

  // ── Completed Trip + Wallet Transactions (earnings history) ──
  const completedTripId = 'trip-completed-1';
  const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hrs ago
  const departedAt  = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hrs ago

  await prisma.trip.upsert({
    where: { id: completedTripId },
    update: {},
    create: {
      id: completedTripId,
      shortId: 'EGO-0000',
      driverId: driver1.id,
      vehicleId: ecoVehicle.id,
      routeId: 'r1',
      tier: 'ECO',
      status: 'COMPLETED',
      departureTime: departedAt,
      departedAt,
      arrivedAt: completedAt,
      baseFare: 3.50,
      perKmRate: 0.38,
      maxSeats: 14,
      confirmedSeats: 8,
    },
  });

  // Fare + commission calculated from route1 distance
  const fareAmount = ecoFare(routeData[0].distanceKm);
  const seatEarning = +(fareAmount * 0.85).toFixed(2); // after 15% commission
  let runningBalance = driver1.walletBalance;

  // Delete any existing wallet txns for this trip before re-creating
  await prisma.walletTransaction.deleteMany({ where: { tripId: completedTripId } });

  for (let seat = 1; seat <= 8; seat++) {
    const before = runningBalance;
    runningBalance = +(runningBalance + seatEarning).toFixed(2);
    await prisma.walletTransaction.create({
      data: {
        driverId: driver1.id,
        type: 'CREDIT',
        amount: seatEarning,
        description: `Trip EGO-0000 – seat ${seat}`,
        balanceBefore: before,
        balanceAfter: runningBalance,
        tripId: completedTripId,
        createdAt: new Date(completedAt.getTime() + seat * 1000),
      },
    });
  }

  // Update driver1 wallet balance to reflect completed trip earnings
  await prisma.driver.update({
    where: { id: driver1.id },
    data: { walletBalance: runningBalance },
  });
  console.log(`  ✓ Completed trip EGO-0000: 8 seats, GHS ${seatEarning * 8} earned`);
  console.log(`  ✓ Wallet transactions: 8 CREDIT records for Kwame`);

  // ── Promotions ────────────────────────────────────────────────
  await prisma.promotion.upsert({
    where: { code: 'WELCOME20' },
    update: {},
    create: {
      code: 'WELCOME20',
      discountPercent: 20,
      maxDiscount: 10.0,
      active: true,
      expiry: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
  console.log('  ✓ Promotions: WELCOME20 seeded');

  // ── Driver Quests ─────────────────────────────────────────────
  // Real DriverQuest rows so the driver app's Quests tab shows live,
  // progressable quests (not the static client-side fallback) and
  // completeTrip()'s incrementProgress() has targets to attach to.
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now); endOfWeek.setDate(endOfWeek.getDate() + 7);

  const questData = [
    { id: 'q-rides-daily-3',  title: 'Daily Driver',     description: 'Complete 3 trips today to earn a bonus.',          type: 'RIDES_COUNT', target: 3,   rewardAmount: 12.0, periodStart: startOfToday, periodEnd: endOfToday },
    { id: 'q-earn-daily-100', title: 'Earnings Sprint',  description: 'Earn GHS 100 in net fares today for a bonus.',     type: 'EARNINGS',    target: 100, rewardAmount: 15.0, periodStart: startOfToday, periodEnd: endOfToday },
    { id: 'q-rides-week-25',  title: 'Weekly Warrior',   description: 'Complete 25 trips this week to unlock a reward.',  type: 'RIDES_COUNT', target: 25,  rewardAmount: 40.0, periodStart: startOfToday, periodEnd: endOfWeek },
    { id: 'q-earn-week-500',  title: 'Weekly Champion',  description: 'Earn GHS 500 in net fares this week.',             type: 'EARNINGS',    target: 500, rewardAmount: 60.0, periodStart: startOfToday, periodEnd: endOfWeek },
  ];

  for (const q of questData) {
    await prisma.driverQuest.upsert({
      where: { id: q.id },
      update: { title: q.title, description: q.description, type: q.type, target: q.target, rewardAmount: q.rewardAmount, periodStart: q.periodStart, periodEnd: q.periodEnd, isActive: true },
      create: { ...q, isActive: true },
    });
  }
  console.log(`  ✓ Driver quests: ${questData.length} active quests seeded`);

  console.log('\n✅ Seed complete! Database is ready.');
  console.log('   Routes: 8 | Drivers: 2 | Trips: 1 (completed) | Passengers: 3 | Bookings: 0 | Wallet txns: 8 | Quests: 4');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
