'use strict';

const logger = require('../../utils/logger');

/**
 * socket.io runs every listener on process.nextTick, so one that throws is an
 * uncaughtException — and server.js exits on those. Nearly every handler
 * destructures its payload (`({ tripId }) => …`), so a bare
 * `emit('passenger:leave_trip_room')`, or one with `null`, from any signed-in
 * client took the whole API down. Wrapped once per socket, before the handlers
 * are registered, rather than in each of them.
 */
function guardListeners(socket) {
  const on = socket.on.bind(socket);
  socket.on = (event, fn) => on(event, (...args) => {
    if (args[0] == null) args[0] = {};
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((err) => logger.error(`socket ${event} failed:`, err));
    } catch (err) {
      logger.error(`socket ${event} failed:`, err);
    }
  });
}

module.exports = { guardListeners };
