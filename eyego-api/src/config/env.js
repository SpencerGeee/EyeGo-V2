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

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  ADMIN_SECRET_KEY: z.string().min(16),

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
