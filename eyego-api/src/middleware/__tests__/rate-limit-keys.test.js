'use strict';

jest.mock('../../config/env', () => ({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret' }));
jest.mock('../../config/redis', () => ({ sendCommand: async () => 'script-sha' }));

const jwt = require('jsonwebtoken');
const { whoIsAsking } = require('../rateLimiter');

const SECRET = 'test-secret-test-secret-test-secret';
const reqWith = (token) => ({ ip: '41.66.0.1', headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('global rate-limit key', () => {
  it('a rider or driver is their own bucket, not their carrier IP', () => {
    expect(whoIsAsking(reqWith(jwt.sign({ userId: 'u1', role: 'PASSENGER' }, SECRET)))).toBe('u:u1');
  });
  it('console staff are keyed per admin (they all arrive from the console server)', () => {
    expect(whoIsAsking(reqWith(jwt.sign({ adminId: 'a1', type: 'admin_access' }, SECRET)))).toBe('a:a1');
  });
  it('a forged or missing token counts against the IP', () => {
    expect(whoIsAsking(reqWith(jwt.sign({ userId: 'u1' }, 'wrong-secret')))).toBe('ip:41.66.0.1');
    expect(whoIsAsking(reqWith(null))).toBe('ip:41.66.0.1');
  });
});
