const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');
const EventEmitter = require('events');
const { haversineMeters } = require('../utils/geo');

// In-memory fallback database
const memoryStore = new Map();
const memoryExpiry = new Map();
const pubSubBus = new EventEmitter();

class InMemoryRedis {
  constructor() {
    this.status = 'ready';
  }
  async get(key) {
    if (memoryExpiry.has(key) && memoryExpiry.get(key) < Date.now()) {
      memoryStore.delete(key);
      memoryExpiry.delete(key);
      return null;
    }
    return memoryStore.get(key) || null;
  }
  async set(key, value, mode, duration) {
    memoryStore.set(key, value);
    if (mode === 'EX' && duration) {
      memoryExpiry.set(key, Date.now() + duration * 1000);
    }
    return 'OK';
  }
  async del(key) {
    const deleted = memoryStore.delete(key);
    memoryExpiry.delete(key);
    return deleted ? 1 : 0;
  }
  async ttl(key) {
    if (!memoryStore.has(key)) return -2;
    if (!memoryExpiry.has(key)) return -1;
    const remaining = Math.max(0, Math.ceil((memoryExpiry.get(key) - Date.now()) / 1000));
    return remaining;
  }
  async zadd(key, score, member) {
    if (!memoryStore.has(key)) memoryStore.set(key, new Map());
    const zset = memoryStore.get(key);
    if (!(zset instanceof Map)) return 0;
    zset.set(member, Number(score));
    return 1;
  }
  async zremrangebyscore(key, min, max) {
    if (!memoryStore.has(key)) return 0;
    const zset = memoryStore.get(key);
    if (!(zset instanceof Map)) return 0;
    let removed = 0;
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);
    for (const [member, score] of zset.entries()) {
      if (score >= minScore && score <= maxScore) {
        zset.delete(member);
        removed++;
      }
    }
    return removed;
  }
  async zcount(key, min, max) {
    if (!memoryStore.has(key)) return 0;
    const zset = memoryStore.get(key);
    if (!(zset instanceof Map)) return 0;
    let count = 0;
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);
    for (const score of zset.values()) {
      if (score >= minScore && score <= maxScore) {
        count++;
      }
    }
    return count;
  }
  // BUGFIX: admin FCM token registration (SOS/safety alerts) uses sadd/smembers
  // — same "undefined called as a function" crash as geoadd/geosearch below,
  // just discovered on a different call path (registerAdminFcmToken, and the
  // driver-SOS / trip-request FCM broadcast that reads this set back).
  async sadd(key, ...members) {
    if (!memoryStore.has(key)) memoryStore.set(key, new Set());
    const set = memoryStore.get(key);
    if (!(set instanceof Set)) return 0;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) { set.add(m); added++; }
    }
    return added;
  }
  async smembers(key) {
    const set = memoryStore.get(key);
    return set instanceof Set ? Array.from(set) : [];
  }
  // BUGFIX: dispatch (driver online geoset + rider trip-request matching)
  // calls redis.geoadd/geosearch/georadius. Without a real Redis running,
  // this fallback previously had none of the three — every call threw
  // "not a function" (undefined called as a function), and since that's a
  // synchronous throw, the .catch() chained after it at every call site
  // never even got a chance to run. Drivers never landed in 'drivers:online'
  // and dispatch silently matched nobody, with no visible error anywhere.
  async geoadd(key, ...args) {
    if (!memoryStore.has(key)) memoryStore.set(key, new Map());
    const geoset = memoryStore.get(key);
    if (!(geoset instanceof Map)) return 0;
    let added = 0;
    for (let i = 0; i + 2 < args.length; i += 3) {
      const [lng, lat, member] = [Number(args[i]), Number(args[i + 1]), args[i + 2]];
      if (!geoset.has(member)) added++;
      geoset.set(member, { lng, lat });
    }
    return added;
  }
  _geoNearby(key, lng, lat, radiusKm, { order = 'ASC', count, withCoord = false } = {}) {
    const geoset = memoryStore.get(key);
    if (!(geoset instanceof Map)) return [];
    const results = [];
    for (const [member, pos] of geoset.entries()) {
      const distKm = haversineMeters(lat, lng, pos.lat, pos.lng) / 1000;
      if (distKm <= radiusKm) results.push({ member, distKm, pos });
    }
    results.sort((a, b) => (order === 'DESC' ? b.distKm - a.distKm : a.distKm - b.distKm));
    const limited = count != null ? results.slice(0, count) : results;
    return limited.map((r) => (withCoord ? [r.member, [r.pos.lng, r.pos.lat]] : r.member));
  }
  // Parses Redis 6.2+ GEOSEARCH's keyword-argument form: FROMLONLAT lng lat
  // BYRADIUS radius unit [ASC|DESC] [COUNT n] [WITHCOORD].
  async geosearch(key, ...args) {
    let lng, lat, radiusKm = 0, order, count, withCoord = false;
    for (let i = 0; i < args.length; i++) {
      const token = String(args[i]).toUpperCase();
      if (token === 'FROMLONLAT') { lng = Number(args[i + 1]); lat = Number(args[i + 2]); i += 2; }
      else if (token === 'BYRADIUS') {
        const unit = String(args[i + 2]).toLowerCase();
        radiusKm = unit === 'm' ? Number(args[i + 1]) / 1000 : Number(args[i + 1]);
        i += 2;
      } else if (token === 'ASC' || token === 'DESC') { order = token; }
      else if (token === 'COUNT') { count = Number(args[i + 1]); i += 1; }
      else if (token === 'WITHCOORD') { withCoord = true; }
    }
    return this._geoNearby(key, lng, lat, radiusKm, { order, count, withCoord });
  }
  // Parses the legacy GEORADIUS positional form: lng lat radius unit
  // [ASC|DESC] [COUNT n] [WITHCOORD].
  async georadius(key, lng, lat, radius, unit, ...rest) {
    let order, count, withCoord = false;
    for (let i = 0; i < rest.length; i++) {
      const token = String(rest[i]).toUpperCase();
      if (token === 'ASC' || token === 'DESC') order = token;
      else if (token === 'COUNT') { count = Number(rest[i + 1]); i += 1; }
      else if (token === 'WITHCOORD') withCoord = true;
    }
    const radiusKm = String(unit).toLowerCase() === 'm' ? Number(radius) / 1000 : Number(radius);
    return this._geoNearby(key, Number(lng), Number(lat), radiusKm, { order, count, withCoord });
  }
  async publish(channel, message) {
    pubSubBus.emit(channel, channel, message);
    return 1;
  }
  async subscribe(channel) {
    this.onMessage = (chan, msg) => {
      if (chan === channel) {
        this.emit('message', chan, msg);
      }
    };
    pubSubBus.on(channel, this.onMessage);
    return 1;
  }
  async unsubscribe(channel) {
    if (this.onMessage) {
      pubSubBus.off(channel, this.onMessage);
    }
    return 1;
  }
  duplicate() {
    return new InMemoryRedis();
  }
  on(event, cb) {
    this.addListener(event, cb);
    return this;
  }
  emit(event, ...args) {
    this.emitEvent ? this.emitEvent(event, ...args) : super.emit(event, ...args);
  }
  quit() {
    return Promise.resolve();
  }
}

// Inherit from EventEmitter for InMemoryRedis to support .on('message', ...)
Object.setPrototypeOf(InMemoryRedis.prototype, EventEmitter.prototype);

let client;
let useMemoryFallback = false;

try {
  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: (times) => {
      if (times > 2) {
        if (!useMemoryFallback) {
          logger.warn('Redis unavailable after retries. Falling back to safe In-Memory Redis...');
          useMemoryFallback = true;
        }
        return null; // give up
      }
      return 1000;
    },
  });

  client.on('connect', () => {
    logger.info('Redis connected');
    useMemoryFallback = false;
  });

  client.on('error', (err) => {
    logger.error('Redis error:', err.message);
    if (!useMemoryFallback) {
      logger.warn('Falling back to safe In-Memory Redis...');
      useMemoryFallback = true;
    }
  });

} catch (err) {
  logger.error('Failed to initialize Redis client:', err);
  useMemoryFallback = true;
}

// Proxy wrapper that delegates to real Redis or In-Memory Redis depending on connection state
const redisProxy = new Proxy({}, {
  get(target, prop) {
    if (prop === 'duplicate') {
      return () => {
        if (useMemoryFallback) return new InMemoryRedis();
        try {
          const dup = client.duplicate();
          dup.on('error', () => {}); // silence errors on duplicate
          return dup;
        } catch (_) {
          return new InMemoryRedis();
        }
      };
    }

    if (useMemoryFallback) {
      const fallback = new InMemoryRedis();
      if (typeof fallback[prop] === 'function') {
        return fallback[prop].bind(fallback);
      }
      return fallback[prop];
    }

    const value = client[prop];
    if (typeof value === 'function') {
      return (...args) => {
        try {
          const result = value.apply(client, args);
          if (result && typeof result.catch === 'function') {
            return result.catch((err) => {
              logger.warn(`Redis command '${prop}' failed, using in-memory fallback:`, err.message);
              useMemoryFallback = true;
              const fallback = new InMemoryRedis();
              return typeof fallback[prop] === 'function' ? fallback[prop].bind(fallback)(...args) : fallback[prop];
            });
          }
          return result;
        } catch (err) {
          logger.warn(`Redis command '${prop}' threw, using in-memory fallback:`, err.message);
          useMemoryFallback = true;
          const fallback = new InMemoryRedis();
          return typeof fallback[prop] === 'function' ? fallback[prop].bind(fallback)(...args) : fallback[prop];
        }
      };
    }
    return value;
  }
});

module.exports = redisProxy;
