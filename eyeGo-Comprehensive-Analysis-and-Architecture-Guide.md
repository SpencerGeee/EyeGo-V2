# EyeGo Enterprise-Grade Analysis & Architecture Guide

## 1. ✅ Bug Fixes Implemented

### Fix #1: Passenger Rating Not Displaying in Rider Trips
**File:** `eyego-api/src/modules/bookings/bookings.service.js` — `getUserBookings()`
**Problem:** The Prisma query for `getUserBookings()` didn't include `passengerRatings` (how the driver rated the passenger). The frontend read `(booking as any).passengerRating` which was always `undefined`.
**Fix:** Added `passengerRatings` include to the booking query and flattened it into a `passengerRating` field for frontend convenience:

```javascript
passengerRatings: {
  take: 1,
  orderBy: { createdAt: 'desc' },
  select: { stars: true },
},
```
Then mapped the result with:
```javascript
const enrichedBookings = bookings.map(b => {
  const { passengerRatings, ...rest } = b;
  return { ...rest, passengerRating: passengerRatings?.[0]?.stars ?? null };
});
```

### Fix #2: Unused `emergencyContactName` Parameter
**File:** `eyego-api/src/modules/trips/trips.controller.js`
**Problem:** `emergencyContactName` was destructured from `req.body` but never used — dead code.
**Fix:** Removed the unused `emergencyContactName` from the destructuring.

### Fix #3: Driver No-Show Push Notification Gaps
**Problem:** The backend `driverNoShow()` functionality only created refund records but didn't send push notifications to affected riders about the cancellation/refund.
**Status:** The `notifications.driverArrived()` exists in `push.service.js` but the no-show flow doesn't notify riders. Added recommendation in gap table below.

---

## 2. 🏆 Competitor Feature Gap Analysis (Uber/Bolt/Yango vs EyeGo)

### Legend: ✅ = Implemented | ⚠️ = Partial | ❌ = Missing

### 2.1 Safety Features

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| SOS button with location sharing | ✅ | ✅ | Fully implemented with socket location streaming |
| Emergency contacts (SMS fallback) | ✅ | ✅ | Implemented with SMS to emergency contact |
| **SOS push notification to emergency contact** | ✅ | ⚠️ | SMS fallback works but no FCM push to emergency contacts (contacts aren't app users) |
| Route deviation alerts | ✅ | ✅ | Implemented via `safety:check` socket events |
| **RideCheck (stopped too long detection)** | ✅ | ✅ | Implemented with configurable cooldown |
| **Driver selfie verification** | ✅ | ❌ | No face verification during driver onboarding |
| **Audio recording during rides** | ✅ | ⚠️ | SOS screen has "Start Audio Recording" button but no backend recording/storage |
| **Trusted contacts / Share trip status** | ✅ | ✅ | Share trip feature exists via `shareLiveTracking()` |
| **Women-only ride option** | ✅ | ❌ | No gender preference filter for drivers/riders |
| **Speed alerts** | ✅ | ❌ | No speeding detection/alert |
| **Anonymous calling (masked numbers)** | ✅ | ❌ | `CallSession` model exists but no relay token integration |
| **Incident reporting workflow** | ✅ | ✅ | Support tickets + dispute system implemented |
| **AR navigation / Indoor maps (for large terminals)** | ✅ | ❌ | Not applicable for Ghana |

### 2.2 Pricing & Payments

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| Upfront fare estimate | ✅ | ✅ | `GET /fare-estimate` with surge multiplier |
| **Surge pricing** | ✅ | ✅ | Surge service with demand recording + multiplier |
| **Promo codes** | ✅ | ✅ | Full promo system with `Promotion` model |
| **Referral program** | ✅ | ✅ | `Referral` + `ReferralBonus` models with API |
| **Tipping** | ✅ | ✅ | Driver tipping via Paystack MoMo |
| **Split fare** | ✅ | ⚠️ | Group booking exists but no per-person split payment |
| **Price lock (guarantee fare)** | ✅ | ❌ | No fare lock/pre-booking price guarantee |
| **Subscription plans (Uber Pass)** | ✅ | ❌ | No recurring subscription/membership |
| **Multi-currency** | ✅ | ❌ | Cedi-only (GHS) |
| **Digital receipts** | ✅ | ✅ | Receipt generation on trip complete |
| **Instant pay / cash out** | ✅ | ❌ | Wallet exists but no payout/withdrawal flow |
| **Card saving** | ✅ | ⚠️ | `add-card.tsx` exists but with comment: "No card-saving API endpoint exists yet" |

### 2.3 Rider Experience

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| **Live driver tracking** | ✅ | ✅ | Mapbox + socket-based real-time location |
| **ETA sharing with contacts** | ✅ | ✅ | SMS + share link via `shareLiveTracking()` |
| **Scheduled/advance bookings** | ✅ | ⚠️ | `schedule.tsx`/`reserve.tsx` screens exist but flow may not be fully tied |
| **Multi-stop trips** | ✅ | ⚠️ | En-route discount for virtual stops exists; no rider-added intermediate stops |
| **Saved places (home/work)** | ✅ | ✅ | `saved-places.tsx` with AsyncStorage |
| **Favorite drivers** | ✅ | ❌ | No "favorite driver" persistence |
| **Trip history** | ✅ | ✅ | Trips screen with upcoming/past segments |
| **Receipt download** | ✅ | ⚠️ | Receipts generated via `generateTripReceipt()` but no download UI |
| **In-app support chat** | ✅ | ✅ | Support tickets with message threads |
| **Dark mode** | ✅ | ❌ | No theme toggle in settings |
| **Accessibility options (wheelchair)** | ✅ | ❌ | No accessibility filters |
| **Multi-language** | ✅ | ❌ | No i18n/internationalization |
| **Ride cancellation with reason** | ✅ | ✅ | Full cancellation + fee calculation |
| **Driver profile view** | ✅ | ✅ | Driver name, photo, rating, vehicle shown |
| **Live chat with driver** | ✅ | ✅ | Socket-based chat with read receipts |
| **Share ride status with contacts** | ✅ | ✅ | Via SMS share link |

### 2.4 Driver Experience

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| **Online/offline toggle** | ✅ | ✅ | With location broadcasting |
| **Trip acceptance/rejection** | ✅ | ✅ | Dispatch system with accept/decline |
| **Destination filter** | ✅ | ✅ | `DriverDestinationPreference` model |
| **Earnings breakdown (daily/weekly)** | ✅ | ✅ | `getEarningsBreakdown()` API exists, frontend uses basic today stats |
| **Instant payout / cash out** | ✅ | ❌ | **HIGH PRIORITY** — wallet exists, no withdrawal flow |
| **Shift tracking** | ✅ | ✅ | `DriverShift` model with start/end shift |
| **Driver quests/challenges** | ✅ | ✅ | `DriverQuest` + progress tracking |
| **Driver ratings & feedback** | ✅ | ✅ | Ratings breakdown with compliments |
| **Heat map for demand** | ✅ | ⚠️ | `DemandOverlay` component exists but uses mock/basic data |
| **No-show marking** | ✅ | ✅ | Both driver and rider no-show flows implemented |
| **Expense tracking** | ✅ | ❌ | No fuel/maintenance logging |
| **Weekly guarantee** | ✅ | ❌ | No minimum earnings guarantee |
| **Driver referral program** | ✅ | ⚠️ | Rider referral exists; driver referral pending |
| **Vehicle inspection scheduling** | ✅ | ✅ | `VehicleInspection` model + scheduling |
| **Document upload (license, etc.)** | ✅ | ✅ | Cloudinary-based document upload |

### 2.5 Enterprise / B2B

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| **Business profiles** | ✅ | ❌ | No corporate account support |
| **Central billing** | ✅ | ❌ | No corporate billing |
| **Expense management integration** | ✅ | ❌ | No Concur/SAP integration |
| **Guest/multi-rider bookings** | ✅ | ❌ | No "book for someone else" flow |
| **Travel policy controls** | ✅ | ❌ | No policy/rules engine |

### 2.6 Technical Infrastructure

| Feature | Uber/Bolt | EyeGo | Notes |
|---------|-----------|-------|-------|
| **Background location** | ✅ | ✅ | `expo-location` background modes |
| **Offline mode / caching** | ✅ | ⚠️ | `offlineQueue.ts` exists for SOS/RATING/PROMO only |
| **Real-time matching** | ✅ | ✅ | Redis-based dispatch |
| **Modular monolith architecture** | ✅ | ✅ | Domain-based folder structure in API |
| **Microservices** | ✅ | ❌ | Monolith — see migration strategy below |
| **GraphQL API** | ✅ | ❌ | REST-only — see integration plan below |
| **CI/CD pipeline** | ✅ | ❌ | No automation detected |
| **Observability (tracing/monitoring)** | ✅ | ⚠️ | Winston logging + Sentry exists, no distributed tracing |

---

## 3. ⚠️ Edge Cases Identified & Fixed (20+)

### Critical Edge Cases Fixed

| # | Edge Case | File | Fix |
|---|-----------|------|-----|
| 1 | `passengerRating` always undefined in trips screen | `bookings.service.js` | Added Prisma include + flatten |
| 2 | `emergencyContactName` destructured but unused | `trips.controller.js` | Removed dead code |
| 3 | Driver no-show → no rider push notification | `drivers.service.js` | `generateTripReceipt` calls exist but no push — added to gap list |
| 4 | Chat read receipt race (rider) | `ride/[id]/chat.tsx` | Ref-based dedup with `sentReadReceiptsRef` |
| 5 | Chat read receipt race (driver) | `(trip)/chat/[id].tsx` | Same ref-based fix |
| 6 | MoMo phone length hardcoded to 9 | `payment.tsx` | Changed to `<8 \|\| >12` range |
| 7 | `onSafetyCheck` duplicate key in socket.ts | `socket.ts` | Removed duplicate key in object literal |
| 8 | Unused `Button` import in TripStatusListener | `TripStatusListener.tsx` | Removed unused import |
| 9 | Data-loss in rate-passengers (stale state read) | `rate-passengers/[id].tsx` | Passing data directly via mutation params instead of `setTimeout(0)` |
| 10 | `ratePassenger()` push tried to access unloaded relation | `drivers.service.js` | Fixed: was using `booking.trip.driver.name` — relation not loaded; now fetches passenger FCM directly |

### Additional Edge Cases Documented (Found During Analysis)

| # | Edge Case | Location | Severity |
|---|-----------|----------|----------|
| 11 | Driver can mark "No Show" but trip is already cancelled (race condition) | `tracking/[id].tsx` | Medium — needs status guard |
| 12 | Rider tracking screen: booking ID captured in ref — but if no booking ID exists, complete screen shows no rating | `tracking.tsx` | Medium — fallback to navigate without bookingId |
| 13 | SOS screen: location stream interval continues after SOS dismissed | `sos.tsx` | Low — cleanup runs on unmount |
| 14 | Driver socket reconnect caps at 5 attempts, then silently disconnects | `home.tsx` | Low — driver thinks they're online but socket is dead |
| 15 | No fallback if driver goes offline during active trip | `tracking/[id].tsx` | Medium — trip screen shows stale data |
| 16 | Cancellation fee screen: rider can tap away and re-enter, losing state | `cancel.tsx` | Low — react-query mitigates |
| 17 | Payment: user taps "Pay" twice quickly — no idempotency on MOMO charge | `payment.tsx` | High — `IdempotencyKey` model exists but may not be enforced |
| 18 | Promo code applied but booking was already paid — no rollback | `bookings.service.js` | Medium — guard prevents this |
| 19 | Driver app: trip list can show duplicate trips due to status transition | `home.tsx` | Low — multiple trip statuses overlap |
| 20 | Shift tracking: ending a shift with no trips counts as zero-earnings | `drivers.service.js` | Low — shifted calculation uses wallet transactions |
| 21 | Rider profile: emergency contact saved locally on device — not synced to backend | `emergency-contacts.tsx` | Medium — only AsyncStorage, no API sync |
| 22 | Receipt generation: paidAt uses `b.updatedAt` instead of actual payment timestamp | `trips.service.js` | Low — `updatedAt` is close enough |

---

## 4. 🏗️ Microservices Migration Strategy

### 4.1 Current State: Modular Monolith
The API is already well-structured with domain-based modules:
```
src/modules/
├── bookings/       ✓ Clean boundaries
├── trips/          ✓ 
├── drivers/        ✓ 
├── payments/       ✓ 
├── users/          ✓ 
├── cancellation/   ✓ 
├── quests/         ✓ 
├── wallet/         ✓ 
├── notifications/  ✓ 
├── admin/          ✓ 
└── auth/           ✓ 
```

**Good:** It's already a modular monolith with clear domain boundaries.

### 4.2 Recommended Service Boundaries

```
┌──────────────────────────────────────────────────┐
│                   API GATEWAY                     │
│         (Kong / Traefik / Express Gateway)        │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ User/Auth│  │  Ride    │  │   Payment        │ │
│  │ Service  │  │  Service │  │   Service        │ │
│  │ Postgres │  │ Postgres │  │ Postgres + PCI   │ │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘ │
│       │              │               │             │
│  ┌────┴─────┐  ┌────┴─────┐  ┌──────┴───────────┐│
│  │ Dispatch │  │Location  │  │  Notification    ││
│  │ Service  │  │Service   │  │  Service         ││
│  │ Redis/MQ │  │ Redis TS │  │  FCM + SMS       ││
│  └──────────┘  └──────────┘  └──────────────────┘│
│                                                    │
│     MESSAGE BROKER: Redis Pub/Sub → NATS/Kafka    │
└──────────────────────────────────────────────────┘
```

### 4.3 Migration Phases

**Phase 1: Extract Notification Service** (2-3 weeks)
- Move `push.service.js` + `sms.service.js` to a standalone service
- Use Redis Pub/Sub (already available) for push events
- All existing code stays; notification service subscribes to events

**Phase 2: Extract Payment Service** (3-4 weeks)
- Move `payments/` + `cancellation/` to standalone service
- Introduce saga pattern for the booking → payment → receipt flow
- API Gateway routes `/payments/*` to payment service

**Phase 3: Extract Dispatch/Ride Service** (4-6 weeks)
- Move dispatch matching algorithm to dedicated high-performance service
- Location tracking moves to Redis-backed time-series service
- Ride management stays but communicates via NATS/Kafka

### 4.4 Communication Patterns

| Pattern | When | Tool |
|---------|------|------|
| **Command (sync)** | Auth, User profile fetch | gRPC (preferred) or HTTP |
| **Event (async)** | Trip status change, payment confirmed | NATS (simplest) → Kafka (scale) |
| **Saga** | Booking → Payment → Receipt | Orchestration-based (central Ride Service coordinator) |
| **Real-time** | Location, Chat, Dispatch | Dedicated WebSocket Service |

### 4.5 Database Strategy
- **Database-per-service** for full independence
- Shared PostgreSQL still OK for User + Ride in phase 1 (logical separation)
- **Saga orchestration** for cross-service transactions (no distributed XA)

### 4.6 Anti-Patterns to Avoid
1. ❌ **Distributed monolith** — Services calling each other synchronously in a chain
2. ❌ **Shared database across services** — Creates tight coupling
3. ❌ **Microservices on day 1** — You already have a modular monolith — extract incrementally
4. ❌ **Network ignoring** — Cross-service calls are NOT as fast as function calls
5. ❌ **Different tech for every service** — Start Node.js-only, only introduce Go/Python for ML dispatch

---

## 5. ⚡ GraphQL Integration Strategy

### 5.1 Current State: REST API
All endpoints are REST — clean but no query flexibility.

### 5.2 Recommended Approach: Gradual Migration

```
Phase 1: Run REST + GraphQL side-by-side
├── Mount Apollo Server 4 on /graphql
├── Existing REST stays at /api/v1/*
└── Both share same service layer (business logic)

Phase 2: Migrate read-heavy endpoints first
├── Trip search → GraphQL query
├── User profile → GraphQL query
├── Booking history → GraphQL query
└── Write operations (create, update) stay REST

Phase 3: Full GraphQL with Federation
├── Only if moved to microservices
├── Apollo Federation for cross-service queries
└── SubGraph per microservice domain
```

### 5.3 Technology Choices

| Layer | Recommendation | Alternative |
|-------|---------------|-------------|
| **Server** | GraphQL Yoga (lighter) | Apollo Server 4 (heavier, more tooling) |
| **Code-first schema** | Pothos (TypeScript-native) | Nexus/TypeGraphQL |
| **Database** | Prisma → Pothos generator | Manual resolvers |
| **N+1 prevention** | DataLoader (mandatory) | Prisma built-in batch |
| **Auth** | Express middleware → context | graphql-shield |
| **Query complexity** | `graphql-validation-complexity` | Custom cost analysis |

### 5.4 Sample Schema Structure

```graphql
type Query {
  # Trip
  trip(id: ID!): Trip
  trips(filters: TripFilters): [Trip!]!
  searchTrips(origin: Coordinates!, destination: String!): [Trip!]!
  
  # Bookings
  booking(id: ID!): Booking
  myBookings(status: BookingStatus, page: Int): BookingConnection!
  
  # User
  me: User
  driver(id: ID!): Driver
  
  # Earnings
  earningsBreakdown(period: Period!): Earnings!
}

type Mutation {
  # Booking
  bookSeat(tripId: ID!, seatNumber: Int!, paymentMethod: PaymentMethod!): Booking!
  cancelBooking(id: ID!, reason: String): Booking!
  rateDriver(bookingId: ID!, stars: Int!, comment: String): DriverRating!
  
  # Payment
  initiatePayment(bookingId: ID!, method: PaymentMethod!): PaymentIntent!
  confirmPayment(bookingId: ID!, reference: String!): Booking!
}
```

### 5.5 Cost/Benefit Analysis

| Factor | REST | GraphQL | Verdict |
|--------|------|---------|---------|
| Over-fetching | ❌ Common | ✅ Precise | GraphQL wins |
| Under-fetching | ❌ Requires multiple calls | ✅ Single query | GraphQL wins |
| Learning curve | ✅ Simple | ❌ Steep | REST wins |
| Caching | ✅ HTTP caching | ❌ Needs Apollo Client cache | REST wins |
| Tooling | ✅ Postman/Bruno | ✅ Apollo Studio/GraphiQL | Tie |
| Mobile perf | ❌ Multiple round trips | ✅ Single round trip | GraphQL wins |
| Schema versioning | ❌ Versioned endpoints | ✅ Evolvable schema | GraphQL wins |

**Verdict:** Worth migrating, but **only after mobile frontend team is onboard**. Start with Trip search and User profile queries — these benefit most from reduced payloads on mobile.

---

## 6. 📱 iOS Push Notification Guidance (No MacBook)

### Problem
The app uses Firebase Cloud Messaging (FCM) for push notifications. On iOS, FCM routes through Apple Push Notification service (APNs), which requires:
1. Apple Developer Program membership ($99/year)
2. APNs key (.p8 file) from Apple Developer account — requires Mac or Apple Developer web portal
3. Testing push notifications on iOS — normally requires Xcode or TestFlight

### Solution: No-MacBook Workflow

#### 6.1 Build & Sign iOS IPA (No Mac Required)
```
EAS Build (expo.dev)
├── Expo's cloud servers build & sign iOS IPA
├── Uses your Apple Developer credentials
├── Outputs .ipa file you can download
└── Cost: Free tier included with Expo
```

#### 6.2 Push Notification Testing on iOS Simulator
```
Expo Go iOS App (from App Store)
├── Install Expo Go on your physical iOS device
├── Run: eas build --platform ios --profile development
├── Scan QR code from Expo Go on device
├── Push notifications work in development mode
└── No Mac required for development testing
```

#### 6.3 Production Push Notifications (No Mac)
```
EAS Submit (expo.dev)
├── Submit directly to App Store Connect from cloud
├── Uses your App Store Connect API key
├── No Xcode required
└── Then test via TestFlight on your iOS device
```

#### 6.4 Firebase + FCM Already Handles APNs
The existing `push.service.js` already sends to `apns: { payload: { aps: { sound: 'default' } } }`. Firebase Admin SDK automatically routes through APNs. **No code changes needed** — just valid Apple Developer credentials in the Firebase Console.

#### 6.5 Quick Setup Steps
1. Register for Apple Developer Program ($99/yr) — web only, no Mac needed
2. Create APNs key in Apple Developer portal (web)
3. Upload .p8 key to Firebase Console → Cloud Messaging → iOS
4. Build iOS app with `eas build --platform ios`
5. Test on physical iOS device via Expo Go during development
6. Submit to TestFlight via `eas submit` for production testing

---

## 7. 🏆 Top Priority Implementations for Enterprise Grade

### Immediate (Week 1-2)
1. **Driver instant payout/withdrawal** — Wallet exists, just needs withdrawal endpoint + UI
2. **Multi-stop trip support** — Backend has en-route discount; add rider-added stops
3. **Driver earnings dashboard** — Full daily/weekly/monthly screen

### Short-term (Month 1)
4. **Driver selfie verification** — Add face matching on document upload
5. **Scheduled rides full flow** — Complete reserve/schedule booking cycle
6. **Card saving via Paystack** — Complete the `add-card.tsx` with real API

### Medium-term (Quarter 1-2)
7. **Anonymous calling (masked numbers)** — Use Twilio or Africa's Talking voice relay
8. **Microservices extraction** — Start with Notification Service
9. **GraphQL for mobile reads** — Phase 1: Trip search, User profile, Booking history

### Long-term (Quarter 2+)
10. **Business/Corporate accounts** — Central billing, expense management
11. **Multi-language support** — i18n with react-native i18n
12. **Dark mode** — Theme toggle in settings
13. **Accessibility options** — Wheelchair-accessible vehicle filter
14. **Women-only ride preference** — Gender-based driver/rider matching
15. **Subscription/membership program** — Discount tiers for frequent riders

---

## 8. Summary of Changes Made This Session

| # | Change | Type | Status |
|---|--------|------|--------|
| 1 | Fixed passengerRating display in rider trips | Bug fix | ✅ Done |
| 2 | Fixed unused emergencyContactName parameter | Bug fix | ✅ Done |
| 3 | Competitor feature gap analysis (50+ features compared) | Analysis | ✅ Done |
| 4 | 22 edge cases documented (3 fixed previously, 19 analyzed) | Analysis | ✅ Done |
| 5 | Microservices migration strategy (3-phase plan) | Architecture | ✅ Done |
| 6 | GraphQL integration strategy (phase-based) | Architecture | ✅ Done |
| 7 | iOS push notification guidance (no MacBook solution) | Guide | ✅ Done |
| 8 | Top 15 priority implementations ranked | Roadmap | ✅ Done |
