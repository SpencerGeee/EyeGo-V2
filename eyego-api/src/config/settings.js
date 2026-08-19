'use strict';

const prisma = require('./database');
const redis = require('./redis');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * RUNTIME PLATFORM SETTINGS — the knobs an operator must be able to turn without
 * a deploy and without an app-store release.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
 * Every commercial number in this platform lived in `.env`: tier base fares,
 * per-km rates, the commission, the fare floor, seat-hold duration, dispatch
 * radius, the driver wallet minimum. Changing any of them meant editing an env
 * file and restarting the API — and because the mobile apps display several of
 * them, some changes implied a store release too. That is the wrong cost for a
 * decision a finance lead should be able to make on a Tuesday afternoon.
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 * `PlatformSetting` rows override the env defaults. Reads go through `get()`,
 * which answers from an in-process cache, so this is as cheap as reading `env.X`
 * and can sit on the fare path. The cache is filled at boot and refreshed when
 * ANY instance publishes a change on the `settings:changed` Redis channel — so a
 * change made on one API instance reaches every other instance within a round
 * trip, rather than only after each one happens to restart.
 *
 * ── THE RULES ────────────────────────────────────────────────────────────────
 * 1. MONEY IS STORED IN PESEWAS, always, exactly like every column and every env
 *    `…_PESEWAS` key. The admin console converts the cedis an operator types.
 *    There is no float money anywhere in this file.
 * 2. Env is the DEFAULT, never the authority once a row exists. Deleting a row
 *    restores the env default, which is what "Reset" does.
 * 3. Every setting declares its own bounds and they are enforced on write. A
 *    commission of 9.0 or a base fare of -500 must be impossible to save, not
 *    merely unlikely: these numbers price real rides the moment they land.
 * 4. Nothing here is secret. Tokens, keys and connection strings stay in env and
 *    are deliberately absent from the registry — an admin console must not be
 *    able to read or rotate a credential.
 */

/** Channel every instance listens on. Payload is ignored; it means "reload". */
const CHANNEL = 'settings:changed';

const TYPES = {
  /** Integer pesewas. UI shows and accepts cedis. */
  MONEY: 'money',
  /** Ratio 0–1 (e.g. commission 0.15). UI shows and accepts percent. */
  RATIO: 'ratio',
  INT: 'int',
  DECIMAL: 'decimal',
  BOOLEAN: 'boolean',
  TEXT: 'text',
  ENUM: 'enum',
};

/**
 * THE REGISTRY. One entry per knob; adding a knob here is all that is required
 * for it to appear in the console, validate on write and take effect on read.
 *
 * `envKey` names the env variable that provides the default. `restartRequired`
 * marks the few values that are captured at module load elsewhere in the
 * codebase — the console says so rather than pretending the change is live.
 */
const REGISTRY = [
  // ── Fares: ECO ────────────────────────────────────────────────
  {
    key: 'ECO_BASE_FARE_PESEWAS', group: 'pricing_eco', type: TYPES.MONEY,
    label: 'Economy base fare', envKey: 'ECO_BASE_FARE_PESEWAS',
    help: 'Charged on every Economy trip before distance. The trip cost is (base + per-km × km) × surge, divided by the seats on sale.',
    min: 0, max: 100_00,
  },
  {
    key: 'ECO_PER_KM_RATE_PESEWAS', group: 'pricing_eco', type: TYPES.MONEY,
    label: 'Economy per-km rate', envKey: 'ECO_PER_KM_RATE_PESEWAS',
    help: 'Multiplied by the road distance of the trip.',
    min: 0, max: 100_00,
  },
  // ── Fares: COMFORT ────────────────────────────────────────────
  {
    key: 'COMFORT_BASE_FARE_PESEWAS', group: 'pricing_comfort', type: TYPES.MONEY,
    label: 'Comfort base fare', envKey: 'COMFORT_BASE_FARE_PESEWAS', min: 0, max: 200_00,
  },
  {
    key: 'COMFORT_PER_KM_RATE_PESEWAS', group: 'pricing_comfort', type: TYPES.MONEY,
    label: 'Comfort per-km rate', envKey: 'COMFORT_PER_KM_RATE_PESEWAS', min: 0, max: 200_00,
  },
  // ── Fares: PREMIUM ────────────────────────────────────────────
  {
    key: 'PREMIUM_BASE_FARE_PESEWAS', group: 'pricing_premium', type: TYPES.MONEY,
    label: 'Premium base fare', envKey: 'PREMIUM_BASE_FARE_PESEWAS', min: 0, max: 500_00,
  },
  {
    key: 'PREMIUM_PER_KM_RATE_PESEWAS', group: 'pricing_premium', type: TYPES.MONEY,
    label: 'Premium per-km rate', envKey: 'PREMIUM_PER_KM_RATE_PESEWAS', min: 0, max: 500_00,
  },

  /**
   * ── ON-DEMAND FARES ──────────────────────────────────────────
   *
   * A separate card from the six knobs above, and deliberately so: those price
   * a whole shared minibus and are divided by the seats on sale, while these
   * price one rider hiring one car. See the note in config/env.js.
   */
  ...['ECO', 'COMFORT', 'PREMIUM'].flatMap((t) => {
    const label = t === 'ECO' ? 'Economy' : t === 'COMFORT' ? 'Comfort' : 'Premium';
    const group = `ride_pricing_${t.toLowerCase()}`;
    return [
      {
        key: `RIDE_${t}_MIN_FARE_PESEWAS`, group, type: TYPES.MONEY,
        label: `${label} minimum price`, envKey: `RIDE_${t}_MIN_FARE_PESEWAS`,
        help: 'The floor on the ride itself. Booking and platform fees are added on top of it, so the rider never pays less than this for the ride.',
        min: 0, max: 500_00,
      },
      {
        key: `RIDE_${t}_START_FARE_PESEWAS`, group, type: TYPES.MONEY,
        label: `${label} start fare`, envKey: `RIDE_${t}_START_FARE_PESEWAS`,
        help: 'Charged the moment the trip starts, before any distance or time.',
        min: 0, max: 200_00,
      },
      {
        key: `RIDE_${t}_PER_KM_PESEWAS`, group, type: TYPES.MONEY,
        label: `${label} per km`, envKey: `RIDE_${t}_PER_KM_PESEWAS`,
        min: 0, max: 200_00,
      },
      {
        key: `RIDE_${t}_PER_MIN_PESEWAS`, group, type: TYPES.MONEY,
        label: `${label} per minute`, envKey: `RIDE_${t}_PER_MIN_PESEWAS`,
        help: 'Charged against the routed duration, which is what makes a trip through traffic cost more than the same distance on a clear road.',
        min: 0, max: 100_00,
      },
      {
        key: `RIDE_${t}_WAIT_PER_MIN_PESEWAS`, group, type: TYPES.MONEY,
        label: `${label} waiting per minute`, envKey: `RIDE_${t}_WAIT_PER_MIN_PESEWAS`,
        help: 'Charged for time the driver waits at the pickup beyond the free allowance.',
        min: 0, max: 100_00,
      },
    ];
  }),
  {
    key: 'RIDE_BOOKING_FEE_RATE', group: 'ride_pricing_fees', type: TYPES.RATIO,
    label: 'Booking fee', envKey: 'RIDE_BOOKING_FEE_RATE',
    help: 'A percentage of the ride (extras included), added on top of it. Platform revenue: no commission is taken from it.',
    min: 0, max: 0.5,
  },
  {
    key: 'RIDE_PLATFORM_FEE_PESEWAS', group: 'ride_pricing_fees', type: TYPES.MONEY,
    label: 'Platform fee', envKey: 'RIDE_PLATFORM_FEE_PESEWAS',
    help: 'A flat amount added to every on-demand ride.',
    min: 0, max: 100_00,
  },

  // ── Group / shared trips ──────────────────────────────────────
  // Group trips are priced on the SAME tier card as on-demand rides; these two
  // are the only knobs that make a shared seat different from a solo one.
  {
    key: 'RIDE_GROUP_SEAT_UPLIFT', group: 'ride_pricing_group', type: TYPES.RATIO,
    label: 'Group seat uplift', envKey: 'RIDE_GROUP_SEAT_UPLIFT',
    help: 'How much the whole-vehicle fare grows per EXTRA passenger, as a fraction of a solo fare. 0.35 means a second passenger adds 35% rather than another full fare — so the party pays less each and the driver earns more for a fuller car. 0 would make a full bus cost one fare; 1 would price every seat as a separate ride.',
    min: 0, max: 1,
  },
  {
    key: 'RIDE_GROUP_MIN_FARE_PER_SEAT_PESEWAS', group: 'ride_pricing_group', type: TYPES.MONEY,
    label: 'Minimum fare per shared seat', envKey: 'RIDE_GROUP_MIN_FARE_PER_SEAT_PESEWAS',
    help: 'The floor under one seat on a shared trip, applied after the vehicle fare is divided. Stops a short hop on a fifteen-seater dividing down to a few pesewas a head. Only applies when more than one seat is being sold.',
    min: 0, max: 100_00,
  },

  // ── Fare rules that apply to every tier ───────────────────────
  {
    key: 'MIN_FARE_PER_SEAT_PESEWAS', group: 'pricing_rules', type: TYPES.MONEY,
    label: 'Minimum fare per seat', envKey: 'MIN_FARE_PER_SEAT_PESEWAS',
    help: 'The ONLY floor under a seat price, scaled by each tier’s position in the rate table. Raise it and short urban trips get more expensive; there is no other floor.',
    min: 0, max: 100_00,
  },
  {
    key: 'PLATFORM_COMMISSION', group: 'pricing_rules', type: TYPES.RATIO,
    label: 'Platform commission', envKey: 'PLATFORM_COMMISSION',
    help: 'Taken from each seat fare. The driver receives the remainder, so this and the driver’s share always add back to the fare exactly.',
    min: 0, max: 0.5,
  },
  {
    key: 'HEAVY_LOAD_SURCHARGE_PESEWAS', group: 'pricing_rules', type: TYPES.MONEY,
    label: 'Heavy cargo surcharge', envKey: 'HEAVY_LOAD_SURCHARGE_PESEWAS',
    help: 'Added per seat after the floor, so it is never swallowed by it.',
    min: 0, max: 200_00,
  },

  // ── Door pickup ───────────────────────────────────────────────
  {
    key: 'DOORSTEP_MIN_FEE_PESEWAS', group: 'pricing_doorstep', type: TYPES.MONEY,
    label: 'Door pickup minimum', envKey: 'DOORSTEP_MIN_FEE_PESEWAS',
    help: 'A driver stops, waits and pulls out again even for a 100 m diversion; this is the floor under that.',
    min: 0, max: 100_00,
  },
  {
    key: 'DOORSTEP_PER_KM_PESEWAS', group: 'pricing_doorstep', type: TYPES.MONEY,
    label: 'Door pickup per detour km', envKey: 'DOORSTEP_PER_KM_PESEWAS', min: 0, max: 100_00,
  },
  {
    key: 'DOORSTEP_SURCHARGE_PESEWAS', group: 'pricing_doorstep', type: TYPES.MONEY,
    label: 'Door pickup flat fallback', envKey: 'DOORSTEP_SURCHARGE_PESEWAS',
    help: 'Used only when the detour cannot be measured. Pricing it at zero would make the most expensive option free.',
    min: 0, max: 100_00,
  },
  {
    key: 'DOORSTEP_MAX_DETOUR_KM', group: 'pricing_doorstep', type: TYPES.DECIMAL,
    label: 'Maximum door detour', envKey: 'DOORSTEP_MAX_DETOUR_KM', unit: 'km',
    help: 'Beyond this the diversion is a second trip, so it is refused rather than priced.',
    min: 0, max: 20,
  },
  {
    key: 'FREE_DEVIATION_KM', group: 'pricing_doorstep', type: TYPES.DECIMAL,
    label: 'Free deviation allowance', envKey: 'FREE_DEVIATION_KM', unit: 'km',
    help: 'A group joiner’s own pickup point costs nothing up to this diversion.',
    min: 0, max: 20,
  },

  // ── Booking and seats ─────────────────────────────────────────
  {
    key: 'SEAT_HOLD_DURATION_MINUTES', group: 'booking', type: TYPES.INT,
    label: 'Seat hold duration', envKey: 'SEAT_HOLD_DURATION_MINUTES', unit: 'minutes',
    help: 'How long an unpaid seat stays reserved before it is released back to the pool.',
    min: 1, max: 120,
  },
  {
    key: 'MIN_OCCUPANCY_TO_DEPART', group: 'booking', type: TYPES.INT,
    label: 'Minimum seats to depart', envKey: 'MIN_OCCUPANCY_TO_DEPART', unit: 'seats',
    min: 1, max: 20,
  },

  // ── Driver economics ──────────────────────────────────────────
  {
    key: 'DRIVER_MIN_WALLET_BALANCE_PESEWAS', group: 'driver_economics', type: TYPES.MONEY,
    label: 'Driver wallet warning level', envKey: 'DRIVER_MIN_WALLET_BALANCE_PESEWAS', min: 0, max: 1000_00,
  },
  {
    key: 'DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS', group: 'driver_economics', type: TYPES.MONEY,
    label: 'Wallet required to go online', envKey: 'DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS',
    help: 'A driver below this cannot go online. Raising it takes drivers offline the moment they next try.',
    min: 0, max: 1000_00,
  },
  {
    key: 'DRIVER_MIN_WITHDRAWAL_PESEWAS', group: 'driver_economics', type: TYPES.MONEY,
    label: 'Minimum withdrawal', envKey: 'DRIVER_MIN_WITHDRAWAL_PESEWAS', min: 0, max: 1000_00,
  },

  // ── Dispatch ──────────────────────────────────────────────────
  {
    key: 'DISPATCH_RADIUS_KM', group: 'dispatch', type: TYPES.DECIMAL,
    label: 'Initial search radius', envDefault: 5, unit: 'km',
    help: 'How far dispatch looks for a driver on the first pass.',
    min: 0.5, max: 50,
  },
  {
    key: 'DISPATCH_EXTENDED_RADIUS_KM', group: 'dispatch', type: TYPES.DECIMAL,
    label: 'Widened search radius', envDefault: 10, unit: 'km',
    help: 'Used once every driver in the initial radius has passed. A rider is better served by a driver 10 km away than by a failure screen.',
    min: 1, max: 100,
  },
  {
    key: 'DISPATCH_OFFER_TTL_SECONDS', group: 'dispatch', type: TYPES.INT,
    label: 'Offer countdown', envDefault: 20, unit: 'seconds',
    help: 'How long one driver has to accept before the offer moves to the next candidate.',
    min: 5, max: 120,
  },
  {
    key: 'DISPATCH_SEARCH_TIMEOUT_SECONDS', group: 'dispatch', type: TYPES.INT,
    label: 'Total search window', envDefault: 180, unit: 'seconds',
    help: 'The search keeps re-scanning for drivers who come online or come free until this expires, then the trip becomes NO_DRIVERS_FOUND.',
    min: 30, max: 900,
  },
  {
    key: 'DISPATCH_MAX_CANDIDATES', group: 'dispatch', type: TYPES.INT,
    label: 'Candidates per search', envDefault: 8, unit: 'drivers',
    min: 1, max: 50,
  },
  {
    key: 'DISPATCH_MAX_PICKUP_ETA_SECONDS', group: 'dispatch', type: TYPES.INT,
    label: 'Maximum pickup ETA', envDefault: 1500, unit: 'seconds',
    help: 'A driver further out than this by road is not offered the trip.',
    min: 120, max: 3600,
  },
  {
    key: 'DISPATCH_BUSY_LEAD_MINUTES', group: 'dispatch', type: TYPES.INT,
    label: 'Scheduled-trip lockout lead', envDefault: 45, unit: 'minutes',
    help: 'How close to departure a driver’s own scheduled trip starts blocking new dispatch.',
    min: 0, max: 240,
  },

  // ── Rider & driver standing ───────────────────────────────────
  // The reputation model behind "fewer cancellations should mean better
  // pricing". See services/standing.service.js for how these are combined and
  // why the discount is deliberately small.
  {
    key: 'LOYALTY_MAX_DISCOUNT_BPS', group: 'standing', type: TYPES.INT,
    label: 'Maximum loyalty discount', envDefault: 700, unit: 'basis points',
    help: 'The most a rider with a spotless record can save on a fare. 100 basis points = 1%. Set to 0 to turn the loyalty discount off entirely.',
    min: 0, max: 2000,
  },
  {
    key: 'STANDING_RATING_WINDOW_DAYS', group: 'standing', type: TYPES.INT,
    label: 'Rating window', envDefault: 180, unit: 'days',
    help: 'Ratings older than this stop counting towards standing, so a long-ago run of five stars cannot hide recent behaviour.',
    min: 30, max: 730,
  },
  {
    key: 'STANDING_RELIABILITY_WINDOW_DAYS', group: 'standing', type: TYPES.INT,
    label: 'Reliability window', envDefault: 90, unit: 'days',
    help: 'How far back completed-vs-cancelled is measured when working out a rider or driver’s reliability.',
    min: 14, max: 365,
  },

  // ── What the apps show, changeable without a release ──────────
  {
    key: 'APP_ANNOUNCEMENT_TEXT', group: 'apps', type: TYPES.TEXT,
    label: 'In-app announcement', envDefault: '',
    help: 'Shown as a banner in both apps. Leave empty for no banner. Takes effect on the next app foreground — no store release.',
    maxLength: 240,
  },
  {
    key: 'APP_ANNOUNCEMENT_LEVEL', group: 'apps', type: TYPES.ENUM,
    label: 'Announcement tone', envDefault: 'info', options: ['info', 'warning', 'critical'],
  },
  {
    key: 'RIDER_BOOKING_ENABLED', group: 'apps', type: TYPES.BOOLEAN,
    label: 'Rider booking enabled', envDefault: true,
    help: 'Turning this off stops new bookings platform-wide. Trips already running are unaffected.',
  },
  {
    key: 'DRIVER_ONLINE_ENABLED', group: 'apps', type: TYPES.BOOLEAN,
    label: 'Drivers may go online', envDefault: true,
    help: 'Off means no driver can go online. Use for a maintenance window, not for moderation.',
  },
  {
    key: 'SUPPORT_PHONE', group: 'apps', type: TYPES.TEXT,
    label: 'Support phone number', envDefault: '',
    help: 'Shown on the help screens of both apps.',
    maxLength: 32,
  },
];

const BY_KEY = new Map(REGISTRY.map((d) => [d.key, d]));

/** Groups, in the order the console renders them. */
const GROUPS = [
  // RETIRED — kept so existing PlatformSetting rows still resolve, but nothing
  // reads them any more: `calculateFare` moved shared trips onto the same tier
  // card as on-demand rides (see fare.calculator.js). Editing these changes no
  // price. They are labelled so nobody tunes them expecting an effect.
  { id: 'pricing_eco', label: 'Economy (retired)', help: 'No longer used. Shared trips price on the Economy card below.' },
  { id: 'pricing_comfort', label: 'Comfort (retired)', help: 'No longer used.' },
  { id: 'pricing_premium', label: 'Premium (retired)', help: 'No longer used.' },
  { id: 'ride_pricing_eco', label: 'Economy fares', help: 'The Economy card. Prices a hailed ride AND a seat on a shared trip — the group split is applied on top of this, not instead of it.' },
  { id: 'ride_pricing_comfort', label: 'Comfort fares' },
  { id: 'ride_pricing_premium', label: 'Premium fares' },
  { id: 'ride_pricing_fees', label: 'Fees', help: 'Added on top of every ride and every seat.' },
  { id: 'ride_pricing_group', label: 'Group trips', help: 'How a shared seat differs from a solo ride. The rate card itself is the same one above.' },
  { id: 'pricing_rules', label: 'Fare rules', help: 'Applies to every tier.' },
  { id: 'pricing_doorstep', label: 'Door pickup' },
  // Reputation: what a rider's or driver's behaviour is measured over, and what
  // a spotless record is worth off a fare. See services/standing.service.js.
  { id: 'standing', label: 'Standing and loyalty', help: 'How rider and driver behaviour is scored, and the discount a reliable rider earns on every fare.' },
  { id: 'booking', label: 'Booking and seats' },
  { id: 'driver_economics', label: 'Driver wallet' },
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'apps', label: 'Apps', help: 'Changes both apps pick up without a store release.' },
];

/** Definition default, from env when it names one. */
function defaultFor(def) {
  if (def.envKey && env[def.envKey] !== undefined) return env[def.envKey];
  if (def.envKey && process.env[def.envKey] !== undefined) return coerce(def, process.env[def.envKey]);
  if (Object.prototype.hasOwnProperty.call(def, 'envDefault')) {
    // A plain env var may still override a non-env-schema knob.
    const raw = process.env[def.key];
    return raw !== undefined ? coerce(def, raw) : def.envDefault;
  }
  return undefined;
}

/** Parse a stored/incoming raw value into the type the code expects. */
function coerce(def, raw) {
  switch (def.type) {
    case TYPES.MONEY:
    case TYPES.INT: {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    }
    case TYPES.RATIO:
    case TYPES.DECIMAL: {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case TYPES.BOOLEAN:
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case TYPES.ENUM:
    case TYPES.TEXT:
      return raw == null ? '' : String(raw);
    default:
      return raw;
  }
}

/**
 * Validate one incoming value. Returns `{ value }` or `{ error }` — never throws,
 * so a batch save can report every bad field at once instead of the first.
 */
function validate(def, raw) {
  const value = coerce(def, raw);

  if (def.type === TYPES.BOOLEAN) return { value };

  if (def.type === TYPES.TEXT) {
    if (def.maxLength && value.length > def.maxLength) {
      return { error: `must be ${def.maxLength} characters or fewer` };
    }
    return { value };
  }

  if (def.type === TYPES.ENUM) {
    if (!def.options.includes(value)) return { error: `must be one of ${def.options.join(', ')}` };
    return { value };
  }

  if (value === undefined) return { error: 'must be a number' };
  if (def.type === TYPES.MONEY && !Number.isInteger(value)) {
    return { error: 'money must be a whole number of pesewas' };
  }
  if (def.min !== undefined && value < def.min) return { error: `must be at least ${def.min}` };
  if (def.max !== undefined && value > def.max) return { error: `must be at most ${def.max}` };
  return { value };
}

// ── The cache ──────────────────────────────────────────────────────
let overrides = new Map();
let loaded = false;
let subscriber = null;

async function reload() {
  try {
    const rows = await prisma.platformSetting.findMany();
    const next = new Map();
    for (const row of rows) {
      const def = BY_KEY.get(row.key);
      // A row for a key that no longer exists in the registry is ignored rather
      // than deleted: a rollback should not lose the operator's value.
      if (!def) continue;
      const parsed = coerce(def, row.value);
      if (parsed !== undefined) next.set(row.key, parsed);
    }
    overrides = next;
    loaded = true;
    logger.info(`[settings] loaded ${overrides.size} override${overrides.size === 1 ? '' : 's'}`);
  } catch (err) {
    // Never take the API down over this: env defaults are a complete, working
    // configuration on their own.
    logger.error(`[settings] load failed, using env defaults: ${err.message}`);
    loaded = true;
  }
}

/**
 * Call once at boot. Loads overrides and subscribes to change notifications so
 * every instance stays in step — without this, a change made on one instance
 * would price rides differently from the others.
 */
async function init() {
  await reload();
  try {
    subscriber = redis.duplicate();
    await subscriber.subscribe(CHANNEL);
    subscriber.on('message', (channel) => {
      if (channel === CHANNEL) reload().catch(() => {});
    });
    logger.info('[settings] subscribed to live changes');
  } catch (err) {
    logger.warn(`[settings] live-change subscription failed: ${err.message}`);
  }
}

/**
 * Read a setting. Synchronous and cache-backed, so it is safe on the fare path.
 * Falls back to the env default whenever there is no override — including before
 * `init()` has finished, which is what keeps the first request after a restart
 * correct instead of undefined.
 */
function get(key) {
  const def = BY_KEY.get(key);
  if (!def) {
    logger.warn(`[settings] unknown key requested: ${key}`);
    return undefined;
  }
  if (overrides.has(key)) return overrides.get(key);
  return defaultFor(def);
}

/** Everything the console needs to render the page. */
function snapshot(rows = []) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    groups: GROUPS.map((g) => ({
      ...g,
      settings: REGISTRY.filter((d) => d.group === g.id).map((d) => {
        const row = byKey.get(d.key);
        return {
          key: d.key,
          label: d.label,
          help: d.help ?? null,
          type: d.type,
          unit: d.unit ?? null,
          options: d.options ?? null,
          min: d.min ?? null,
          max: d.max ?? null,
          maxLength: d.maxLength ?? null,
          value: get(d.key),
          defaultValue: defaultFor(d),
          // 'override' means a row exists — which is also what makes Reset
          // meaningful, since resetting deletes the row.
          source: overrides.has(d.key) ? 'override' : 'default',
          updatedAt: row?.updatedAt ?? null,
          updatedByEmail: row?.updatedByEmail ?? null,
        };
      }),
    })).filter((g) => g.settings.length > 0),
    loaded,
  };
}

/**
 * Write a batch. Validates everything BEFORE writing anything, so a save either
 * lands whole or not at all — a half-applied pricing change is a real hazard.
 *
 * `null` as a value RESETS that key to its env default by deleting the row.
 */
async function set(entries, actor = {}) {
  const errors = {};
  const writes = [];
  const deletes = [];

  for (const [key, raw] of Object.entries(entries)) {
    const def = BY_KEY.get(key);
    if (!def) {
      errors[key] = 'unknown setting';
      continue;
    }
    if (raw === null) {
      deletes.push(key);
      continue;
    }
    const { value, error } = validate(def, raw);
    if (error) {
      errors[key] = error;
      continue;
    }
    writes.push({ key, value });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const now = new Date();
  await prisma.$transaction([
    ...deletes.map((key) => prisma.platformSetting.deleteMany({ where: { key } })),
    ...writes.map((w) =>
      prisma.platformSetting.upsert({
        where: { key: w.key },
        create: {
          key: w.key,
          value: String(w.value),
          updatedById: actor.id ?? null,
          updatedByEmail: actor.email ?? null,
        },
        update: {
          value: String(w.value),
          updatedAt: now,
          updatedById: actor.id ?? null,
          updatedByEmail: actor.email ?? null,
        },
      }),
    ),
  ]);

  await reload();
  // Tell the other instances. Best-effort: this instance is already correct.
  redis.publish(CHANNEL, String(Date.now())).catch(() => {});

  return { ok: true, changed: writes.map((w) => w.key), reset: deletes };
}

/**
 * The subset the mobile apps may read. Deliberately explicit: the apps get what
 * they need to display and nothing else, so adding an internal knob to the
 * registry can never leak it to a phone.
 */
function publicConfig() {
  return {
    announcement: get('APP_ANNOUNCEMENT_TEXT')
      ? { text: get('APP_ANNOUNCEMENT_TEXT'), level: get('APP_ANNOUNCEMENT_LEVEL') || 'info' }
      : null,
    bookingEnabled: get('RIDER_BOOKING_ENABLED') !== false,
    driverOnlineEnabled: get('DRIVER_ONLINE_ENABLED') !== false,
    supportPhone: get('SUPPORT_PHONE') || null,
    seatHoldMinutes: get('SEAT_HOLD_DURATION_MINUTES'),
    minFarePerSeatPesewas: get('RIDE_GROUP_MIN_FARE_PER_SEAT_PESEWAS'),
    driverRequiredWalletPesewas: get('DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS'),
    driverMinWithdrawalPesewas: get('DRIVER_MIN_WITHDRAWAL_PESEWAS'),
    /** How much a shared seat is uplifted per extra passenger — see calculateFare. */
    groupSeatUplift: get('RIDE_GROUP_SEAT_UPLIFT'),
    /**
     * ONE CARD, BOTH PRODUCTS.
     *
     * This used to publish the retired shared-trip knobs (`ECO_BASE_FARE_*`),
     * which no calculator reads any more — so any client estimating a price
     * from them would disagree with the server on every single trip. It now
     * publishes the tier card that actually prices both an on-demand ride and a
     * seat on a group trip, in full, so a client can show a breakdown that adds
     * up to what it is charged.
     */
    tiers: Object.fromEntries(
      ['ECO', 'COMFORT', 'PREMIUM'].map((t) => [
        t,
        {
          minFarePesewas: get(`RIDE_${t}_MIN_FARE_PESEWAS`),
          startFarePesewas: get(`RIDE_${t}_START_FARE_PESEWAS`),
          perKmRatePesewas: get(`RIDE_${t}_PER_KM_PESEWAS`),
          perMinRatePesewas: get(`RIDE_${t}_PER_MIN_PESEWAS`),
          waitPerMinPesewas: get(`RIDE_${t}_WAIT_PER_MIN_PESEWAS`),
          // Legacy alias: clients written against the old two-part card read
          // `baseFarePesewas`, and the start fare is the term it meant.
          baseFarePesewas: get(`RIDE_${t}_START_FARE_PESEWAS`),
        },
      ]),
    ),
    bookingFeeRate: get('RIDE_BOOKING_FEE_RATE'),
    platformFeePesewas: get('RIDE_PLATFORM_FEE_PESEWAS'),
  };
}

module.exports = { TYPES, REGISTRY, GROUPS, init, reload, get, set, snapshot, publicConfig, defaultFor };
