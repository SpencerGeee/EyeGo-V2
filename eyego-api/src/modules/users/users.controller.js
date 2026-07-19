'use strict';

const usersService = require('./users.service');
const { ok } = require('../../utils/response');

const getMe = async (req, res) => {
  const user = await usersService.getMe(req.user.userId);
  ok(res, { user });
};

const updateMe = async (req, res) => {
  const user = await usersService.updateMe(req.user.userId, req.body);
  ok(res, { user }, 'Profile updated');
};

const uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  const user = await usersService.updateProfilePhoto(req.user.userId, req.file.buffer);
  ok(res, { avatarUrl: user.profilePhoto }, 'Avatar uploaded');
};

const updateFcmToken = async (req, res) => {
  await usersService.updateFcmToken(req.user.userId, req.body.fcmToken);
  ok(res, null, 'FCM token updated');
};

const deleteMe = async (req, res) => {
  await usersService.deactivateAccount(req.user.userId);
  ok(res, null, 'Account deactivated');
};

const getWalletAndPromos = async (req, res) => {
  const result = await usersService.getWalletAndPromos(req.user.userId);
  ok(res, result);
};

const createSupportTicket = async (req, res) => {
  const { subject, message } = req.body;
  const ticket = await usersService.createSupportTicket(req.user.userId, subject, message);
  ok(res, { ticket }, 'Support ticket created');
};

const getSupportTickets = async (req, res) => {
  const tickets = await usersService.getSupportTickets(req.user.userId);
  ok(res, { tickets });
};

const getSupportTicket = async (req, res) => {
  const ticket = await usersService.getSupportTicket(req.user.userId, req.params.ticketId);
  ok(res, { ticket });
};

const addTicketMessage = async (req, res) => {
  const message = await usersService.addTicketMessage(req.user.userId, req.params.ticketId, req.body.text);
  ok(res, { message }, 'Message added');
};

const getNotificationPreferences = async (req, res) => {
  const prefs = await usersService.getNotificationPreferences(req.user.userId);
  ok(res, { prefs });
};

const updateNotificationPreferences = async (req, res) => {
  const result = await usersService.updateNotificationPreferences(req.user.userId, req.body);
  ok(res, result, 'Notification preferences updated');
};

const getEmergencyContacts = async (req, res) => {
  const contacts = await usersService.getEmergencyContacts(req.user.userId);
  ok(res, { contacts });
};

const syncEmergencyContacts = async (req, res) => {
  const contacts = await usersService.syncEmergencyContacts(req.user.userId, req.body.contacts ?? []);
  ok(res, { contacts }, 'Emergency contacts saved');
};

const getSafetySettings = async (req, res) => {
  const settings = await usersService.getSafetySettings(req.user.userId);
  ok(res, { settings });
};

const updateSafetySettings = async (req, res) => {
  const settings = await usersService.updateSafetySettings(req.user.userId, req.body ?? {});
  ok(res, { settings }, 'Safety settings saved');
};

const uploadInsurance = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  const settings = await usersService.updateInsuranceCard(req.user.userId, req.file.buffer);
  ok(res, { insuranceCardUrl: settings.insuranceCardUrl }, 'Insurance card uploaded');
};

const getPrivacySettings = async (req, res) => {
  const settings = await usersService.getPrivacySettings(req.user.userId);
  ok(res, { settings });
};

const updatePrivacySettings = async (req, res) => {
  const settings = await usersService.updatePrivacySettings(req.user.userId, req.body ?? {});
  ok(res, { settings }, 'Privacy settings saved');
};

const getSavedPlaces = async (req, res) => {
  const places = await usersService.getSavedPlaces(req.user.userId);
  ok(res, { places });
};

const createSavedPlace = async (req, res) => {
  const place = await usersService.createSavedPlace(req.user.userId, req.body);
  ok(res, { place }, 'Place saved');
};

const deleteSavedPlace = async (req, res) => {
  await usersService.deleteSavedPlace(req.user.userId, req.params.placeId);
  ok(res, {}, 'Place removed');
};

module.exports = { getMe, updateMe, uploadAvatar, updateFcmToken, deleteMe, getWalletAndPromos, createSupportTicket, getSupportTickets, getSupportTicket, addTicketMessage, getNotificationPreferences, updateNotificationPreferences, getEmergencyContacts, syncEmergencyContacts, getSafetySettings, updateSafetySettings, uploadInsurance, getPrivacySettings, updatePrivacySettings, getSavedPlaces, createSavedPlace, deleteSavedPlace };
