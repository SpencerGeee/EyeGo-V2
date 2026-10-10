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
