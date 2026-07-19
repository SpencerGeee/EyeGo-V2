'use strict';

const prisma = require('../../config/database');
const cloudinary = require('../../services/cloudinary.service');
const { NotFoundError, ForbiddenError, AppError } = require('../../utils/errors');

async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, phone: true, email: true, name: true, dob: true,
      profilePhoto: true, preferredTier: true, authProvider: true, createdAt: true,
      businessMode: true, businessCompanyName: true, businessTaxId: true, businessExpenseEmail: true,
    },
  });
  if (!user) throw new NotFoundError('User');
  return {
    ...user,
    avatarUrl: user.profilePhoto,
  };
}

async function updateMe(userId, data) {
  const allowed = {};
  if (data.name) allowed.name = data.name;
  if (data.preferredTier) allowed.preferredTier = data.preferredTier;
  if (data.email) allowed.email = data.email;
  if (data.dob) allowed.dob = data.dob;
  if (data.profilePhoto) allowed.profilePhoto = data.profilePhoto;
  if (data.avatarUrl) allowed.profilePhoto = data.avatarUrl;
  if (typeof data.businessMode === 'boolean') allowed.businessMode = data.businessMode;
  if (data.businessCompanyName !== undefined) allowed.businessCompanyName = data.businessCompanyName || null;
  if (data.businessTaxId !== undefined) allowed.businessTaxId = data.businessTaxId || null;
  if (data.businessExpenseEmail !== undefined) allowed.businessExpenseEmail = data.businessExpenseEmail || null;

  const user = await prisma.user.update({ where: { id: userId }, data: allowed });
  return {
    ...user,
    avatarUrl: user.profilePhoto,
  };
}

async function updateProfilePhoto(userId, fileBuffer) {
  const url = await cloudinary.uploadBuffer(fileBuffer, {
    folder: 'eyego/profiles',
    transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
  });
  return prisma.user.update({ where: { id: userId }, data: { profilePhoto: url } });
}

async function updateFcmToken(userId, fcmToken) {
  return prisma.user.update({ where: { id: userId }, data: { fcmToken } });
}

async function deactivateAccount(userId) {
  return prisma.user.update({ where: { id: userId }, data: { isActive: false } });
}

async function getWalletAndPromos(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletBalance: true }
  });
  if (!user) throw new NotFoundError('User');

  const promos = await prisma.promotion.findMany({
    where: { active: true, expiry: { gt: new Date() } }
  });

  const referrals = await prisma.referral.findMany({
    where: { inviterId: userId },
    include: { invitee: { select: { name: true, createdAt: true } } }
  });

  return { walletBalance: user.walletBalance, promos, referrals };
}

async function createSupportTicket(userId, subject, message) {
  return prisma.supportTicket.create({
    data: {
      userId,
      subject,
      messages: {
        create: {
          senderId: userId,
          text: message
        }
      }
    },
    include: { messages: true }
  });
}

async function getSupportTickets(userId) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' }
  });
}

async function getSupportTicket(userId, ticketId) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });
  if (!ticket) throw new NotFoundError('SupportTicket');
  if (ticket.userId !== userId) throw new ForbiddenError();
  return ticket;
}

async function updateNotificationPreferences(userId, prefs) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  if (!user) throw new NotFoundError('User');

  // Merge incoming prefs with existing so partial updates don't overwrite unrelated fields
  const existing = user.notificationPrefs ? JSON.parse(user.notificationPrefs) : {};
  const merged = { ...existing, ...prefs };

  await prisma.user.update({
    where: { id: userId },
    data: { notificationPrefs: JSON.stringify(merged) },
  });

  return { success: true, prefs: merged };
}

async function getNotificationPreferences(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  if (!user) throw new NotFoundError('User');
  return user.notificationPrefs ? JSON.parse(user.notificationPrefs) : {};
}

async function addTicketMessage(userId, ticketId, text) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError('SupportTicket');
  if (ticket.userId !== userId) throw new ForbiddenError();

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: userId,
      text
    }
  });

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { updatedAt: new Date() }
  });

  return message;
}

async function getEmergencyContacts(userId) {
  return prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, phone: true },
  });
}

async function syncEmergencyContacts(userId, contacts) {
  if (contacts.length > 3) throw new AppError('Maximum 3 emergency contacts allowed', 400);
  // Replace all contacts atomically — simplest approach for a small, bounded list
  await prisma.$transaction([
    prisma.emergencyContact.deleteMany({ where: { userId } }),
    ...contacts.map((c) =>
      prisma.emergencyContact.create({ data: { userId, name: c.name.trim(), phone: c.phone.trim() } })
    ),
  ]);
  return prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, phone: true },
  });
}

// Generic JSON-blob settings accessors — same storage pattern as
// notificationPrefs: a nullable String column holding a merged JSON object.
async function getSettingsBlob(userId, column) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { [column]: true },
  });
  if (!user) throw new NotFoundError('User');
  return user[column] ? JSON.parse(user[column]) : {};
}

async function updateSettingsBlob(userId, column, patch) {
  const current = await getSettingsBlob(userId, column);
  const merged = { ...current, ...patch };
  await prisma.user.update({
    where: { id: userId },
    data: { [column]: JSON.stringify(merged) },
  });
  return merged;
}

const getSafetySettings = (userId) => getSettingsBlob(userId, 'safetySettings');
const updateSafetySettings = (userId, patch) => updateSettingsBlob(userId, 'safetySettings', patch);

async function updateInsuranceCard(userId, fileBuffer) {
  const url = await cloudinary.uploadBuffer(fileBuffer, {
    folder: 'eyego/insurance',
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
  });
  return updateSettingsBlob(userId, 'safetySettings', { insuranceCardUrl: url });
}
const getPrivacySettings = (userId) => getSettingsBlob(userId, 'privacySettings');
const updatePrivacySettings = (userId, patch) => updateSettingsBlob(userId, 'privacySettings', patch);

async function getSavedPlaces(userId) {
  return prisma.savedPlace.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, address: true, lat: true, lng: true, icon: true },
  });
}

async function createSavedPlace(userId, { label, address, lat, lng, icon }) {
  const count = await prisma.savedPlace.count({ where: { userId } });
  if (count >= 20) throw new AppError('Maximum 20 saved places allowed', 400);
  return prisma.savedPlace.create({
    data: { userId, label: label.trim(), address: address.trim(), lat, lng, icon: icon ?? null },
    select: { id: true, label: true, address: true, lat: true, lng: true, icon: true },
  });
}

async function deleteSavedPlace(userId, placeId) {
  const place = await prisma.savedPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) throw new NotFoundError('Saved place');
  await prisma.savedPlace.delete({ where: { id: placeId } });
}

module.exports = { getMe, updateMe, updateProfilePhoto, updateFcmToken, deactivateAccount, getWalletAndPromos, createSupportTicket, getSupportTickets, getSupportTicket, addTicketMessage, updateNotificationPreferences, getNotificationPreferences, getEmergencyContacts, syncEmergencyContacts, getSafetySettings, updateSafetySettings, updateInsuranceCard, getPrivacySettings, updatePrivacySettings, getSavedPlaces, createSavedPlace, deleteSavedPlace };
