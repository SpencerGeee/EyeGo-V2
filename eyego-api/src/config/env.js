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

  ADMIN_SECRET_KEY: z.string().min(16),

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

  ECO_BASE_FARE: z.coerce.number().default(25.0),
  ECO_PER_KM_RATE: z.coerce.number().default(8.0),
  COMFORT_BASE_FARE: z.coerce.number().default(35.0),
  COMFORT_PER_KM_RATE: z.coerce.number().default(12.0),
  DOORSTEP_SURCHARGE: z.coerce.number().default(5.0),
  HEAVY_LOAD_SURCHARGE: z.coerce.number().default(8.0),
  PLATFORM_COMMISSION: z.coerce.number().default(0.15),
  MIN_OCCUPANCY_TO_DEPART: z.coerce.number().default(5),
  SEAT_HOLD_DURATION_MINUTES: z.coerce.number().default(10),
  DRIVER_MIN_WALLET_BALANCE: z.coerce.number().default(5.0),
  DRIVER_REQUIRED_WALLET_TO_GO_ONLINE: z.coerce.number().default(20.0),
  DRIVER_MIN_WITHDRAWAL: z.coerce.number().default(20.0),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('Invalid environment variables:');
  console.error(_parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = _parsed.data;
