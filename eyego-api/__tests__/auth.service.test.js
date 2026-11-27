'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const mockUser = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockRefreshToken = {
  create: jest.fn(),
  findUnique: jest.fn(),
  updateMany: jest.fn(),
  upsert: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  user: mockUser,
  refreshToken: mockRefreshToken,
}));

jest.mock('../src/services/otp.service', () => ({
  storeOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

jest.mock('../src/services/sms.service', () => ({
  sendOtp: jest.fn(),
}));

const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => {
  const mockAuth = { verifyIdToken: mockVerifyIdToken };
  return {
    auth: () => mockAuth,
  };
});

const authService = require('../src/modules/auth/auth.service');
const otpService = require('../src/services/otp.service');
const smsService = require('../src/services/sms.service');

describe('auth.service passenger authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestPassengerOtp', () => {
    it('requests OTP and calls SMS service', async () => {
      otpService.storeOtp.mockResolvedValue('123456');
      smsService.sendOtp.mockResolvedValue({ success: true });

      const result = await authService.requestPassengerOtp('+233240000000');

      expect(otpService.storeOtp).toHaveBeenCalledWith('+233240000000');
      expect(smsService.sendOtp).toHaveBeenCalledWith('+233240000000', '123456');
      expect(result).toHaveProperty('message');
    });
  });

  describe('verifyPassengerOtp', () => {
    it('authenticates existing user when OTP is correct', async () => {
      otpService.verifyOtp.mockResolvedValue(true);
      const testUser = { id: 'u1', phone: '+233240000000', name: 'John Doe', isActive: true };
      mockUser.findUnique.mockResolvedValue(testUser);

      const result = await authService.verifyPassengerOtp('+233240000000', '123456');

      expect(otpService.verifyOtp).toHaveBeenCalledWith('+233240000000', '123456');
      expect(mockUser.findUnique).toHaveBeenCalledWith({ where: { phone: '+233240000000' } });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual(testUser);
      expect(result.isNewUser).toBe(false);
      expect(mockRefreshToken.create).toHaveBeenCalled();
    });

    it('creates new user if phone not found', async () => {
      otpService.verifyOtp.mockResolvedValue(true);
      mockUser.findUnique.mockResolvedValue(null);
      const newUser = { id: 'u2', phone: '+233240000001', name: '', isActive: true };
      mockUser.create.mockResolvedValue(newUser);

      const result = await authService.verifyPassengerOtp('+233240000001', '123456');

      expect(mockUser.create).toHaveBeenCalledWith({
        data: { phone: '+233240000001', name: '', authProvider: 'PHONE' },
      });
      expect(result.isNewUser).toBe(true);
      expect(result.user).toEqual(newUser);
    });

    it('throws AuthError if user is inactive', async () => {
      otpService.verifyOtp.mockResolvedValue(true);
      mockUser.findUnique.mockResolvedValue({ id: 'u1', phone: '+233240000000', name: 'Banned', isActive: false });

      await expect(authService.verifyPassengerOtp('+233240000000', '123456')).rejects.toThrow('Your account has been deactivated');
    });
  });

  describe('handleGoogleAuth', () => {
    it('authenticates user with Google credentials verified via Firebase', async () => {
      const decodedToken = { email: 'john@gmail.com', name: 'John', picture: 'pic.jpg', uid: 'google123' };
      mockVerifyIdToken.mockResolvedValue(decodedToken);
      const existingUser = { id: 'u1', email: 'john@gmail.com', name: 'John', isActive: true };
      mockUser.findFirst.mockResolvedValue(existingUser);

      const result = await authService.handleGoogleAuth('fake-id-token');

      expect(mockVerifyIdToken).toHaveBeenCalledWith('fake-id-token');
      expect(mockUser.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { phone: 'google_google123' },
            { email: 'john@gmail.com' },
          ],
        },
      });
      expect(result.user).toEqual(existingUser);
      expect(result.isNewUser).toBe(false);
    });
  });
});

describe('refresh rotation is replayable (run 45902035048)', () => {
  const env = require('../src/config/env');
  const authService = require('../src/modules/auth/auth.service');
  let rows;
  const issue = (tokenId) => jwt.sign({ userId: 'u1', role: 'PASSENGER', tokenId, type: 'refresh' }, env.JWT_REFRESH_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
    rows = new Map();
    mockRefreshToken.findUnique.mockImplementation(async ({ where }) => rows.get(where.tokenId) || null);
    mockRefreshToken.updateMany.mockImplementation(async ({ where, data }) => {
      const r = rows.get(where.tokenId); if (r && !r.revokedAt) Object.assign(r, data);
    });
    mockRefreshToken.upsert.mockImplementation(async ({ where, create }) => {
      if (!rows.has(where.tokenId)) rows.set(where.tokenId, { ...create, revokedAt: null });
    });
    mockUser.findUnique.mockResolvedValue({ isActive: true });
    rows.set('t0', { tokenId: 't0', revokedAt: null, expiresAt: new Date(Date.now() + 1e9) });
  });

  it('a lost refresh response does not sign the user out; a stolen predecessor dies after one real refresh', async () => {
    const old = issue('t0');
    const first = await authService.refreshPassengerToken(old);      // response "lost"
    rows.get('t0').revokedAt = new Date(Date.now() - 13 * 60 * 1000); // 13 min later, past grace
    const replay = await authService.refreshPassengerToken(old);     // client retries with the old token
    const a = jwt.decode(first.refreshToken).tokenId;
    expect(jwt.decode(replay.refreshToken).tokenId).toBe(a);

    await authService.refreshPassengerToken(replay.refreshToken);    // real client moves on
    await expect(authService.refreshPassengerToken(old)).rejects.toThrow('Refresh token revoked');
  });
});
