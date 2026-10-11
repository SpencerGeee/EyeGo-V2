'use strict';

const { EventEmitter } = require('events');
const { guardListeners } = require('../middleware/guardListeners');

describe('guardListeners', () => {
  it('a bare or null payload reaches the handler as {}, and a throw stays inside the socket', async () => {
    const socket = new EventEmitter();
    guardListeners(socket);
    const seen = [];
    socket.on('leave', ({ tripId }) => seen.push(tripId));
    socket.on('boom', () => { throw new Error('sync'); });
    socket.on('later', async () => { throw new Error('async'); });

    expect(() => socket.emit('leave')).not.toThrow();
    expect(() => socket.emit('leave', null)).not.toThrow();
    socket.emit('leave', { tripId: 't1' });
    expect(seen).toEqual([undefined, undefined, 't1']);
    expect(() => socket.emit('boom')).not.toThrow();
    socket.emit('later');
    await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run
  });

  it('leaves an ack-only emit alone', () => {
    const socket = new EventEmitter();
    guardListeners(socket);
    let got;
    socket.on('time:sync', (_p, cb) => { got = cb; });
    const ack = () => {};
    socket.emit('time:sync', undefined, ack);
    expect(got).toBe(ack);
  });
});
