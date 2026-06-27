const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');
const EventEmitter = require('events');

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
