'use strict';

const prisma = require('../../config/database');
const cloudinary = require('../../services/cloudinary.service');
const { NotFoundError, ForbiddenError, AppError } = require('../../utils/errors');
// Owns the whole reputation model (rating window, reliability, reports, and the
// loyalty discount pricing reads). See services/standing.service.js.
const standingService = require('../../services/standing.service');

async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, phone: true, email: true, name: true, dob: true,
      profilePhoto: true, preferredTier: true, authProvider: true, createdAt: true,
      businessMode: true, businessCompanyName: true, businessTaxId: true, businessExpenseEmail: true,
      requireBoardingPin: true,
    },
  });
  if (!user) throw new NotFoundError('User');

  /**
   * The rider's own rating.
   *
   * The profile screen reads `rating` off this payload and hides its chip when
   * the value is missing — which it always was, because `User` has no `rating`
   * column and nothing here ever computed one. Riders are rated: drivers write
   * `PassengerRating` rows after every trip. Nobody was reading them back, so
   * "I can't view my ratings" was literally true — the number existed in the
   * database and had no route to the app.
   *
   * Aggregated on read rather than denormalised onto User: ratings arrive a
   * handful of times per rider per week and this is one indexed aggregate, so
   * a cached column would buy nothing and could go stale.
   */
  const agg = await prisma.passengerRating.aggregate({
    where: { userId },
    _avg: { stars: true },
    _count: { stars: true },
  });

  /**
   * STANDING — the rating, plus what it is worth.
   *
   * `rating` above is the raw lifetime mean and stays exactly as it was, because
   * it is what the profile chip has always shown. `standing` is the fuller
   * picture the behaviour system needs: a recency-weighted rating, a reliability
   * figure built from completions vs the rider's OWN cancellations, upheld
   * reports, and the loyalty discount those have earned — the same numbers
   * `fare-quote.service` prices against, so the discount a rider is shown here
   * is by construction the discount they get charged.
   *
   * Non-fatal: a profile must still load if the standing rollup fails.
   */
  const standing = await standingService.riderStanding(userId).catch(() => null);

  return {
    ...user,
    avatarUrl: user.profilePhoto,
    // Null, never 0, when nobody has rated yet — the client treats 0 as "no
    // rating" too, but a real 0 and an absent one should not look the same.
    rating: agg._count.stars > 0 ? Number(agg._avg.stars.toFixed(2)) : null,
    ratingCount: agg._count.stars,
    standing,
  };
}

/**
 * ACCOUNT COMPLETENESS — "is there anything I still need to fill in?"
 *
 * Uber and Bolt both answer this without being asked, because the fields that go
 * unfilled are exactly the ones that matter when something goes wrong: no email
 * means no receipt and no way back into a locked account, no emergency contact
 * means SOS has nobody to notify, no photo means the driver cannot confirm who
 * they are collecting. Reported here as "the email field is empty but there's no
 * way for me to add it" — the field existed, buried two screens deep, and nothing
 * ever prompted for it.
 *
 * Server-side on purpose: the same answer then drives the rider app's prompt, the
 * admin console's view of an account, and anything added later. A client-side
 * checklist would drift from what the server actually requires.
 *
 * `severity` is what the UI sorts and colours by:
 *   required    — the account is not safe to operate without it
 *   recommended — a real gap, but the rider can ride today
 *   optional    — a feature they may simply not want
 */
async function getAccountChecklist(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, phone: true, email: true, profilePhoto: true,
      preferredTier: true, requireBoardingPin: true,
      authProvider: true, createdAt: true,
    },
  });
  if (!user) throw new NotFoundError('User');

  const [savedPlaces, paidBookings, contactRows, firstContact] = await Promise.all([
    prisma.savedPlace.count({ where: { userId } }).catch(() => 0),
    prisma.booking.count({ where: { userId, paymentStatus: 'PAID' } }).catch(() => 0),
    // A RIDER's emergency contacts live in the `EmergencyContact` relation, not
    // in a JSON column — `emergencyContact String?` is on the DRIVER model. This
    // read is the only correct source for a rider.
    prisma.emergencyContact.count({ where: { userId } }).catch(() => 0),
    prisma.emergencyContact
      .findFirst({ where: { userId }, select: { name: true }, orderBy: { createdAt: 'asc' } })
      .catch(() => null),
  ]);

  const hasEmergency = contactRows > 0;

  const items = [
    {
      id: 'phone',
      label: 'Phone number verified',
      description: 'You signed in with a one-time code sent to this number.',
      severity: 'required',
      done: !!user.phone,
      // Nothing to do: verifying the phone IS the sign-in.
      route: null,
      value: user.phone,
    },
    {
      id: 'name',
      label: 'Your name',
      description: 'Drivers see this when they come to collect you.',
      severity: 'required',
      done: !!user.name && user.name.trim().length > 1,
      route: '/profile/edit',
      value: user.name,
    },
    {
      id: 'email',
      label: 'Email address',
      description:
        'Where trip receipts are sent, and how you recover the account if you lose this number.',
      severity: 'recommended',
      done: !!user.email,
      route: '/profile/edit',
      value: user.email,
    },
    {
      id: 'photo',
      label: 'Profile photo',
      description: 'Helps your driver confirm they have the right passenger.',
      severity: 'recommended',
      done: !!user.profilePhoto,
      route: '/profile/edit',
      value: null,
    },
    {
      id: 'emergency_contact',
      label: 'Emergency contact',
      description: 'Who we notify if you raise an SOS during a trip.',
      severity: 'required',
      done: hasEmergency,
      route: '/profile/emergency-contacts',
      value: firstContact?.name ?? null,
    },
    {
      id: 'saved_places',
      label: 'Home and work saved',
      description: 'One tap to book your two most common trips.',
      severity: 'optional',
      done: savedPlaces > 0,
      route: '/profile/saved-places',
      value: savedPlaces ? `${savedPlaces} saved` : null,
    },
    {
      id: 'boarding_pin',
      label: 'Verify My Ride PIN',
      description: 'Your driver must enter a PIN before the trip starts. Optional, and off by default.',
      severity: 'optional',
      done: !!user.requireBoardingPin,
      route: '/profile/safety',
      value: user.requireBoardingPin ? 'on' : 'off',
    },
  ];

  // Completeness counts required + recommended only. Padding the number with
  // optional features would tell a rider they are incomplete for declining one.
  const counted = items.filter((i) => i.severity !== 'optional');
  const done = counted.filter((i) => i.done).length;

  return {
    completeness: Math.round((done / counted.length) * 100),
    outstandingRequired: items.filter((i) => i.severity === 'required' && !i.done).length,
    outstandingRecommended: items.filter((i) => i.severity === 'recommended' && !i.done).length,
    items,
    context: { paidTrips: paidBookings, memberSince: user.createdAt, authProvider: user.authProvider },
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
  // "Verify My Ride". Opt-in — see the field's note in schema.prisma.
  if (typeof data.requireBoardingPin === 'boolean') allowed.requireBoardingPin = data.requireBoardingPin;
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
    select: { walletBalancePesewas: true }
  });
  if (!user) throw new NotFoundError('User');

  const promos = await prisma.promotion.findMany({
    where: { active: true, expiry: { gt: new Date() } }
  });

  const referrals = await prisma.referral.findMany({
    where: { inviterId: userId },
    include: { invitee: { select: { name: true, createdAt: true } } }
  });

  return { walletBalancePesewas: user.walletBalancePesewas, promos, referrals };
}

/**
 * EVERYTHING THE PROMOTIONS SCREEN NEEDS, IN ONE CALL.
 *
 * BUGFIX ("on the promotions page it doesn't show if I'm on an active promo and
 * when it's going to end — everything is blank and it just lets you enter a
 * code").
 *
 * That screen was a text field and nothing else: no query, no list, no state.
 * The data existed — `Promotion` rows with an expiry and a redemption cap, and
 * `Booking.promotionId` recording every redemption — and nothing read it. So a
 * rider could not see what offers were live, what they had already used, or
 * whether the code they typed was actually attached to their next ride.
 *
 * Four buckets, because they answer four different questions:
 *
 *   applied   — "is a promo on my current ride, and what did it save me?"
 *   available — "what can I use, and when does it run out?"
 *   used      — "what have I already redeemed?" (so a used code stops looking
 *               like a missed opportunity)
 *   expired   — deliberately NOT returned. A dead offer is noise.
 */
async function getPromotions(userId) {
  const now = new Date();

  const [promos, myPromoBookings] = await Promise.all([
    prisma.promotion.findMany({
      where: { active: true, expiry: { gt: now } },
      orderBy: { expiry: 'asc' },
    }),
    // Every booking of this rider's that carries a promo — used to work out
    // both "already redeemed" and "applied to the ride I am on right now".
    prisma.booking.findMany({
      where: { userId, promotionId: { not: null } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        fareAmountPesewas: true,
        promotion: true,
        trip: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const LIVE_TRIP = ['REQUESTED', 'MATCHING', 'REASSIGNING', 'DRIVER_ASSIGNED', 'CONFIRMED',
    'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'SCHEDULED', 'FILLING'];
  const DEAD_BOOKING = ['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'];

  const activeRow = myPromoBookings.find(
    (b) => !DEAD_BOOKING.includes(b.status) && b.trip && LIVE_TRIP.includes(b.trip.status),
  );

  const usedPromotionIds = new Set(
    myPromoBookings.filter((b) => !DEAD_BOOKING.includes(b.status)).map((b) => b.promotion?.id),
  );

  const shape = (p) => ({
    id: p.id,
    code: p.code,
    discountPercent: p.discountPercent,
    maxDiscountPesewas: p.maxDiscountPesewas,
    expiry: p.expiry,
    // What is left, when the promo is capped. Null means uncapped — do not
    // render "unlimited" as a number.
    redemptionsLeft:
      p.maxRedemptions == null ? null : Math.max(0, p.maxRedemptions - (p.usageCount ?? 0)),
  });

  return {
    applied: activeRow
      ? {
          ...shape(activeRow.promotion),
          bookingId: activeRow.id,
          tripId: activeRow.trip.id,
          appliedAt: activeRow.createdAt,
        }
      : null,
    available: promos
      // A promo the rider has already redeemed, or one that has run out of
      // redemptions globally, cannot be used again — showing it as available is
      // how a rider ends up typing a code that gets rejected.
      .filter((p) => !usedPromotionIds.has(p.id))
      .filter((p) => p.maxRedemptions == null || (p.usageCount ?? 0) < p.maxRedemptions)
      .map(shape),
    used: myPromoBookings
      .filter((b) => b.promotion && !DEAD_BOOKING.includes(b.status))
      .slice(0, 10)
      .map((b) => ({
        ...shape(b.promotion),
        usedAt: b.createdAt,
        bookingId: b.id,
      })),
    serverNowMs: Date.now(),
  };
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

// App preferences (theme, etc) — mirrors the driver app's /driver/preferences.
// Previously the rider's dark/light toggle was AsyncStorage-only; a reinstall
// or new device silently reset it to the default instead of following the
// account like every other setting on this screen does.
const getPreferences = (userId) => getSettingsBlob(userId, 'preferences');
const updatePreferences = (userId, patch) => updateSettingsBlob(userId, 'preferences', patch);

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

// Client passes this straight to a native Ionicons `name` prop with no
// validation — an unrecognized glyph name is a hard native crash on the
// device (font glyph lookup failure), not a catchable JS error. Only ever
// persist a value this app's saved-places screen actually knows how to draw.
const VALID_PLACE_ICONS = new Set(['home-outline', 'briefcase-outline', 'location-outline']);

async function createSavedPlace(userId, { label, address, lat, lng, icon }) {
  const count = await prisma.savedPlace.count({ where: { userId } });
  if (count >= 20) throw new AppError('Maximum 20 saved places allowed', 400);
  return prisma.savedPlace.create({
    data: { userId, label: label.trim(), address: address.trim(), lat, lng, icon: VALID_PLACE_ICONS.has(icon) ? icon : null },
    select: { id: true, label: true, address: true, lat: true, lng: true, icon: true },
  });
}

async function deleteSavedPlace(userId, placeId) {
  const place = await prisma.savedPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) throw new NotFoundError('Saved place');
  await prisma.savedPlace.delete({ where: { id: placeId } });
}

module.exports = {
  getPreferences, updatePreferences, getMe, getAccountChecklist, updateMe, updateProfilePhoto, updateFcmToken, deactivateAccount, getWalletAndPromos, getPromotions, createSupportTicket, getSupportTickets, getSupportTicket, addTicketMessage, updateNotificationPreferences, getNotificationPreferences, getEmergencyContacts, syncEmergencyContacts, getSafetySettings, updateSafetySettings, updateInsuranceCard, getPrivacySettings, updatePrivacySettings, getSavedPlaces, createSavedPlace, deleteSavedPlace };
