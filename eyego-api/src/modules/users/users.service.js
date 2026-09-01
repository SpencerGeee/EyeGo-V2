'use strict';

const prisma = require('../../config/database');
const cloudinary = require('../../services/cloudinary.service');
const { NotFoundError, ForbiddenError, AppError } = require('../../utils/errors');
const { assertAssetUrl } = require('../../utils/asset-url');
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
      // Consent. The app compares these against `termsVersion` / `privacyVersion`
      // from /v1/config/public and prompts when either differs — a null being an
      // account created before consent was recorded, which prompts the same way.
      acceptedTermsVersion: true, acceptedPrivacyVersion: true,
      // Suppresses the consent prompt and the real dispatch path for the two
      // seeded store-review accounts. Never settable by a user.
      isReviewer: true,
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
  // A URL to an uploaded image, never the image itself — see utils/asset-url.
  if (data.profilePhoto) allowed.profilePhoto = assertAssetUrl(data.profilePhoto, 'profilePhoto');
  if (data.avatarUrl) allowed.profilePhoto = assertAssetUrl(data.avatarUrl, 'avatarUrl');
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

/**
 * DELETE MY ACCOUNT — and mean it.
 *
 * This was `{ isActive: false }` and nothing else, which fails on three counts
 * at once:
 *
 *   1. It is not a deletion. The rider's name, phone, email and profile photo
 *      stayed in the table indefinitely. App Store Guideline 5.1.1(v) requires
 *      an in-app deletion that actually removes the account, and reviewers do
 *      check; "we set a flag" is the classic rejection.
 *   2. The phone number stayed on a UNIQUE column, so the same person could
 *      never sign up again with their own number — deletion locked them out
 *      permanently instead of freeing them.
 *   3. `fcmToken` survived, so a deleted account kept receiving push
 *      notifications.
 *
 * What is deliberately NOT deleted: the rows. Bookings, receipts, payments and
 * ratings are financial and safety records that other people are party to, and
 * deleting them would corrupt a driver's earnings history and every trip
 * report. The identity is erased; the ledger keeps referring to an anonymous
 * id. That is the same shape `drivers.service.deleteMe` uses.
 *
 * Revoking the refresh tokens is what makes it take effect NOW rather than in
 * thirty days: without it a deleted account went on minting fresh access tokens
 * for the life of its refresh token, because the refresh path never re-read the
 * row it was issuing for.
 */
async function deactivateAccount(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        name: '[Deleted Account]',
        // Suffixed with the id so it stays unique while freeing the real
        // number for a fresh sign-up.
        phone: `deleted_${userId.slice(0, 12)}`,
        email: null,
        profilePhoto: null,
        fcmToken: null,
      },
    });

    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return updated;
  });
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

/**
 * Categories a rider's ticket may carry.
 *
 * Allow-listed rather than trusted: `SupportTicket.category` is a free-form
 * String column, so an unchecked value from the client would put rows in the
 * queue that no filter can find again — which is the same outcome as the bug
 * this replaces, reached by a different route.
 *
 * LOST_ITEM is the lost-and-found entry point. It carries the booking so an
 * agent can see the trip, and `driverId` so they can reach the driver through
 * the existing contact relay rather than handing out a phone number.
 */
const TICKET_CATEGORIES = ['GENERAL', 'PAYMENT', 'TRIP', 'ACCOUNT', 'TECHNICAL', 'LOST_ITEM'];

async function createSupportTicket(userId, subject, message, opts = {}) {
  const category = TICKET_CATEGORIES.includes(opts.category) ? opts.category : 'GENERAL';

  /**
   * Resolve the driver from the booking, when one is named.
   *
   * Scoped to `userId` on purpose: a booking id is guessable, and without this
   * a rider could open a ticket attached to somebody else's trip and learn
   * which driver drove it.
   */
  let driverId = null;
  let bookingLine = '';
  if (opts.relatedBookingId) {
    const booking = await prisma.booking.findFirst({
      where: { id: String(opts.relatedBookingId), userId },
      select: {
        id: true,
        trip: {
          select: {
            id: true,
            driverId: true,
            route: { select: { destinationName: true } },
          },
        },
      },
    });
    if (booking?.trip) {
      driverId = booking.trip.driverId ?? null;
      const where = booking.trip.route?.destinationName;
      bookingLine =
        `\n\nTrip: ${String(booking.trip.id).slice(0, 8).toUpperCase()}` +
        (where ? ` to ${where}` : '');
    }
  }

  return prisma.supportTicket.create({
    data: {
      userId,
      subject,
      category,
      driverId,
      // LOST_ITEM is time-sensitive in a way a general query is not — the item
      // is in a car that is still being driven, and every hour makes it harder
      // to find.
      priority: category === 'LOST_ITEM' ? 'HIGH' : 'MEDIUM',
      messages: {
        create: {
          senderId: userId,
          text: `${message}${bookingLine}`
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

/**
 * Stamp the current terms and privacy versions on the user.
 *
 * Idempotent: accepting twice writes the same values, which is exactly what a
 * client retrying after a dropped connection does. The versions arrive from the
 * controller, which reads them from settings rather than from the request — see
 * the note there for why a client-supplied version makes the record worthless.
 */
const acceptTerms = async (userId, { termsVersion, privacyVersion }) => {
  const now = new Date();
  return prisma.user.update({
    where: { id: userId },
    data: {
      acceptedTermsVersion: termsVersion || null,
      acceptedTermsAt: termsVersion ? now : null,
      acceptedPrivacyVersion: privacyVersion || null,
      acceptedPrivacyAt: privacyVersion ? now : null,
    },
    select: {
      acceptedTermsVersion: true,
      acceptedTermsAt: true,
      acceptedPrivacyVersion: true,
      acceptedPrivacyAt: true,
    },
  });
};

/**
 * ── SAVED PLACES ────────────────────────────────────────────────────────────
 *
 * "You need to also implement the system where users can add multiple saved
 *  places and they can even name a spot like (Cyril's house), so it's very
 *  convenient."
 *
 * They could add several, and they could name them — and the two features
 * quietly cancelled each other out. Home and Work were INFERRED from the label
 * (`label.toLowerCase().includes('home')`), and `createSavedPlace` treats a slot
 * claim as an UPDATE rather than an insert. So naming a place the way a person
 * actually would — "Mum's home", "home of the gym" — did not create a place at
 * all: it silently overwrote the rider's home address with somebody else's.
 * The screen then showed the new address exactly where it was expected to be,
 * which is why this was invisible until the Where To shortcut sent someone to
 * the wrong side of the city.
 *
 * `SavedPlace.slot` makes it a choice instead of a guess. 'HOME' | 'WORK' |
 * null; the database holds one of each per rider (`@@unique([userId, slot])`,
 * and Postgres does not constrain NULLs, so free-form places are unlimited).
 * A label is now just a name.
 */

/** The columns every saved-place response carries. */
const PLACE_SELECT = {
  id: true, label: true, address: true, lat: true, lng: true,
  icon: true, slot: true, sortOrder: true,
};

/**
 * Icons the rider's saved-places screen knows how to draw.
 *
 * NOT cosmetic validation. The client passes this straight to a native
 * Ionicons `name` prop with no checking of its own, and an unrecognised glyph
 * name is a hard native crash on the device (font glyph lookup failure), not a
 * catchable JS error. Only ever persist a value the screen can render.
 *
 * Widened well past the original three because a list of freely-named places is
 * unusable without them: five rows that all wear the same grey pin are five
 * rows a rider has to read rather than recognise.
 */
const VALID_PLACE_ICONS = new Set([
  'home-outline', 'briefcase-outline', 'location-outline',
  'heart-outline', 'barbell-outline', 'school-outline', 'cart-outline',
  'restaurant-outline', 'medkit-outline', 'airplane-outline', 'business-outline',
  'people-outline', 'football-outline', 'library-outline', 'bed-outline',
  'cafe-outline', 'car-outline', 'star-outline',
]);

const VALID_SLOTS = new Set(['HOME', 'WORK']);
const normalizeSlot = (slot) => (VALID_SLOTS.has(slot) ? slot : null);

/**
 * The OLD label inference, kept for one purpose only: reading rows written
 * before `slot` existed on a deployment where the migration's backfill has not
 * run yet. Never used to WRITE a slot.
 *
 * Mirrors `apps/rider/utils/savedPlaceSlots.ts`, which keeps the same helpers
 * for the same reason.
 */
const claimsHomeSlot = (label) => String(label ?? '').trim().toLowerCase().includes('home');
const claimsWorkSlot = (label) => {
  const l = String(label ?? '').trim().toLowerCase();
  return l.includes('work') || l.includes('office');
};

/** A place's slot: the column when it has one, the legacy inference otherwise. */
function effectiveSlot(place) {
  if (place.slot) return place.slot;
  if (claimsHomeSlot(place.label)) return 'HOME';
  if (claimsWorkSlot(place.label)) return 'WORK';
  return null;
}

async function getSavedPlaces(userId) {
  const rows = await prisma.savedPlace.findMany({
    where: { userId },
    // Slots first, then the rider's own order, then oldest — so Home and Work
    // stay pinned to the top of the list however many places sit under them.
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: PLACE_SELECT,
  });
  /**
   * The legacy slot is projected onto the response rather than written back.
   *
   * A backfill is the migration's job and it runs once; this is what keeps the
   * apps correct on an instance where the code is newer than the database, and
   * it costs nothing.
   */
  return rows
    .map((p) => ({ ...p, slot: effectiveSlot(p) }))
    .sort((a, b) => {
      const rank = (s) => (s === 'HOME' ? 0 : s === 'WORK' ? 1 : 2);
      return rank(a.slot) - rank(b.slot) || a.sortOrder - b.sortOrder;
    });
}

/** How many freely-named places one rider may keep, on top of the two slots. */
const MAX_CUSTOM_PLACES = 40;

async function createSavedPlace(userId, { label, address, lat, lng, icon, slot }) {
  const data = {
    label: String(label).trim(),
    address: String(address).trim(),
    lat,
    lng,
    icon: VALID_PLACE_ICONS.has(icon) ? icon : null,
    slot: normalizeSlot(slot),
  };

  /**
   * A SLOT IS SINGULAR, SO SAVING ONE REPLACES IT.
   *
   * That behaviour is right and is why the bug was subtle — it is only wrong
   * when the slot was GUESSED. Now that the rider says which slot they mean,
   * "save this as my Home" replacing their old home is exactly what they asked
   * for, and nothing else can trigger it.
   *
   * Duplicates from before the unique index are cleared on the way past: rows
   * written under the old rule can have two Homes, and leaving them would keep
   * the shortcut resolving to whichever is oldest.
   */
  /**
   * A ROW LABELLED "HOME" CLAIMS THE HOME SLOT, EVEN WITHOUT SAYING SO.
   *
   * BUGFIX (caught by the settings suite: "2 rows labelled Home"). The replace
   * branch below only ran when the CALLER passed an explicit slot, so saving a
   * free-form place called "Home" a second time created a second row — and
   * `getSavedPlaces` then projected `slot: 'HOME'` onto BOTH of them, because
   * `effectiveSlot` infers a slot from the label for rows written before the
   * column existed. Two rows claiming one singular slot, and the Home shortcut
   * on the where-to screen resolving to whichever happened to sort first.
   *
   * The inference is already trusted on the way OUT; trusting it on the way IN
   * is what keeps the two ends agreeing. An explicit slot still wins, so a rider
   * who deliberately names a custom place "Home office" is unaffected —
   * `claimsHomeSlot` is the same predicate the read path uses.
   */
  const effectiveIncomingSlot =
    data.slot ?? (claimsHomeSlot(data.label) ? 'HOME' : claimsWorkSlot(data.label) ? 'WORK' : null);

  if (effectiveIncomingSlot) {
    const claims = effectiveIncomingSlot === 'HOME' ? claimsHomeSlot : claimsWorkSlot;
    const existing = (
      await prisma.savedPlace.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, label: true, slot: true },
      })
    ).filter((p) => (p.slot ? p.slot === effectiveIncomingSlot : !p.slot && claims(p.label)));

    if (existing.length) {
      const [keep, ...duplicates] = existing;
      if (duplicates.length) {
        await prisma.savedPlace.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } });
      }
      return prisma.savedPlace.update({ where: { id: keep.id }, data, select: PLACE_SELECT });
    }
  }

  const count = await prisma.savedPlace.count({ where: { userId, slot: null } });
  if (count >= MAX_CUSTOM_PLACES) {
    throw new AppError(`You can save up to ${MAX_CUSTOM_PLACES} places. Remove one to add another.`, 400);
  }
  // New free-form places go to the end of the list rather than the middle.
  const last = await prisma.savedPlace.findFirst({
    where: { userId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return prisma.savedPlace.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? 0) + 1 },
    select: PLACE_SELECT,
  });
}

/**
 * RENAME, RE-PIN, RE-ICON — without deleting and re-adding.
 *
 * A list of named places is only convenient if the names can be corrected. The
 * screen's only editing verb was Delete, so fixing a typo in "Cyril's house"
 * meant losing the pin and picking it again on a map.
 *
 * Every field is optional and only what is supplied is written, so a rename
 * cannot silently move a pin.
 */
async function updateSavedPlace(userId, placeId, patch = {}) {
  const place = await prisma.savedPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) throw new NotFoundError('Saved place');

  const data = {};
  if (typeof patch.label === 'string' && patch.label.trim()) data.label = patch.label.trim();
  if (typeof patch.address === 'string' && patch.address.trim()) data.address = patch.address.trim();
  if (Number.isFinite(patch.lat) && Number.isFinite(patch.lng)) {
    data.lat = patch.lat;
    data.lng = patch.lng;
  }
  if (typeof patch.icon === 'string') data.icon = VALID_PLACE_ICONS.has(patch.icon) ? patch.icon : null;
  if (patch.slot !== undefined) {
    const next = normalizeSlot(patch.slot);
    // Moving a place INTO an occupied slot has to empty the other one, or the
    // unique index rejects the write with a 500 the rider cannot act on.
    if (next) {
      await prisma.savedPlace.updateMany({
        where: { userId, slot: next, NOT: { id: placeId } },
        data: { slot: null },
      });
    }
    data.slot = next;
  }
  if (Number.isFinite(patch.sortOrder)) data.sortOrder = Math.trunc(patch.sortOrder);

  if (Object.keys(data).length === 0) {
    return prisma.savedPlace.findUnique({ where: { id: placeId }, select: PLACE_SELECT });
  }
  return prisma.savedPlace.update({ where: { id: placeId }, data, select: PLACE_SELECT });
}

async function deleteSavedPlace(userId, placeId) {
  const place = await prisma.savedPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) throw new NotFoundError('Saved place');
  await prisma.savedPlace.delete({ where: { id: placeId } });
}

module.exports = {
  TICKET_CATEGORIES,
  getPreferences, updatePreferences, getMe, getAccountChecklist, updateMe, updateProfilePhoto, updateFcmToken, deactivateAccount, getWalletAndPromos, getPromotions, createSupportTicket, getSupportTickets, getSupportTicket, addTicketMessage, updateNotificationPreferences, getNotificationPreferences, getEmergencyContacts, syncEmergencyContacts, getSafetySettings, updateSafetySettings, updateInsuranceCard, getPrivacySettings, updatePrivacySettings, acceptTerms, getSavedPlaces, createSavedPlace, updateSavedPlace, deleteSavedPlace };
