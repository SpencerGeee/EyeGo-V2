const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),

  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_PUBLIC_KEY: z.string().min(1),

  AT_API_KEY: z.string().min(1),
  AT_USERNAME: z.string().min(1),
  AT_SENDER_ID: z.string().default('EyeGo'),

  // Firebase is optional — push notifications gracefully degrade when unset.
  // Set these only if you need push notification functionality.
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),

  MAPBOX_SECRET_TOKEN: z.string().min(1),
  MAPBOX_PUBLIC_TOKEN: z.string().optional(),

  // ── APNs / iOS Live Activities (ActivityKit) — optional ────────────────
  // Live Activity push updates go over a DIRECT connection to Apple's push
  // gateway (api.push.apple.com), completely separate from Firebase/FCM.
  // You need an APNs Auth Key (.p8), NOT the old certificate-based auth:
  //   1. developer.apple.com → Certificates, Identifiers & Profiles → Keys
  //   2. Create a new key with the "Apple Push Notifications service (APNs)"
  //      capability enabled. Download the .p8 file ONCE (Apple won't re-issue it).
  //   3. Note the Key ID (shown on the key's page) and your Team ID
  //      (top-right of the Apple Developer account page).
  // Paste the .p8 contents (including the BEGIN/END lines) into
  // APNS_AUTH_KEY, escaping newlines as \n — same convention as
  // FIREBASE_PRIVATE_KEY above.
  APNS_AUTH_KEY: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  // Bundle ID of the WIDGET EXTENSION target (main app id + suffix), e.g.
  // "com.eyego.rider.LiveActivity" — this is what apple-targets names the
  // target it generates under apps/rider/targets/live-activity.
  APNS_LIVE_ACTIVITY_TOPIC: z.string().optional(),
  // 'production' hits api.push.apple.com, 'sandbox' hits api.sandbox.push.apple.com
  // (Xcode debug builds register sandbox tokens; TestFlight/App Store builds
  // register production tokens).
  APNS_ENVIRONMENT: z.enum(['production', 'sandbox']).default('sandbox'),

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  // Legacy shared secret for the old vanilla console in eyego-api/public.
  // Superseded by real AdminUser accounts + JWT (see adminAuth.service.js).
  ADMIN_SECRET_KEY: z.string().min(16),

  // Set to 'false' once the old console is retired. While it is 'true', one
  // leaked ADMIN_SECRET_KEY is still unattributable full superadmin access.
  ADMIN_LEGACY_SECRET: z.enum(['true', 'false']).default('true'),

  // Comma-separated origins allowed to call the admin API from a browser
  // (the apps/admin deployment). Only needed if the console ever calls the API
  // directly; the Next.js app proxies server-side, so this is normally unset.
  ADMIN_CORS_ORIGINS: z.string().optional(),

  // ── OTA deploy console (all optional — the admin OTA page degrades to
  // read-only/unconfigured messaging when unset) ──
  // Personal access token from expo.dev → Account settings → Access tokens.
  // Used to READ published updates/channels from the EAS GraphQL API.
  EXPO_TOKEN: z.string().optional(),
  // GitHub token with actions:write on the repo (fine-grained) or repo scope
  // (classic). Used to trigger the ota-update.yml workflow_dispatch.
  GITHUB_TOKEN: z.string().optional(),
  // "owner/repo", e.g. SpencerGeee/EyeGo-V2
  GITHUB_REPO: z.string().optional(),
  // Branch the OTA workflow checks out and publishes from.
  GITHUB_REF: z.string().default('main'),
  OTA_WORKFLOW_FILE: z.string().default('ota-update.yml'),

  // ── Error tracking (optional — no-op when unset) ──
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENV: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ── Anonymized contact relay (Phase 3A — placeholder for sandbox) ──
  CONTACT_RELAY_NUMBER: z.string().optional(),

  // ── Ride-check / route-deviation safety (Phase 3B) ──
  DEVIATION_THRESHOLD_M: z.coerce.number().default(350),
  STOPPED_THRESHOLD_SEC: z.coerce.number().default(180),
  SAFETY_CHECK_COOLDOWN_SEC: z.coerce.number().default(300),
  // Set to the string 'false' to skip Ghana-bounds validation of driver GPS.
  // Must live in this schema: zod strips unknown keys, so before this entry
  // env.GEO_VALIDATION_ENABLED was always undefined and the flag was inert.
  GEO_VALIDATION_ENABLED: z.string().optional(),

  /**
   * TIER RATES — raised ~30% on 2026-08-17 at the operator's request.
   *
   * "The cost per seat is really low and I'm not sure the drivers would be
   * making a profit." A shared trip's seat is
   * `(base + perKm × km) × surge / maxSeats`, so on a 12–14 seater the whole
   * vehicle's fare is divided by a big number and a driver only breaks even on a
   * bus that fills. The lever that fixes that WITHOUT flattening the fare curve
   * is base + per-km, not the per-seat floor: the floor was raised once before
   * and it made trips of very different lengths cost the same (see the note on
   * MIN_FARE_PER_SEAT below), because on any short hop the floor, not the
   * distance, set the price.
   *
   * Worked example, ECO over 5.5 km on a 12-seater:
   *   before  (25 + 8×5.5)  = ₵69.00 → ₵5.75/seat
   *   after   (30 + 11×5.5) = ₵90.50 → ₵7.54/seat
   *
   * These are DEFAULTS. All six are in the runtime settings registry
   * (`config/settings.js`, group `pricing_*`), so the operator retunes them from
   * the admin console without a deploy and without touching this file.
   */
  ECO_BASE_FARE: z.coerce.number().default(30.0),
  ECO_PER_KM_RATE: z.coerce.number().default(11.0),
  COMFORT_BASE_FARE: z.coerce.number().default(42.0),
  COMFORT_PER_KM_RATE: z.coerce.number().default(16.0),
  PREMIUM_BASE_FARE: z.coerce.number().default(60.0),
  PREMIUM_PER_KM_RATE: z.coerce.number().default(21.0),

  /**
   * ── THE ON-DEMAND RATE CARD ────────────────────────────────────────────────
   *
   * A SECOND rate card, not a replacement for the six knobs above, and the
   * distinction is the whole point.
   *
   * The knobs above price a SHARED trip: a driver publishes a minibus with N
   * seats and the vehicle's fare `(base + perKm × km) × surge` is divided by N.
   * That is why they are large — ₵30 + ₵11/km is the price of the whole bus,
   * not of a seat.
   *
   * An on-demand ride is one rider hiring the whole car, so it is quoted with
   * `seatCount: 1` and the vehicle rate lands on one person unchanged. Those two
   * things want completely different numbers, and sharing one table is what made
   * the operator's Economy price wrong in both directions at once.
   *
   * These are the rates the operator supplied for on-demand, in cedis, and they
   * are the industry-standard five-part card rather than the two-part one:
   *
   *            minimum   start   per km   per min   wait/min
   *   ECO       20.00     4.13     2.08     0.81      0.82
   *   COMFORT   22.00     4.75     2.40     0.94      0.94
   *   PREMIUM   38.00     6.20     3.14     1.21      1.23
   *
   * Plus a booking fee (a percentage of the ride) and a flat platform fee, both
   * charged on top of the ride and both shown as their own lines in the rider's
   * breakdown — see `calculateRideFare` in modules/trips/fare.calculator.js.
   *
   * All of these are in the runtime settings registry (`config/settings.js`,
   * groups `ride_pricing_*`), so the operator retunes them from the admin
   * console without a deploy.
   */
  RIDE_ECO_MIN_FARE: z.coerce.number().default(20.0),
  RIDE_ECO_START_FARE: z.coerce.number().default(4.13),
  RIDE_ECO_PER_KM: z.coerce.number().default(2.08),
  RIDE_ECO_PER_MIN: z.coerce.number().default(0.81),
  RIDE_ECO_WAIT_PER_MIN: z.coerce.number().default(0.82),

  RIDE_COMFORT_MIN_FARE: z.coerce.number().default(22.0),
  RIDE_COMFORT_START_FARE: z.coerce.number().default(4.75),
  RIDE_COMFORT_PER_KM: z.coerce.number().default(2.4),
  RIDE_COMFORT_PER_MIN: z.coerce.number().default(0.94),
  RIDE_COMFORT_WAIT_PER_MIN: z.coerce.number().default(0.94),

  RIDE_PREMIUM_MIN_FARE: z.coerce.number().default(38.0),
  RIDE_PREMIUM_START_FARE: z.coerce.number().default(6.2),
  RIDE_PREMIUM_PER_KM: z.coerce.number().default(3.14),
  RIDE_PREMIUM_PER_MIN: z.coerce.number().default(1.21),
  RIDE_PREMIUM_WAIT_PER_MIN: z.coerce.number().default(1.23),

  /** Percentage of the ride fare, as a ratio. 6.1% → 0.061. */
  /**
   * How much the VEHICLE fare grows per extra seat on a group trip.
   *
   * The multiplier is `1 + uplift × (seats - 1)`, so a party of one prices
   * exactly like an on-demand ride and each additional passenger adds 35 % of a
   * solo fare rather than another whole one. Sub-linear on purpose: a second
   * passenger in the same car costs the driver almost nothing extra, so charging
   * them a second full fare would be indefensible — while charging nothing would
   * hand the driver the same money for a fuller, slower, harder trip.
   */
  RIDE_GROUP_SEAT_UPLIFT: z.coerce.number().default(0.35),
  /** Nothing a seat on a shared trip may ever fall below, in cedis. */
  RIDE_GROUP_MIN_FARE_PER_SEAT: z.coerce.number().default(8.0),
  RIDE_BOOKING_FEE_RATE: z.coerce.number().default(0.061),
  /** Flat per-ride platform fee, in cedis. */
  RIDE_PLATFORM_FEE: z.coerce.number().default(1.0),
  /**
   * Door pickup — the rider asks to be collected where THEY are rather than at
   * the trip's pickup point.
   *
   * This was one flat number, which prices a 200 m nudge and a 3 km diversion
   * identically: the short one overcharges the rider and the long one
   * undercharges the driver for fuel and time they actually spend. The fee is
   * now `max(MIN, detourKm × PER_KM)` over the real extra road distance, with
   * the flat figure kept as the fallback for the case where the detour cannot
   * be measured (no route, no coordinates) — refusing to price it at all would
   * mean refusing the booking.
   */
  DOORSTEP_SURCHARGE: z.coerce.number().default(5.0),
  DOORSTEP_MIN_FEE: z.coerce.number().default(3.0),
  DOORSTEP_PER_KM: z.coerce.number().default(4.0),
  /** Beyond this the diversion stops being a pickup and becomes a second trip,
   *  so it is refused rather than priced. */
  DOORSTEP_MAX_DETOUR_KM: z.coerce.number().default(3.0),
  HEAVY_LOAD_SURCHARGE: z.coerce.number().default(8.0),
  // Group-hub joiners picking their own pickup point (not the trip's main pickup)
  // detour the driver for free up to this many km — only a genuinely large
  // diversion beyond it adds a per-km surcharge. Tune once real-world numbers
  // come in from the client; this is a placeholder default, not a final figure.
  FREE_DEVIATION_KM: z.coerce.number().default(1.5),
  PLATFORM_COMMISSION: z.coerce.number().default(0.15),
  // The ONLY floor under a per-seat fare. A seat costs
  // `(baseFarePesewas + perKmRatePesewas × km) × surge / maxSeats`, so on a 14-seater a short
  // urban hop divides down to a few pesewas — this stops that, and nothing else
  // does. Deliberately NOT the tier's base fare: tying the floor to the tier
  // meant the floor, not the distance, set the price on most shared trips, so
  // two trips of very different lengths cost the same. Tier separation comes
  // from each tier's own baseFarePesewas AND perKmRatePesewas instead.
  // Raised 3.00 → 4.00 alongside the tier rates above. Kept deliberately modest:
  // this is a FLOOR, and a floor set anywhere near the typical seat price stops
  // being a floor and becomes the price, which is the flattening the paragraph
  // above describes. The real increase lives in base + per-km.
  MIN_FARE_PER_SEAT: z.coerce.number().default(4.0),
  MIN_OCCUPANCY_TO_DEPART: z.coerce.number().default(5),
  SEAT_HOLD_DURATION_MINUTES: z.coerce.number().default(10),
  DRIVER_MIN_WALLET_BALANCE: z.coerce.number().default(5.0),
  DRIVER_REQUIRED_WALLET_TO_GO_ONLINE: z.coerce.number().default(20.0),
  DRIVER_MIN_WITHDRAWAL: z.coerce.number().default(20.0),

  /**
   * NO PAYMENT GATEWAY YET.
   *
   * Paystack is not live, so `wallet.topUp` — the only way a driver's balance
   * can go UP other than earning a fare — called `initiateMomoCharge`, got an
   * error or a charge nobody could ever complete, and the balance never moved.
   * A driver whose wallet went negative (commission on a cash fare) was
   * therefore permanently locked out of going online with no route back.
   *
   * When this is on, a top-up is credited immediately and the ledger row is
   * marked `SIMULATED` in its description and reference so it can never be
   * mistaken for money that actually arrived. Everything else about the path —
   * the idempotency key, the transaction, the balanceBefore/After identity —
   * is the real one, so wiring the gateway later is a change to this branch and
   * nothing else.
   *
   * Defaults ON outside production and OFF in production, so shipping without
   * setting it cannot invent money on a live platform.
   */
  PAYMENTS_SIMULATED: z.enum(['true', 'false']).optional(),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('Invalid environment variables:');
  console.error(_parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// ── Money knobs cross the cedis→pesewas boundary exactly once, here ─────────
//
// A `.env` file is written by a human, so it stays in cedis: `ECO_BASE_FARE=5.00`
// reads correctly and `ECO_BASE_FARE=500` would not. But nothing downstream is
// allowed to see that decimal, so the cedis keys are DELETED from the exported
// object and re-published under `…_PESEWAS` names.
//
// Deleting rather than keeping both is the point. If `env.ECO_BASE_FARE` still
// resolved to 5.0, every fare formula that was not converted would keep working
// and quietly price rides at one hundredth of the intended amount. Now those
// lines read `undefined` and blow up on the first request, which is the only
// failure mode that gets noticed before a rider is charged.
// ── FAIL CLOSED: simulated money cannot exist on a live platform ────────────
//
// The default rule ("simulate outside production") is safe on its own, but it
// is a DEFAULT — an explicit `PAYMENTS_SIMULATED=true` overrides it, and a
// `.env` copied from staging onto a production host does exactly that. The
// failure is silent and unbounded: every top-up credits instantly, the balance
// is real as far as every other query is concerned, and riders pay fares out of
// money that never existed. Revenue reads `Booking.paymentStatus`, so the
// invented balance would then be counted as genuine platform revenue.
//
// There is no legitimate reason to want simulated payments in production, so
// the combination is refused at boot rather than warned about. A crash on
// deploy is recoverable; invented money in a ledger is not.
if (_parsed.data.NODE_ENV === 'production' && process.env.PAYMENTS_SIMULATED === 'true') {
  console.error(
    'FATAL: PAYMENTS_SIMULATED=true with NODE_ENV=production. Simulated top-ups ' +
      'credit real balance instantly and would be counted as revenue. Refusing to boot.',
  );
  process.exit(1);
}

const { fromCedis } = require('../utils/money');

const {
  // Destructured out so they CANNOT appear on the exported object. Listed one
  // by one rather than looped so both a reader and the type-checker can see
  // exactly which knobs are money.
  ECO_BASE_FARE,
  ECO_PER_KM_RATE,
  COMFORT_BASE_FARE,
  COMFORT_PER_KM_RATE,
  PREMIUM_BASE_FARE,
  PREMIUM_PER_KM_RATE,
  RIDE_ECO_MIN_FARE,
  RIDE_ECO_START_FARE,
  RIDE_ECO_PER_KM,
  RIDE_ECO_PER_MIN,
  RIDE_ECO_WAIT_PER_MIN,
  RIDE_COMFORT_MIN_FARE,
  RIDE_COMFORT_START_FARE,
  RIDE_COMFORT_PER_KM,
  RIDE_COMFORT_PER_MIN,
  RIDE_COMFORT_WAIT_PER_MIN,
  RIDE_PREMIUM_MIN_FARE,
  RIDE_PREMIUM_START_FARE,
  RIDE_PREMIUM_PER_KM,
  RIDE_PREMIUM_PER_MIN,
  RIDE_PREMIUM_WAIT_PER_MIN,
  RIDE_GROUP_MIN_FARE_PER_SEAT,
  RIDE_PLATFORM_FEE,
  DOORSTEP_SURCHARGE,
  DOORSTEP_MIN_FEE,
  DOORSTEP_PER_KM,
  HEAVY_LOAD_SURCHARGE,
  MIN_FARE_PER_SEAT,
  DRIVER_MIN_WALLET_BALANCE,
  DRIVER_REQUIRED_WALLET_TO_GO_ONLINE,
  DRIVER_MIN_WITHDRAWAL,
  PAYMENTS_SIMULATED,
  ...rest
} = _parsed.data;

module.exports = {
  ...rest,
  // Unset means "simulate outside production" — see the schema note. Written as
  // a resolved boolean so no caller has to repeat the NODE_ENV rule and get it
  // subtly different.
  PAYMENTS_SIMULATED:
    PAYMENTS_SIMULATED != null
      ? PAYMENTS_SIMULATED === 'true'
      : rest.NODE_ENV !== 'production',
  ECO_BASE_FARE_PESEWAS: fromCedis(ECO_BASE_FARE),
  ECO_PER_KM_RATE_PESEWAS: fromCedis(ECO_PER_KM_RATE),
  COMFORT_BASE_FARE_PESEWAS: fromCedis(COMFORT_BASE_FARE),
  COMFORT_PER_KM_RATE_PESEWAS: fromCedis(COMFORT_PER_KM_RATE),
  PREMIUM_BASE_FARE_PESEWAS: fromCedis(PREMIUM_BASE_FARE),
  PREMIUM_PER_KM_RATE_PESEWAS: fromCedis(PREMIUM_PER_KM_RATE),
  // ── The on-demand rate card, in pesewas. See the schema note above. ──
  RIDE_ECO_MIN_FARE_PESEWAS: fromCedis(RIDE_ECO_MIN_FARE),
  RIDE_ECO_START_FARE_PESEWAS: fromCedis(RIDE_ECO_START_FARE),
  RIDE_ECO_PER_KM_PESEWAS: fromCedis(RIDE_ECO_PER_KM),
  RIDE_ECO_PER_MIN_PESEWAS: fromCedis(RIDE_ECO_PER_MIN),
  RIDE_ECO_WAIT_PER_MIN_PESEWAS: fromCedis(RIDE_ECO_WAIT_PER_MIN),
  RIDE_COMFORT_MIN_FARE_PESEWAS: fromCedis(RIDE_COMFORT_MIN_FARE),
  RIDE_COMFORT_START_FARE_PESEWAS: fromCedis(RIDE_COMFORT_START_FARE),
  RIDE_COMFORT_PER_KM_PESEWAS: fromCedis(RIDE_COMFORT_PER_KM),
  RIDE_COMFORT_PER_MIN_PESEWAS: fromCedis(RIDE_COMFORT_PER_MIN),
  RIDE_COMFORT_WAIT_PER_MIN_PESEWAS: fromCedis(RIDE_COMFORT_WAIT_PER_MIN),
  RIDE_PREMIUM_MIN_FARE_PESEWAS: fromCedis(RIDE_PREMIUM_MIN_FARE),
  RIDE_PREMIUM_START_FARE_PESEWAS: fromCedis(RIDE_PREMIUM_START_FARE),
  RIDE_PREMIUM_PER_KM_PESEWAS: fromCedis(RIDE_PREMIUM_PER_KM),
  RIDE_PREMIUM_PER_MIN_PESEWAS: fromCedis(RIDE_PREMIUM_PER_MIN),
  RIDE_PREMIUM_WAIT_PER_MIN_PESEWAS: fromCedis(RIDE_PREMIUM_WAIT_PER_MIN),
  RIDE_GROUP_MIN_FARE_PER_SEAT_PESEWAS: fromCedis(RIDE_GROUP_MIN_FARE_PER_SEAT),
  RIDE_PLATFORM_FEE_PESEWAS: fromCedis(RIDE_PLATFORM_FEE),
  DOORSTEP_SURCHARGE_PESEWAS: fromCedis(DOORSTEP_SURCHARGE),
  DOORSTEP_MIN_FEE_PESEWAS: fromCedis(DOORSTEP_MIN_FEE),
  DOORSTEP_PER_KM_PESEWAS: fromCedis(DOORSTEP_PER_KM),
  HEAVY_LOAD_SURCHARGE_PESEWAS: fromCedis(HEAVY_LOAD_SURCHARGE),
  MIN_FARE_PER_SEAT_PESEWAS: fromCedis(MIN_FARE_PER_SEAT),
  DRIVER_MIN_WALLET_BALANCE_PESEWAS: fromCedis(DRIVER_MIN_WALLET_BALANCE),
  DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS: fromCedis(DRIVER_REQUIRED_WALLET_TO_GO_ONLINE),
  DRIVER_MIN_WITHDRAWAL_PESEWAS: fromCedis(DRIVER_MIN_WITHDRAWAL),
};
