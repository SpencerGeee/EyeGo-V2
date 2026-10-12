'use strict';

const { streakOf } = require('../fatigue.service');

const H = 3_600_000;
const now = new Date('2026-10-10T20:00:00Z');
const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * H);
const BREAK = 6 * H;

describe('fatigue streak', () => {
  it('sums sessions separated by short gaps, newest first', () => {
    const sessions = [
      { startTime: at(5), endTime: null }, // online now for 5 h
      { startTime: at(12), endTime: at(6) }, // 1 h tea break before that, 6 h
    ];
    expect(streakOf(sessions, now, BREAK).streakMs).toBe(11 * H);
  });
  it('stops at a real break', () => {
    const sessions = [
      { startTime: at(3), endTime: null },
      { startTime: at(20), endTime: at(10) }, // 7 h off between → not part of this stretch
    ];
    expect(streakOf(sessions, now, BREAK).streakMs).toBe(3 * H);
  });
  it('a stale open session ends where the next began', () => {
    const sessions = [
      { startTime: at(2), endTime: null },
      { startTime: at(4), endTime: null }, // app killed; never closed
    ];
    expect(streakOf(sessions, now, BREAK).streakMs).toBe(4 * H);
  });
  it('is rested after a full break offline', () => {
    const sessions = [{ startTime: at(20), endTime: at(7) }];
    expect(streakOf(sessions, now, BREAK).streakMs).toBe(0);
  });
});

describe('closeAbandonedSessions', () => {
  const NOW = new Date('2026-10-12T08:00:00Z');
  const mins = (m) => new Date(NOW.getTime() - m * 60_000);

  function load({ present, presenceThrows = false }) {
    jest.resetModules();
    const calls = { offline: [], ended: [] };
    jest.doMock('../../config/database', () => ({
      driver: { updateMany: jest.fn(async ({ where }) => { calls.offline.push(where.id); return { count: 1 }; }) },
      onlineSession: {
        findMany: jest.fn(async ({ where }) => [{ id: `s-${where.driverId}`, startTime: mins(600) }]),
        update: jest.fn(async ({ where, data }) => { calls.ended.push([where.id, data.endTime.toISOString()]); }),
      },
    }));
    jest.doMock('../../config/redis', () => ({ zrem: jest.fn(async () => 0), set: jest.fn(async () => 'OK') }));
    jest.doMock('../supply-index.service', () => ({
      whichArePresent: jest.fn(async () => { if (presenceThrows) throw new Error('redis down'); return new Set(present); }),
      removeDriver: jest.fn(async () => {}),
    }));
    return { svc: require('../fatigue.service'), calls };
  }

  it('closes only drivers with no presence for 10 min, at their last write', async () => {
    const { svc, calls } = load({ present: ['here'] });
    const closed = await svc.closeAbandonedSessions([
      { id: 'here', updatedAt: mins(30) },        // presence key alive → online
      { id: 'gone', updatedAt: mins(480) },       // phone dead for 8 h
      { id: 'blip', updatedAt: mins(2) },         // inside the window → leave it
    ], NOW);
    expect(closed).toEqual(['gone']);
    expect(calls.offline).toEqual(['gone']);
    expect(calls.ended).toEqual([['s-gone', mins(480).toISOString()]]); // not "now"
  });

  it('a presence outage changes nothing', async () => {
    const { svc, calls } = load({ present: [], presenceThrows: true });
    expect(await svc.closeAbandonedSessions([{ id: 'x', updatedAt: mins(500) }], NOW)).toEqual([]);
    expect(calls.offline).toEqual([]);
  });
});
