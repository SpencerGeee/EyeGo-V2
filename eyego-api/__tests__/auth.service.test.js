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
