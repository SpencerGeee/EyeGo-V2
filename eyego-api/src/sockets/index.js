'use strict';

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const socketAuth = require('./middleware/socketAuth');
const registerDriverSocket = require('./driver.socket');
const registerPassengerSocket = require('./passenger.socket');
const registerResumeProtocol = require('./resume.socket');
const logger = require('../utils/logger');
const redis = require('../config/redis');
const publisher = require('../services/trip-events.publisher');

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://eyego.app', 'https://driver.eyego.app']
        : '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // ── Redis adapter ─────────────────────────────────────
  //
  // THE PREREQUISITE FOR A SECOND INSTANCE EXISTING AT ALL. Without it, a
  // rider connected to instance A never receives an emit issued on instance B
  // — so every `io.to(room).emit(...)` in this codebase was silently
  // single-instance-only, and horizontal scale was impossible regardless of
  // what the load balancer did.
  //
  // Two dedicated connections: the adapter's subscriber blocks on SUBSCRIBE
  // and cannot be shared with the command client.
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));

  // The single publisher every trip event goes out through.
  publisher.setIo(io);

  // ── /passenger namespace ──────────────────────────────
  const passengerNs = io.of('/passenger');
  passengerNs.use(socketAuth('PASSENGER'));
  registerPassengerSocket(io, passengerNs);
  registerResumeProtocol(passengerNs, 'RIDER');

  // ── /driver namespace ─────────────────────────────────
  const driverNs = io.of('/driver');
  driverNs.use(socketAuth('DRIVER'));
  registerDriverSocket(io, driverNs);
  registerResumeProtocol(driverNs, 'DRIVER');

  // ── /admin namespace (Live Map real-time updates) ──────────────
  // Same secret as the REST adminAuth middleware — validated through zod
  // (no hardcoded fallback: the old 'admin-eyego-2024' default meant a
  // misconfigured deploy silently accepted a publicly-guessable secret)
  // and compared constant-time.
  const crypto = require('crypto');
  const env = require('../config/env');
  const adminNs = io.of('/admin');
  adminNs.use((socket, next) => {
    const secret = socket.handshake.auth?.secret || socket.handshake.query?.secret;
    const ha = crypto.createHash('sha256').update(String(secret ?? '')).digest();
    const hb = crypto.createHash('sha256').update(String(env.ADMIN_SECRET_KEY)).digest();
    if (secret && crypto.timingSafeEqual(ha, hb)) {
      next();
    } else {
      next(new Error('Unauthorized'));
    }
  });
  adminNs.on('connection', (socket) => {
    logger.info('Admin connected to live map');

    // Subscribe to driver location updates via Redis
    // Use a unique subscriber so we don't interfere with the main client
    const adminSub = redis.duplicate();
    adminSub.subscribe('admin:driver_locations');

    adminSub.on('message', (channel, message) => {
      try {
        const parsed = JSON.parse(message);
        socket.emit('driver:location_update', parsed);
      } catch (e) {
        // ignore malformed messages
      }
    });

    socket.on('disconnect', () => {
      try { adminSub.unsubscribe('admin:driver_locations'); } catch (_) {}
      try { adminSub.quit(); } catch (_) {}
      logger.info('Admin disconnected from live map');
    });
  });


  io.engine.on('connection_error', (err) => {
    logger.error('Socket.io connection error:', err);
  });

  logger.info('Socket.io server initialized (/passenger, /driver namespaces)');
  return io;
}

module.exports = initSocketServer;
