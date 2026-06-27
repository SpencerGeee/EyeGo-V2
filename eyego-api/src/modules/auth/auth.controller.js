'use strict';

const authService = require('./auth.service');
const { blacklistToken } = require('../../middleware/auth');
const { ok } = require('../../utils/response');

const requestOtp = async (req, res) => {
  const { phone } = req.body;
  const result = await authService.requestPassengerOtp(phone);
  ok(res, result, 'OTP sent');
};

const verifyOtp = async (req, res) => {
  const { phone, otp } = req.body;
  const result = await authService.verifyPassengerOtp(phone, otp);
  ok(res, result, result.isNewUser ? 'Welcome to EyeGo!' : 'Welcome back!');
};

const googleAuth = async (req, res) => {
  const { idToken } = req.body;
  const result = await authService.handleGoogleAuth(idToken);
  ok(res, result, 'Authenticated with Google');
};

const appleAuth = async (req, res) => {
  const { idToken } = req.body;
  const result = await authService.handleAppleAuth(idToken);
  ok(res, result, 'Authenticated with Apple');
};

const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshPassengerToken(refreshToken);
  ok(res, result, 'Token refreshed');
};

const logout = async (req, res) => {
  // Blacklist the current access token so it cannot be reused after logout
  const token = req.headers.authorization?.split(' ')[1];
  await blacklistToken(token);
  // Revoke the refresh token stored in DB (tokenId embedded in the access token)
  const { tokenId } = req.user;
  if (tokenId) await authService.logout(tokenId);
  ok(res, null, 'Logged out');
};

const driverRequestOtp = async (req, res) => {
  const { phone } = req.body;
  const result = await authService.requestDriverOtp(phone);
  ok(res, result, 'OTP sent');
};

const driverVerifyOtp = async (req, res) => {
  const { phone, otp } = req.body;
  const result = await authService.verifyDriverOtp(phone, otp);
  ok(res, result, result.isNewDriver ? 'Account created. Complete your profile.' : 'Welcome back, driver!');
};

const driverRefresh = async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshDriverToken(refreshToken);
  ok(res, result, 'Token refreshed');
};

module.exports = {
  requestOtp, verifyOtp, googleAuth, appleAuth, refresh, logout,
  driverRequestOtp, driverVerifyOtp, driverRefresh,
};
