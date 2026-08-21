'use strict';

const usersService = require('./users.service');
const { blacklistToken } = require('../../middleware/auth');
const { ok } = require('../../utils/response');

const getMe = async (req, res) => {
  const user = await usersService.getMe(req.user.userId);
  ok(res, { user });
};

const getAccountChecklist = async (req, res) => {
  const checklist = await usersService.getAccountChecklist(req.user.userId);
  ok(res, checklist);
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

const getPreferences = async (req, res) => {
  const preferences = await usersService.getPreferences(req.user.userId);
  ok(res, { preferences });
};

const updatePreferences = async (req, res) => {
  const preferences = await usersService.updatePreferences(req.user.userId, req.body);
  ok(res, { preferences }, 'Preferences updated');
};

/**
 * DELETING YOUR ACCOUNT LEFT YOUR ACCESS TOKEN WORKING.
 *
 * `deactivateAccount` does the right things in the database — flips
 * `isActive`, anonymises the row, revokes every refresh token — but nothing
 * touched the ACCESS token, and `authenticate` verifies the JWT signature and
 * the blacklist without ever asking whether the account still exists. So for
 * the remaining lifetime of that token the deleted account could still book
 * rides, spend its wallet and read the profile. Confirmed by E2E: `DELETE
 * /user/me` followed by `GET /user/me` returned 200.
 *
 * `logout` already solves exactly this, with the same blacklist, so deletion
 * does what logout does and then some. The blacklist call comes first: if it
 * fails we have not yet told the user their account is gone.
 */
const deleteMe = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) await blacklistToken(token);
  await usersService.deactivateAccount(req.user.userId);
  ok(res, null, 'Account deactivated');
};

const getWalletAndPromos = async (req, res) => {
  const result = await usersService.getWalletAndPromos(req.user.userId);
  ok(res, result);
};

/** Everything the promotions screen renders: applied, available, used. */
const getPromotions = async (req, res) => {
  ok(res, await usersService.getPromotions(req.user.userId));
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

module.exports = {
  getAccountChecklist, getPreferences, updatePreferences, getMe, updateMe, uploadAvatar, updateFcmToken, deleteMe, getWalletAndPromos, getPromotions, createSupportTicket, getSupportTickets, getSupportTicket, addTicketMessage, getNotificationPreferences, updateNotificationPreferences, getEmergencyContacts, syncEmergencyContacts, getSafetySettings, updateSafetySettings, uploadInsurance, getPrivacySettings, updatePrivacySettings, getSavedPlaces, createSavedPlace, deleteSavedPlace };
