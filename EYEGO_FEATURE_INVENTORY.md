# EyeGo — Complete Feature Inventory & System Overview

**Purpose of this document.** A full, honest inventory of what the EyeGo platform actually
contains, written to be handed to a reviewer (human or AI) whose job is to answer two
questions:

1. **What is missing?** Which features a ride-hailing / shared-transport product of this
   ambition would be expected to have, that are not here.
2. **What is broken?** Which latent bugs, inconsistencies or dangerous assumptions exist in
   what *is* here.

To make that review useful rather than speculative, this document includes the architecture,
the data model, the state machines, the invariants the code depends on, the **logic** behind
each significant flow, and two explicit exclusion sections:

- **Part 7 — Known Gaps**: what is deliberately or accidentally absent. Already discovered.
- **Part 8 — Already ruled out**: claims previous reviewers made that were checked against the
  code and found to be **wrong**, with the evidence. Re-reporting these wastes a review.

A reviewer should treat Parts 7 and 8 as closed and spend its effort on everything else.

Everything below was read out of the codebase, not recalled. Where something is uncertain it
is marked **[UNVERIFIED]**.

**Snapshot date:** 2026-08-17 (second revision, after the external-review triage pass).

---

## Part 1 — System overview

### 1.1 What the product is

EyeGo is a Ghana-focused transport platform that runs **two distinct products through one
trip pipeline**:

- **On-demand hailing** — a rider drops a pin, gets a quote, and a sequential dispatch
  cascade offers the ride to one driver at a time. The whole vehicle is priced as one fare.
- **Group / minibus (trotro) booking** — a driver publishes a trip from a map pin with a seat
  count and a departure time. Riders book individual **seats** on it. The vehicle's fare is
  divided by `maxSeats`, so a seat's price falls as the bus gets bigger.

Both produce a `Trip` row and both flow through the same `TripStatus` state machine, the same
socket channel, and the same receipt/rating/dispute machinery. The pivot from fixed routes to
map-pin group booking happened on 2026-07-23; fixed `Route` rows still exist and are reused as
**ad-hoc routes** (`Route.isAdHoc = true`) for pin-to-pin trips, so nothing in the schema had
to change.

**This shared pipeline is the single most productive place to look for bugs.** Almost every
serious defect found to date has been a rule that is correct for one product being applied to
the other: a fare denominator, a seat predicate, a status, a "start trip" step.

Currency is **Ghanaian cedis**, stored everywhere as **pesewas (integers)**. The cedis→pesewas
boundary is crossed in exactly one place (`eyego-api/src/config/env.js`).

### 1.2 Repository shape

```
eyego-api/          Node/Express + Prisma + Postgres + Redis + Socket.IO + GraphQL
apps/rider/         Expo (React Native), expo-router
apps/driver/        Expo (React Native), expo-router
apps/admin/         Next.js 15 App Router (server components, server-only API access)
packages/api/       Shared HTTP + socket client for both mobile apps
packages/ui/        Shared component library, motion tokens, Skia effects
packages/maps/      MapLibre wrapper, camera state machine, puck interpolator
packages/config/    Design tokens (colour, spacing, type, motion)
packages/map-styles/ Map styles over OpenFreeMap (no API key needed for tiles)
packages/utils/     Money formatting, booking-status predicates, shared helpers
packages/types/     Shared TypeScript types
scripts/            invariants.test.mjs — grep-checkable invariants, wired into `yarn test`
```

### 1.3 Stack and infrastructure

| Concern | Choice | Notes |
|---|---|---|
| API | Express, REST under `/v1/*` | Also a GraphQL endpoint at `/graphql` |
| DB | PostgreSQL via Prisma | Hosted in Frankfurt; ~280 ms/query, ~1.5 s/transaction from the API. **Colocating API+DB is the single largest available performance win (~150×).** |
| Cache / coordination | Redis (required, no fallback) | Dispatch cascade state, driver supply geo-index, Socket.IO adapter, money locks. The API refuses to boot without it. |
| Realtime | Socket.IO, two namespaces (`/` passenger, `/driver`) | Sequenced `trip:event` channel with replay by seq |
| Maps | MapLibre + OpenFreeMap tiles; Mapbox for geocoding/directions via a server proxy | The Mapbox secret never ships in an app bundle |
| Push | Firebase Cloud Messaging | **APNs key not yet configured** — see Known Gaps |
| Payments | Paystack (integrated, **not live**) | `PAYMENTS_SIMULATED` credits top-ups instantly and marks the ledger row `SIMULATED`. Defaults ON outside production; **the API now refuses to boot if it is ON with `NODE_ENV=production`.** |
| Builds / OTA | EAS Build + EAS Update | Admin console has an OTA publish page |
| Errors | Sentry (no-op without a DSN) | |
| Tests | `yarn test` → `test:maps` (camera unit tests) + `test:invariants` | The two Expo apps have **no ESLint setup at all** — no config, no dependency, no script |

### 1.4 Runtime configuration

Every commercial knob (fares, dispatch radius, offer TTL, seat-hold duration, commission,
driver economics) is a **`PlatformSetting` row** read through `src/config/settings.js`.
Environment variables are only the *default*; a runtime setting overrides them and takes
effect on the next call, with no deploy. Registered groups:

`apps`, `booking`, `dispatch`, `driver_economics`, `pricing_eco`, `pricing_comfort`,
`pricing_premium`, `pricing_doorstep`, `pricing_rules`.

Two rules the code depends on:
- Tunables must be read **per call** through getters, never captured into a module-level
  `const` from `process.env`. A captured value is stale the moment an operator edits it.
- `/v1/config/public` serves the client-visible subset to both apps.

### 1.5 The trip state machine

`TripStatus` (Prisma enum). `trip-state.service.js` is the **only** thing that writes
`Trip.status`; every edge is legality-checked against a from→to→[permitted actors] table,
applied under a version compare-and-swap, and recorded as an append-only `TripEvent` whose
`seq` **is** the new version.

```
on-demand, pre-driver:    REQUESTED → MATCHING
group/bus, pre-departure: SCHEDULED → FILLING → CONFIRMED
driver attached:          DRIVER_ASSIGNED → DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP → IN_PROGRESS
                          REASSIGNING (driver dropped out; SAME trip goes back to dispatch)
terminal (absorbing):     COMPLETED · CANCELLED · NO_DRIVERS_FOUND · EXPIRED · NO_SHOW
```

The full edge table, with the actors permitted to make each move:

| From | To (actors) |
|---|---|
| `REQUESTED` | `MATCHING`(sys) · `CANCELLED`(rider/sys/admin) · `NO_DRIVERS_FOUND`(sys) · `EXPIRED`(sys) |
| `MATCHING` | `DRIVER_ASSIGNED`(driver/sys/admin) · `NO_DRIVERS_FOUND`(sys) · `CANCELLED`(rider/sys/admin) · `EXPIRED`(sys) |
| `REASSIGNING` | `MATCHING`(sys) · `DRIVER_ASSIGNED`(driver/sys/admin) · `NO_DRIVERS_FOUND`(sys) · `CANCELLED`(rider/sys/admin) · `EXPIRED`(sys) |
| `SCHEDULED` | `FILLING` · `CONFIRMED` · `MATCHING`(sys) · `DRIVER_EN_ROUTE`(driver/admin) · `CANCELLED` · `EXPIRED`(sys) |
| `FILLING` | `CONFIRMED` · `SCHEDULED`(sys, last seat released) · `DRIVER_EN_ROUTE`(driver/admin) · `CANCELLED` · `EXPIRED`(sys) |
| `CONFIRMED` | `FILLING`(sys) · `DRIVER_EN_ROUTE`(driver/admin) · `REASSIGNING`(sys) · `CANCELLED` · `EXPIRED`(sys) |
| `DRIVER_ASSIGNED` | `DRIVER_EN_ROUTE`(driver/sys) · `REASSIGNING`(sys) · `CANCELLED` · `EXPIRED`(sys) |
| `DRIVER_EN_ROUTE` | `ARRIVED_AT_PICKUP`(driver/sys) · `IN_PROGRESS`(driver, doorstep skip) · `REASSIGNING`(sys) · `CANCELLED` · `EXPIRED`(sys) |
| `ARRIVED_AT_PICKUP` | `IN_PROGRESS`(driver) · `NO_SHOW`(driver/sys/admin) · `REASSIGNING`(sys) · `CANCELLED` · `EXPIRED`(sys) |
| `IN_PROGRESS` | `COMPLETED`(driver/sys/admin) · `CANCELLED`(**sys/admin only**) · `EXPIRED`(sys) |
| terminal | *(no outbound edges)* |

`BookingStatus`: `PENDING → SEAT_HELD → CONFIRMED → PAID → BOARDED → COMPLETED`, plus
`CANCELLED · REFUNDED · EXPIRED · NO_SHOW`.

Notes a reviewer needs:
- **`Trip.status` is the only lifecycle authority.** `Booking.status` is seat and money state
  and must never answer "where is my ride".
- A **dispatched on-demand ride lands at `DRIVER_EN_ROUTE`**, not at a "start trip" step.
  "Start Trip" is a scheduled/group-only action.
- `Trip.driverId` is **nullable** — that is what allows `REASSIGNING` to keep the same trip id,
  receipt, share link and support thread when a driver drops out.
- **There is deliberately no `IN_PROGRESS → REASSIGNING` edge.** Dispatching a second driver to
  a rider already in a moving vehicle is not a recovery. See §3.5 and Part 8.
- Timers armed by a transition are written in the **same transaction** (`ScheduledTask` rows),
  so they cannot outlive a rollback or die with the process.

### 1.6 Dispatch — how a ride finds a driver

1. `POST /v1/rides` creates the `Trip` and, **inside the same transaction**, writes a
   `DISPATCH_START` `ScheduledTask` row. The cascade is kicked off out of band
   (`setImmediate`) — running it inline made the HTTP request take 14 s against a 15 s client
   timeout, and the client's retry then manufactured ghost trips.
2. `matcher.rankCandidates` queries the **Redis geo supply index** (`supply:drivers:geo`) for
   nearby drivers, then confirms eligibility in Postgres. **Geo narrows, SQL confirms.**
3. Presence is a per-driver Redis key with a **90 s TTL**, refreshed on every location ping and
   by a **25 s parked-driver heartbeat** in the driver app. A dead phone falls out of the pool
   by expiry rather than needing an explicit go-offline.
4. `dispatch-cascade.service.js` offers the trip to **one driver at a time** for
   `DISPATCH_OFFER_TTL_SECONDS` (default 45 s). Decline or timeout advances. The radius widens
   once. If the list empties, the search *waits* and re-sweeps every 10 s until
   `DISPATCH_SEARCH_TIMEOUT_SECONDS` (default 300 s), then fails as `NO_DRIVERS_FOUND`.
5. Cascade state is a Redis key; timers are `ScheduledTask` rows; each advance takes a short
   per-trip Redis lock. A restart mid-search resumes.
6. The offer reaches the driver by **three paths**: a `trip:event` socket frame into
   `driver:<id>`, an FCM push, and a mirrored Redis key (`dispatch:offer:driver:<id>`) that
   `GET /v1/rides/driver/state` can read. The driver app polls that endpoint every 2 s while
   not on a live trip, because an offer carries no seq and therefore **cannot be replayed**.
7. `driver-availability.js` is the **single** source of eligibility truth. A busy driver is
   never offered work.
8. **A driver cancelling pre-boarding re-enters the same cascade.** Both the on-demand path
   (`rides.service#driverCancel`) and the group path (`drivers.service#redispatchTrip`) now
   call `cascade.startCascade(tripId, { kind: 'REASSIGNMENT', excludeDriverId })`. There is
   exactly one dispatch engine. (Until 2026-08-17 the group path was a *second* one — see
   Part 7's fixed list.)
9. **Scheduled/`TripRequest` broadcast is a separate, deliberate path.**
   `trip-request.service.js` notifies every eligible driver at once for a *scheduled* request,
   because nobody sits on a 45 s countdown for a ride four days out. It uses
   `availableDriverWhere()` for membership and the `drivers:online` geo-set only as a ranking
   hint. This is intentionally not the cascade.

### 1.7 Pricing

```
seat fare = (baseFarePesewas + perKmRatePesewas × roadDistanceKm) × surgeMultiplier / maxSeats
            floored at MIN_FARE_PER_SEAT_PESEWAS
```

- Distance is **road distance** (Mapbox), never haversine — the two disagree by 1.3–2×.
- `maxSeats` is the denominator for group trips. An on-demand ride is priced as the whole car
  (`maxSeats = 1`).
- Defaults (2026-08-17, raised ~30% at the operator's request): ECO ₵30 + ₵11/km, COMFORT ₵42 +
  ₵16/km, PREMIUM ₵60 + ₵21/km. Per-seat floor ₵4.00. Platform commission 15%.
- Surcharges: doorstep pickup (`max(MIN_FEE, detourKm × PER_KM)`, refused beyond
  `DOORSTEP_MAX_DETOUR_KM`), heavy load (`Booking.heavyCargo`), group-joiner deviation beyond
  `FREE_DEVIATION_KM` (`Booking.deviationSurchargePesewas`).
- Quotes are **signed, single-use and short-lived**; the quote is burnt at booking, **not**
  before dispatch can fail (an earlier version burnt it first, producing a "price expired" loop
  every time dispatch failed).
- **The economics of a half-empty bus are real and now explicit.** Because `maxSeats` is the
  denominator, a driver departing with 1 of 15 seats drives the whole route for a fifteenth of
  its fare. `POST /driver/trips/:id/depart` refuses once with `409 BELOW_MIN_OCCUPANCY` and
  `details: { confirmedSeats, minOccupancy, maxSeats }`; the driver app shows a confirm sheet
  and re-sends with `acknowledgeUnderMinimum: true`. The acknowledgement is recorded on the
  `TripEvent`.

### 1.8 Tiers

`ECO` (shared), `COMFORT` (AC/wifi), `PREMIUM`, plus a `ROYAL` tier present in the colour
tokens. Tier colours: eco green, comfort blue, premium gold, royal purple — used consistently
for badges, icons and glow rings.

**Naming hazard:** the tier is `ECO` in the fare tables and Prisma, but some UI code has used
`ECONOMY`. A mismatch here has previously greyed out every tier card.

### 1.9 Design system

- Two themes per app, light and dark. Rider brand is green; driver brand is blue.
- Dark mode is the primary design; light mode was overhauled 2026-08-17 (white cards, tone in
  the page, themed glow-ring gaps). **Light mode inverts the elevation direction** — a shadow
  that reads as "raised" in dark reads as "pressed" in light.
- A Skia "LightPillar" shader is the ambient background. **Only one Skia canvas may be painted
  at a time** — enforced by a shader-slot registry keyed on navigation *focus*, not mount
  order. Stacked full-screen canvases have repeatedly overheated devices.
- `usePerformanceTier` degrades effects on weak devices. **Low Power Mode must never be wired
  into it** — it kills every visual effect at once.
- Motion tokens live in `packages/ui/src/motion`; springs are all ζ=1.0 and response-derived.
- `Pressable` must come from `@eyego/ui`, never React Native — NativeWind's css-interop
  registers RN's and silently drops the `({ pressed }) => style` function form. **264 files
  currently import the RN one**; most are harmless (a plain object style works fine), and the
  enforced guard covers the combination that actually breaks. See Part 7.
- The rider colour palette has **no `warning` token** — `warning` exists only on
  `DriverColorTokens`. Rider surfaces use `colors.error` for cautionary states.

---

## Part 2 — Rider app (`apps/rider`)

Expo + expo-router. Tab bar: **Home · Activity · Services · Trips · Notifications · Account**.

### 2.1 Onboarding & authentication
| Screen | What it does |
|---|---|
| `(onboarding)/index.tsx` | Onboarding carousel |
| `(auth)/phone.tsx` | Phone-number entry, requests an OTP |
| `(auth)/otp.tsx` | OTP verification |
| `(auth)/register.tsx` | Registration (name, email) |
| `(auth)/social.tsx` | Google / Apple sign-in |

**Logic that matters:** token refresh runs behind an **auth-ready gate** — requests are held
until SecureStore has been read, so a token-less 401 on cold start cannot be mistaken for an
ended session and bounce the user to the login screen. `POST /v1/auth/{request-otp,verify-otp,
google,apple,refresh,logout}`.

### 2.2 The booking flow — one route, six stages

`app/trip.tsx` hosts a **single map and a single morphing sheet**. There is one route, not six
screens; the sheet deforms between stages rather than unmounting and remounting.

| Stage | Purpose | Map? |
|---|---|---|
| `search` | Destination entry (floating card; morph target for the home Where-To pill) | no |
| `configure` | Steps 3–5 of the wizard — pickup, options, passenger details | no |
| `select` | Tier selection with live fares, virtualised results list | yes |
| `request` | "Finding your driver" with truthful cascade progress (`Asking driver N of M`) | yes |
| `assigned` | Driver attached — photo, plate, ETA to pickup, call/chat | yes |
| `tracking` | Live ride — route line, ETA to destination, share, safety | yes |

**Logic that matters:**
- `search` and `configure` draw **no map** (the Skia ground shows instead) — this is a
  deliberate performance decision, not an oversight.
- The map camera is a state machine with modes (`follow`, `overview`, `free`), a user-override
  release, and a recentre chip that must clear the fit memo or the tap looks inert.
- `stores/trip.store.ts` projects everything off the **sequenced `trip:event` channel**. It
  replaced two `setInterval` polls and four bespoke `dispatch:*` listeners; the client no
  longer decides what stage it is in.
- `packages/api/src/tripChannel.ts` handles recovery: rejoin on `connect`, gap detection
  (`seq > lastSeq + 1`), HTTP replay via `GET /rides/:id/events?since=`, reconnect-as-ack, a
  30 s periodic high-water ack, **and a 5 s HTTP fallback poll whenever the socket is not
  connected** (added 2026-08-17 — for networks that block WebSocket upgrades outright, where no
  `connect`-triggered recovery path can ever fire).
- `DISPATCH_PROGRESS` is tracked *alongside* the snapshot, not inside it: three drivers may be
  asked in sequence and only one becomes a transition.
- `DRIVER_LINK_LOST` / `DRIVER_LINK_RESTORED` (see §5.2) set `driverLinkLostSinceMs`, which the
  tracking chip renders in preference to "Reconnecting…" — the two are different problems and
  only one of them is the rider's own network.

### 2.3 Home (`(tabs)/home.tsx`)
- Greeting, Where-To glow search bar (the morph source for the booking flow)
- **Suggested for you** — nearby/soon group trips, tier-coloured glow ring, seats left,
  per-seat fare, destination, "Top pick" badge
- Live status cards: active booking, "Finding your driver" pending request, next scheduled ride
- Quick actions: Scan (to pay), Saved places, Schedule, Wallet
- Ambient Skia background

### 2.4 Ride lifecycle screens (`app/ride/*`)
| Screen | What it does |
|---|---|
| `[id].tsx` | Ride/trip detail with "Book this seat" |
| `[id]/seat.tsx` | Seat map picker (size = `maxSeats`) |
| `select.tsx`, `request.tsx` | Legacy/entry surfaces for tier + request |
| `guest-selection.tsx` | Book on someone else's behalf — `guestName`/`guestPhone` reach the driver |
| `[id]/payment.tsx` | Pay for a booking |
| `[id]/invite.tsx` | Generate/regenerate a `RideGroup.shareToken` so friends join the same trip; the host can **cover-all** |
| `join/[token].tsx` | Public join page for an invite link |
| `[id]/chat.tsx` | In-trip chat with the driver — typing indicators, read receipts, private messages, an offline outbox |
| `[id]/tracking.tsx` | Legacy tracking surface |
| `[id]/complete.tsx` | Receipt: total fare, seat count, per-seat, surcharges, platform fee |
| `[id]/rate-tip.tsx` | Rate the driver and tip |
| `[id]/cancel.tsx` | Cancellation with a fee preview (`GET /cancellation/:bookingId/fee`) |
| `[id]/dispute.tsx` | Raise a dispute on a completed trip |
| `[id]/sos.tsx` | The safety screen (see §2.7) |

**Cover-all logic (the source of a whole bug family):** a rider covering a group owns **one
`Booking` row per seat**, linked by `Booking.isCoveredByLead`. Every surface showing "what this
rider owes" must aggregate them via `getTripFareForRider`; every surface listing *people* must
dedupe them. Receipts, rating cards, chat threads and passenger lists have each got this wrong
at least once.

### 2.5 Scheduling
- `ride/schedule.tsx` — schedule a ride for later
- `ride/reserve.tsx` — reserve a seat on a published group trip
- `scheduled-rides.tsx`, `scheduled/[id].tsx` — manage `ScheduledRideIntent` rows
  (`PENDING → DISPATCHED → MATCHED`, or `CANCELLED`/`EXPIRED`)

A scheduled ride creates an **ad-hoc, non-searchable `Route`** transparently, because
`ScheduledRideIntent.routeId` is still a required FK after the pivot. Riders never pick a route.

### 2.6 Money
| Screen | Endpoint |
|---|---|
| `profile/wallet.tsx` | `GET /v1/wallet/{balance,transactions}`, `POST /topup` |
| `profile/payment-methods.tsx`, `payment/add-card.tsx` | `GET/DELETE /payment-methods`, `POST /payment-methods/{initialize,verify}` |
| `profile/send-money.tsx`, `pay/[phone].tsx` | `POST /v1/wallet/send` — peer transfer by phone |
| `profile/scan-pay.tsx` | QR scanner that pays a driver (`Booking.boardingQr`) |
| `profile/promotions.tsx` | `GET /bookings/promos/validate`, `POST /bookings/:id/apply-promo` |
| Receipts | `GET /v1/receipts`, `GET /v1/receipts/:bookingId` |

Wallet writes carry `balanceBefore`/`balanceAfter` and are idempotent. Money endpoints honour
`Idempotency-Key` via the `IdempotencyKey` model.

### 2.7 Safety
- `ride/[id]/sos.tsx` — live location watch, **RideCheck** (route-deviation and
  unexpected-stop detection with a 45 s auto-escalation), **Night Safety** periodic check-ins,
  trusted-contact SMS, a dedicated **Send SOS to EyeGo** button, and an Emergency Call button
  that dials 112. Opening the page must **not** itself raise an SOS (it used to).
- `profile/emergency-contacts.tsx` — `EmergencyContact` rows (the rider relation, *not* the
  driver's singular string column — the two are different shapes)
- `profile/safety.tsx` — persisted RideCheck / Night Safety preferences
- Share trip status with a trusted contact by SMS (`/track/:shortId`)

### 2.8 Profile & account
`profile/edit` · `settings` · `notification-preferences` · `privacy` · `saved-places` +
`place-picker` (**Home/Work are slots, not labels** — a saved place occupies a slot) ·
`business` (business mode, company name, tax id, expense email) · `help` (support tickets with
threaded replies) · `terms` · `account-deletion` · insurance document upload
(`POST /v1/user/me/insurance`) · an **account-checklist** completeness card
(`GET /v1/user/me/account-checklist`, must refetch after an edit).

### 2.9 Activity & notifications
- Activity tab: **Trips** / **Alerts** / **Scheduled**
- Trip rows show origin → destination, **falling back to the trip's own
  `pickupAddress`/`dropoffAddress`** for on-demand rides (which have no meaningful `Route`
  names — this is why the list once read "Unknown → Unknown"), status chip, fare, inline cancel
- Notifications tab with unread counts (`GET /v1/notifications/unread-count`)

---

## Part 3 — Driver app (`apps/driver`)

Expo + expo-router. Tab bar: **Home · Trips · Earnings · Quests · Notifications · Profile**.

### 3.1 Onboarding, verification and gating
- Phone + OTP sign-in (`/v1/auth/driver/{request-otp,verify-otp,refresh}`), registration
- `(profile)/documents.tsx` — licence, insurance, roadworthiness etc. Per-document admin review
  writes a JSON blob: `{ status: 'PENDING'|'VERIFIED'|'REJECTED', rejectionReason, reviewedAt }`
- `(profile)/vehicle.tsx` — vehicle registration incl. `seaterCount`, plate, tier
- **`Driver.status` is a free-form `String`** (default `"PENDING_REVIEW"`), and dispatch
  eligibility compares it to the exact literal `'ACTIVE'`. The canonical set now lives in
  `eyego-api/src/utils/driver-status.js`
  (`PENDING_REVIEW · ACTIVE · SUSPENDED · REJECTED · DEACTIVATED`) with
  `normalizeDriverStatus()` / `assertDriverStatus()`, plus a boot-time repair sweep
  (`services/driver-status-repair.js`) that canonicalises dirty rows. **Approved is `'ACTIVE'`,
  never `'APPROVED'`** — `'APPROVED'` is the correct value for *document* review, which is why
  it is the trap.
- `POST /driver/dev-activate` auto-approves and skips every gate (dev only)
- Going online requires a wallet balance of at least `DRIVER_REQUIRED_WALLET_TO_GO_ONLINE`

### 3.2 Home & availability
- Online/offline toggle (`POST /driver/go-online|go-offline`) with an `OnlineSession` ledger
- Live location streaming (`driver:location_update`) with a **Ghana-bounds validator** — an
  out-of-bounds fix is rejected with an explicit `driver:location_rejected` frame explaining
  why the driver will not receive work, rather than dropped silently
- A **25 s parked heartbeat** (`POST /driver/presence`) so a stationary driver does not fall
  out of the pool, plus background-task location
- **Demand overlay / heatmap** (`GET /v1/heatmap`)
- **Destination mode** (`GET/POST/DELETE /driver/destination`) — set a destination and get one
  ride heading that way. The session ends **at match, not at drop-off**, so the driver returns
  to the general pool immediately.
- **Requests paused** toggle (`PATCH /driver/requests-paused`)
- Connection banner ("Reconnecting…")

### 3.3 Receiving work
- **`DispatchOfferSheet`** — root-mounted, so an offer appears over any screen. Shows earnings,
  ETA, pickup and drop-off addresses, and a **server-authoritative countdown**
  (`expiresAtServerMs − serverNowMs`), so two phones show the same seconds.
- `(trip)/dispatch/[id].tsx` — the offer screen for admin-assigned and scheduled trips
- Offer recovery: hydrate on cold start, on foreground, on socket reconnect, **and on a 2 s
  poll** of `GET /rides/driver/state` — because an offer carries no seq and cannot be replayed.
  `stores/trip.store.ts` re-hydrates on every `connect`.
- `POST /driver/trips/:id/{accept,decline,claim-reassignment}`

### 3.4 Publishing a trip (the group/minibus product)
`(trip)/create.tsx` — a wizard: pickup pin → destination pin → seat count (**capped at the
vehicle's `seaterCount`**, and the cap must not silently clamp the driver's choice without
telling them) → departure time → tier → fare preview → publish. `location-picker.tsx` supports
map-pin selection and remembered destinations. `POST /v1/driver/trips`.

### 3.5 Running a trip
| Screen / action | What it does |
|---|---|
| `(trip)/active/[id].tsx` | The manage screen: map, route line, live ETA **for the leg actually being driven**, seat map, passenger list, payment QR, add-passenger, step chips, status actions |
| `(trip)/tracking/[id].tsx` | The live map screen for `IN_PROGRESS` |
| `(trip)/detail/[id].tsx` | Read-only trip detail |
| `(trip)/add-passenger.tsx` | Add an offline passenger by phone; the booking stays `SEAT_HELD` until they read back the SMS code (`offlineOtp`/`offlineOtpVerified`) |
| Boarding PIN | `Booking.boardingPin` / `pinVerifiedAt`, opt-in per rider — the driver verifies a passenger before boarding them (`POST /driver/trips/:id/board/:bookingId`) |
| `(trip)/chat/[id].tsx` | Chat with riders, including private per-passenger threads |
| `(trip)/cancel/[id].tsx` | Driver cancel; redispatches the **same** trip up to `MAX_REDISPATCH` times |
| `(trip)/complete/[id].tsx` | Trip summary and earnings |
| `(trip)/rate-passengers/[id].tsx` | Rate each passenger — **one card per person, not per seat** |
| `(trip)/report/[id].tsx` | Report an incident (`TripReport`) |
| SOS | `POST /driver/trips/:id/emergency` |

**Status action logic.** The advance mutation is `retry: 0` on purpose — a transition is not
idempotent, so replaying one that already landed is rejected by the version CAS. A `409` is
therefore interpreted as "this step already went through", the trip is re-read, and the driver
is told nothing alarming. **Exception:** `409 BELOW_MIN_OCCUPANCY` means the departure did
*not* happen and is handled first, with a confirm sheet. Any future 409 with its own meaning
must be branched before the generic handler or it will be silently swallowed.

**Driver disappears mid-trip.** Presence expiry drops a driver from the dispatch pool but says
nothing to the rider already in the car. `services/driver-link-watch.service.js` sweeps live
trips every 30 s and, after 120 s of lost presence, publishes `DRIVER_LINK_LOST` into
`trip:<id>` plus a fast ops alarm; `DRIVER_LINK_RESTORED` clears it. It deliberately does
**not** reassign or cancel — see §1.5. It also skips the pass entirely if *every* driver
appears absent, because that is a Redis blip rather than a fleet-wide outage.

### 3.6 Money & performance
- `(tabs)/earnings.tsx` — `GET /driver/earnings/{breakdown,transactions}`, chart + list
- `(profile)/payout-account.tsx` — payout details; `DRIVER_MIN_WITHDRAWAL` enforced
- `(tabs)/quests.tsx` — `DriverQuest` / `DriverQuestProgress`, `POST /v1/quests/:id/claim`
- `(profile)/performance.tsx`, `(profile)/ratings.tsx` — acceptance/completion stats and rider
  ratings; `rating-integrity.service.js` guards against self-dealing
- **Driver shifts** — `POST /driver/shifts/{start,end}`, `GET /driver/shifts/{current,history}`
- **Vehicle inspections** — `GET/POST /driver/inspections`

### 3.7 Notifications the driver receives
Trip offer · trip assigned (admin) · passenger joined · pickup point changed · payment
confirmed · chat message · SOS · driver approved/rejected · rating received · low wallet ·
tip received · express mode.

All of them are owned by `trip-notify.service.js`. **Nothing else may send one** — a duplicate
sender is how riders got told the same news twice.

---

## Part 4 — Admin console (`apps/admin`)

Next.js 15 App Router. **All API access is server-only** — the browser never holds an admin
token. Design system is "Graphite". Auth is `AdminUser` + JWT with a forced change-password
flow (`/change-password`), plus an append-only `AdminAuditLog`.

### 4.1 RBAC
| Role | Scope |
|---|---|
| `SUPERADMIN` | Everything, incl. managing admins and publishing OTA builds |
| `OPS` | Live map, dispatch, assignment, driver approval, surge |
| `FINANCE` | Payouts, receipts, promotions, revenue. Read-only on ops |
| `SUPPORT` | Tickets, disputes, SOS triage. Read-only on money and fleet config |
| `VIEWER` | Sees everything, changes nothing |

Enforced by `middleware/adminRbac.js` on the **server**. A reviewer should verify that, not
the nav.

### 4.2 Pages and what each one reads or writes
| Page | Backing endpoints | Notes |
|---|---|---|
| `/` | `GET /admin/metrics` | Operations dashboard — live metrics |
| `/map` | `GET /admin/live/drivers`, `/admin/drivers/live` | Reads the `drivers:online` geo-set (the *display* set, **not** the dispatch pool) |
| `/dispatch` | `GET /admin/trips/unassigned`, `GET /admin/dispatch/health`, `POST /admin/trips/:id/assign` | Manual assignment + dispatch diagnostics |
| `/trips`, `/trips/[id]` | `GET /admin/trips`, `/admin/trips/:id`, `/admin/trips/active` | Full trip detail incl. the `TripEvent` timeline |
| `/bookings` | `GET /admin/bookings` | |
| `/drivers`, `/drivers/[id]`, `/drivers/pending` | `GET /admin/drivers{,/:id,/pending,/:id/trips}`, `POST /admin/drivers/:id/{approve,suspend,reject}`, `POST /admin/drivers/:id/documents/:type/review` | Approve writes `status: 'ACTIVE'` |
| `/users`, `/users/[id]` | `GET /admin/users{,/:id,/:id/trips}`, `POST /admin/users/:id/{ban,unban}` | |
| `/sos` | `GET /admin/sos-events`, `POST /admin/sos-events/:id/resolve` | Reporter, both phone numbers, **reverse-geocoded** location, static map |
| `/trip-reports` | `GET /admin/trip-reports`, `POST /admin/trip-reports/:id/resolve` | |
| `/tickets`, `/tickets/[id]` | `GET /admin/support-tickets{,/:id}`, `POST .../respond`, `.../close` | |
| `/revenue` | Derived from `Booking` where `paymentStatus = PAID` | **Not** from `WalletTransaction` — see Part 8 |
| `/analytics` | `GET /admin/analytics/{overview,drivers,safety,scheduled}` | |
| `/surge` | `GET /admin/surge/{zones,resolve}`, `POST /admin/surge/:zoneId` | Inspect and override multipliers |
| `/promotions` | `GET/POST /admin/promotions`, `POST /admin/promotions/:id/toggle` | |
| `/pulse-schedules` | `GET/POST/DELETE /admin/pulse-schedules` | `PulseSchedule` rows |
| `/config` | `GET /admin/settings` | **Runtime `PlatformSetting` editor** — every fare/dispatch knob |
| `/settings` | | Console settings |
| `/admins` | `GET/POST /admin/admins`, `PATCH /admin/admins/:id`, `POST .../reset-password` | |
| `/audit-logs` | `GET /admin/audit-logs` | Append-only |
| `/ota` | `GET /admin/ota/{overview,runs}`, `POST /admin/ota/publish` | EAS Update |

Console maps use `@eyego/map-styles` over OpenFreeMap, so no admin page needs a map token.

**Known historical hazard in this app:** admin queries have repeatedly invented their own
definition of a shared concept — revenue read the wrong table, "active trip" had three
definitions, seat predicates were written inline ten different ways. Anything the admin
computes that the API also computes is worth checking.

---

## Part 5 — Backend surface

### 5.1 REST (`/v1/*`)

Mounted namespaces: `auth`, `user`, `trips`, `rides`, `bookings`, `payments`, `notifications`,
`wallet`, `driver/wallet`, `driver`, `driver/documents`, `heatmap`, `quests`, `contact`,
`cancellation`, `receipts`, `geo`, `routes`, `config`. Plus `/graphql` and a separate `/admin`
mount.

**`/v1/auth`**
```
POST /request-otp · /verify-otp · /google · /apple · /refresh · /logout
POST /driver/request-otp · /driver/verify-otp · /driver/refresh
```

**`/v1/rides` — the on-demand pipeline (one path, both apps)**
```
POST /quote                 signed, single-use, short-lived quote
POST /                      create the trip + start dispatch (honours Idempotency-Key)
GET  /active                rider one-call rehydration
GET  /:id/events?since=     replay by seq
POST /:id/cancel            rider cancel
GET  /driver/state          driver one-call rehydration (trip + held offer + serverNowMs)
POST /:id/accept | /decline | /en-route | /arrived | /start | /complete | /driver-cancel
```

**`/v1/trips`** — `GET /pulse` · `GET /` (search) · `/active` · `/fare-estimate` ·
`/nearby-drivers` · `/scheduled` · `/:id` · `/:id/contact` · `/:id/seats` · `/:id/receipt` ·
`/:id/deviation-estimate` · `POST /:id/group` · `POST /:id/emergency` · `GET /request/:id` ·
`DELETE /request/:id` · `DELETE /scheduled/:id` · `POST /:id/driver-no-show` ·
`POST /:id/rider-no-show/:bookingId`.
**Public (unauthenticated, rate-limited by `publicShareLimiter`, 60/min/IP):**
`GET /join/:shareToken` · `GET /track/:shortId/data` · `GET /join/:shareToken/data`.
`/track/:shortId/data` is **lifecycle-gated**: once the trip is terminal it returns status and
route names only — no driver position, no photo, no vehicle.

**`/v1/bookings`** — `GET /promos/validate` · `GET /` · `POST /` (`bookingCreateLimiter`,
Serializable transaction) · `GET /active` · `POST /join/:shareToken` · `GET /:id` ·
`POST /:id/cancel` · `DELETE /:id` · `POST /:id/{rating,tip,apply-promo,dispute,invite,
invite/regenerate}` · `GET /:id/group`.

**`/v1/driver`** — the largest namespace. `me` (get/patch/delete) · `fcm-token` · `verify` ·
`vehicle` · `dev-activate` · `go-online` / `go-offline` / `presence` · `performance` ·
`ratings` · `documents` (get/post) · `emergency-contact` · `preferences` · `fare-estimate` ·
`trips` (post/get) · `trips/all` · `trips/active` · `trips/:id` ·
`trips/:id/{start,arrive-at-pickup,depart,arrive,emergency,accept,claim-reassignment,decline,
cancel,board/:bookingId}` · `trip-requests/pending` · `trip-requests/:id/{accept,decline}` ·
`scheduled/upcoming` · `requests-paused` · `rate-passenger/:bookingId` ·
`destination-filter` (get/post/delete) · `shifts/{start,end,current,history}` ·
`earnings/{breakdown,transactions}` · `notifications` · `support-tickets` (+ `/:id/reply`) ·
`inspections` · `destination` (get/post/delete).

**`/v1/user`** — `me` · `me/account-checklist` · `avatar` · `me/wallet` ·
`me/support-tickets{,/:id}` · `me/emergency-contacts` · `me/notifications` ·
`me/preferences` · `me/safety-settings` · `me/insurance` · `me/privacy-settings` ·
`me/saved-places{,/:placeId}`.

**`/v1/wallet`** — `balance` · `transactions` · `send` · `topup` · `payment-methods`
(+ `/initialize`, `/verify`, `DELETE /:id`).

**Others** — `/v1/cancellation/:bookingId/{fee,cancel}` · `/v1/receipts{,/:bookingId}` ·
`/v1/geo/{search,reverse,route}` (Mapbox proxy) · `/v1/heatmap` ·
`/v1/quests{,/history,/:id/claim}` · `/v1/notifications{,/unread-count,/:id/read,/read-all}` ·
`/v1/payments/{webhook,verify/:reference}` · `/v1/contact/call{,/:callId/end}` ·
`/v1/routes{,/quick,/:id,/:id/stops}` · `/v1/config/public`.

**Rate limiters** (`middleware/rateLimiter.js`): `defaultLimiter` (100/15 min),
`authLimiter` (10/15 min), `otpLimiter`, `paymentLimiter`, `paymentInitiateLimiter`,
`bookingCreateLimiter` (20/min, keyed on user id), `publicShareLimiter` (60/min, keyed on IP).

**Error shape.** `{ success, code, message, errors?, details? }`. `details` is forwarded only
for `AppError`s (`isOperational`), for refusals a client must *render* rather than display.

### 5.2 Sockets

**Passenger namespace (`/`)** — client emits: `passenger:join_trip_room`,
`passenger:leave_trip_room`, `chat:typing_start`, `chat:typing_stop`, `chat:send`,
`chat:private_send`, `chat:read`, `passenger:payment_confirmed`, `safety:location`,
`trip:subscribe`, `trip:unsubscribe`, `trip:ack`.

**Driver namespace (`/driver`)** — client emits: `driver:location_update`,
`driver:join_tracking`, `driver:trip_started`, `driver:arrived_at_pickup`,
`driver:trip_departed`, `driver:arrived`, the same five chat events, `driver:seat_updated`.

**Server emits:** `trip:event` (the sequenced lifecycle envelope) · `trip:eta` · `trip:route` ·
`trip:seat_update` · `trip:status_change` · `trip:passenger_joined` · `trip:pickup_changed` ·
`driver:location` · `driver:location_update` · `driver:location_rejected` · `safety:check` ·
`chat:history` · `chat:message` · `chat:private_message` · `chat:read_receipt` ·
`chat:typing` · `passenger:payment_confirmed` · `error`.

**`trip:event` types** — status transitions (all 15 `TripStatus` values), plus the
non-lifecycle frames which carry `seq: null` and are never replayed:
`SNAPSHOT` · `DISPATCH_PROGRESS` · `DRIVER_LOCATION` · `ETA` · `OFFER` · `OFFER_REVOKED` ·
`DRIVER_LINK_LOST` · `DRIVER_LINK_RESTORED`.

### 5.3 Services (`eyego-api/src/services/`)
| Service | Responsibility |
|---|---|
| `trip-state.service.js` | THE state machine. Only writer of `Trip.status`. Version CAS + `TripEvent` |
| `dispatch-cascade.service.js` | Sequential offer cascade, Redis state, per-trip lock, re-sweep |
| `matcher.service.js` | Ranks candidates (Redis geo narrows, SQL confirms) |
| `driver-availability.js` | THE eligibility rule. `availableDriverWhere()` / `isDriverAvailable()` |
| `supply-index.service.js` | `supply:drivers:geo` + per-driver presence keys (90 s TTL) |
| `driver-link-watch.service.js` | Presence loss on a **live** trip → `DRIVER_LINK_LOST` |
| `driver-status-repair.js` | Boot-time canonicalisation of dirty `Driver.status` rows |
| `eta.service.js`, `route-geometry.service.js` | One ETA and one road line, shared by both apps |
| `trip-view.js`, `trip-events.publisher.js` | Snapshot building and fan-out |
| `trip-notify.service.js` | **Sole** owner of push, Live Activity and pub/sub |
| `trip-lifecycle.service.js`, `stale-trips.js` | Expiry sweeps |
| `trip-health.service.js` | Stuck-trip and task-worker alarms. Reports; does not remediate |
| `scheduled-task.service.js` | Durable timers. `FOR UPDATE SKIP LOCKED` claim + lease |
| `fare-quote.service.js` | Signed, single-use quotes |
| `boarding-pin.service.js`, `rating-integrity.service.js` | Boarding verification, rating fraud |
| `destination-mode.service.js` | One-ride-toward-destination sessions |
| `push.service.js`, `live-activity-push.service.js`, `sms.service.js`, `otp.service.js` | Delivery |
| `mapbox.service.js`, `cloudinary.service.js` | External providers |

### 5.4 Data model (Prisma)

44 models: `User` · `SavedPlace` · `EmergencyContact` · `SavedCard` · `RefreshToken` ·
`Driver` · `Vehicle` · `Route` · `VirtualStop` · `Trip` · `TripEvent` · `ScheduledTask` ·
`RideGroup` · `Booking` · `CancellationPolicy` · `Receipt` · `DriverReceipt` ·
`PaymentTransaction` · `IdempotencyKey` · `CallSession` · `DriverQuest` ·
`DriverQuestProgress` · `TripRequest` · `ScheduledRideIntent` · `PulseSchedule` ·
`WalletTransaction` · `DriverShift` · `DriverDestinationPreference` · `VehicleInspection` ·
`Message` · `DriverRating` · `PassengerRating` · `Promotion` · `Referral` · `ReferralBonus` ·
`SupportTicket` · `TicketMessage` · `SosEvent` · `TripReport` · `DispatchAction` ·
`OnlineSession` · `PlatformSetting` · `AdminUser` · `AdminAuditLog`.

**Only five Prisma enums exist:** `TripStatus`, `TripEventActor`, `BookingStatus`,
`ScheduledTaskStatus`, `AdminRole`. **Everything else that looks like an enum is a
free-form `String`** — `Driver.status`, `Vehicle.status`, ticket status, promotion type,
notification type, chat message type, `Trip.tier`, `Booking.paymentStatus`,
`Booking.paymentMethod`. This is the single largest remaining class of silent-failure risk in
the schema, and a reviewer is explicitly invited to audit it.

**`Trip` fields:** `id · shortId · driverId? · vehicleId? · routeId · requesterId · tier ·
status · version · doorstepPickup · pickup{Lat,Lng,Address} · dropoff{Lat,Lng,Address} ·
departureTime · requestedAt · assignedAt · departedAt · arrivedAt · completedAt · cancelledAt ·
cancelledBy · cancellationReason · baseFarePesewas · perKmRatePesewas · surgeMultiplier ·
commissionRate · confirmedSeats · maxSeats · isExpressMode · heavyLoad · redispatchCount ·
pulseScheduleId`.
`shortId` is `@unique @default(cuid())` and is what the public tracking link exposes.
**There is no `farePerSeatPesewas` column** — the per-seat fare is always derived.

**`Booking` fields:** `id · tripId · userId · seatNumber? · fareAmountPesewas ·
commissionAmountPesewas · paymentMethod · paymentStatus · paystackRef · guestName ·
guestPhone · isOffline · offlinePhone · offlineOtp · offlineOtpExp · offlineOtpVerified ·
isCoveredByLead · boardingQr · promotionId · status · boardingPin · pinVerifiedAt ·
cancelledAt · cancellationReason · cancellationFeePesewas · pickupStopId · enRouteRatio ·
pickup{Lat,Lng,Address} · deviationSurchargePesewas · heavyCargo · liveActivityId ·
liveActivityPushToken`.

---

## Part 6 — Invariants a reviewer should check against

These are load-bearing rules the code depends on. **A violation of any of them is a bug**, and
they are the most productive things to grep for.

**Seats and bookings**
1. Seat occupancy is decided by `seatOccupyingWhere()` / `SEAT_OCCUPYING_STATUSES` — **never**
   by "status is not CANCELLED".
2. Releasing a seat means setting `seatNumber = null`, not only changing the status.
3. `confirmedSeats` is floored at 0 and guarded by the `PAID` state. It is incremented **only**
   when payment settles or the driver adds a cash passenger — `bookSeat` does not increment it,
   so an unconditional decrement takes it negative and the trip then advertises
   `maxSeats + n` seats.
4. `availableSeats` is derived **once, on the server**, from occupancy-filtered bookings. The
   client must not recompute it.
5. `maxSeats` — the capacity the driver chose — is the fare denominator and the seat-map size.
   `vehicle.seaterCount` is only the cap.

**Money**
6. All money is integer **pesewas**. Cedis appear only at the display edge and in
   `config/env.js`.
7. Per-seat fare is **derived** by the fare calculator; there is no `farePerSeatPesewas`
   column of record.
8. Wallet writes carry `balanceBefore`/`balanceAfter` and are idempotent.
9. A rider who covered a group owns **one Booking per seat**. Any surface showing "what this
   rider owes" must aggregate them (`getTripFareForRider`), and any surface listing *people*
   must dedupe them.
10. Simulated payments cannot exist in production — asserted at boot, fail-closed.

**Dispatch**
11. `driver-availability.js` is the only eligibility source.
12. The dispatch pool is `supply:drivers:geo` + the presence key, **not** `Driver.isOnline`,
    and **not** `drivers:online` (which is the admin display set).
13. An offer carries no seq and is never replayed — every recovery path must go through
    `GET /rides/driver/state`.
14. Exactly one driver holds an offer at a time; advancing takes the per-trip Redis lock.
15. There is exactly **one** dispatch engine (`dispatch-cascade.service.js`). Any code path
    that selects candidates and notifies them itself is a second one, and is a bug.

**Realtime**
16. Anything published must carry the relations the client renders, or the client receives a
    blank snapshot.
17. `trip:eta` is emitted into `trip:<tripId>`; a client that has not joined that room gets
    nothing. Joining is idempotent — join on mount **and** on every reconnect.
18. Notification ownership is single: `trip-notify.service.js` owns push, Live Activity and
    pub/sub. Never add a notification anywhere else.
19. Every socket frame the server emits must have a listener on the other end. Three separate
    bugs have been "the server said it and nobody was listening".

**Client**
20. `Pressable` from `@eyego/ui`, never React Native.
21. In React Native, an absolutely positioned child (`StyleSheet.absoluteFill`) is laid out
    against its parent's **padding box**, not its border box.
22. RN `flex: 1` implies `flexBasis: 0` — it collapses a content-sized child.
23. RN `scale` transforms about the **centre**, not the top-left.
24. Only one Skia canvas at a time; ownership is navigation **focus**, not mount order.
25. MapLibre camera padding is a native prop and cannot be driven by a Reanimated shared value.
26. `fitBounds` with a degenerate bbox is a **SIGABRT**, not a warning.
27. Gesture callbacks are auto-worklets — calling a JS function directly inside one crashes.
28. A `409` is not automatically "already done". Any 409 with its own `code` must be branched
    before the generic conflict handler.

---

## Part 7 — Known gaps (already discovered — do NOT report these back)

**Infrastructure / operational**
- **APNs key is not configured.** iOS push notifications do not arrive. Chat "push" works only
  because it is a *local* notification. This degrades dispatch to socket + REST-poll delivery.
- **Paystack is not live.** `PAYMENTS_SIMULATED` credits top-ups instantly and marks them
  `SIMULATED`. No real money moves anywhere in the system.
- **The database is in Frankfurt** while the API is elsewhere: ~280 ms/query, ~1.5 s per
  transaction. Colocation is worth roughly 150× and is not a code problem.
- Prisma migration SQL is gitignored; some tables (e.g. `PlatformSetting`) were created
  directly on the dev database. **This is why `Driver.status` was fixed with a normaliser and a
  boot repair sweep rather than a Prisma enum migration.**
- **The two Expo apps have no ESLint setup at all.** Grep-checkable invariants live in
  `scripts/invariants.test.mjs`, run by `yarn test`.
- **264 files import `Pressable` from `react-native`.** Most are harmless — RN's Pressable
  handles a plain object style fine. The enforced guard covers the case that actually breaks
  (a function style in a file that imports nothing from `@eyego/ui`), which is currently clean.
  Migrating the rest is a tracked cleanup, not a defect.
- Everything below is **type-clean but not device-tested**.

**Features deliberately not built** (see `docs/FEATURE_BACKLOG_DRIVER_RIDER.md` for costs)
- Rider comfort & accessibility toggles
- Driver rating filter & demographic opt-outs
- Split-fare engine
- Driver-initiated destination edit mid-trip
- Trip Radar / broadcast fallback after the first sequential sweep
- Reckless-driving telemetry
- Area preferences / geofencing with a daily time allotment
- Idle-time digital tasks
- Multi-stop trips
- Rider-side loyalty / rewards (Quests are driver-only)
- Encrypted "Record My Ride" — **blocked pending legal review**, not pending engineering

**Known incomplete UI**
- Business expense email flow is not built end to end
- Driver-side dispute-resolution UI is not built (riders can raise disputes; drivers cannot
  respond in-app)

**Fixed on 2026-08-17, first sweep — do not re-report**
Dispatch re-sweep never re-offering a timed-out driver · driver "passenger joined" alert ·
pickup-change notification to the driver · activity list showing "Unknown → Unknown" ·
"trip not found" on a dead booking · the stale "finding your driver" card · tier-coloured
suggestion rings · cover-all duplicate passengers and duplicate rating cards · seat count
silently clamped to the vehicle row · the recentre button doing nothing · the safety page
auto-raising an SOS · admin SOS showing raw coordinates · the tracking sheet clipping its
cards · free-flow ETAs (now floored at `ETA_MAX_AVG_KMH`) · per-seat fares raised ~30% ·
trip-complete showing one seat's fare · the profile checklist not refreshing after an edit ·
light mode.

**Fixed on 2026-08-17, review-triage sweep — do not re-report**
(Full write-up: `docs/superpowers/plans/2026-08-17-reviewer-triage.md`.)
1. `PAYMENTS_SIMULATED=true` with `NODE_ENV=production` now refuses to boot.
2. **`drivers.service#redispatchTrip` was a second dispatch engine** — a raw `geosearch`
   against `drivers:online`, `trip:assigned` pushed to twelve drivers at once, no
   `dispatch:offer:driver:*` key, no offer TTL, no re-sweep, and its own duplicate rider push.
   Four invariants. It now delegates to `cascade.startCascade`.
3. Public `/track/:shortId/data` served the driver's live coordinates, photo and plate
   **forever** after drop-off. Now lifecycle-gated, plus a dedicated `publicShareLimiter`.
4. `Driver.status` normalisation: `utils/driver-status.js` + boot repair sweep.
5. Under-minimum departure: `409 BELOW_MIN_OCCUPANCY` + driver confirm sheet + recorded ack.
6. `tripChannel` now polls `recover()` every 5 s while the socket is down — the spinner trap on
   networks that block WebSockets outright, which no `connect`-triggered path could catch.
7. `driver-link-watch.service.js` — the rider is told when their driver's phone dies mid-trip.
8. `scripts/invariants.test.mjs` wired into `yarn test`.
Plus two incidental finds: the driver app's generic 409 handler would have silently swallowed
fix 5, and `errorHandler` was dropping `err.details`.

**Fixed on 2026-08-17, third pass — do not re-report**
9. **The minimum-occupancy gate counted payments, not passengers.** Fix 5 above read
   `Trip.confirmedSeats`, which only increments when money settles — so a minibus sold out to
   cash-paying riders read 0 and was refused departure. Now counts committed bookings via
   `departureCountedWhere()` (`CONFIRMED`/`PAID`/`BOARDED`), a set deliberately distinct from
   both `confirmedSeats` and `seatOccupyingWhere()`; see `utils/booking-status.js`.
10. **Cancelling a cover-all booking cancelled one seat of N.** The lead booker was left
    holding — and owing for — the other N−1, or charged N separate late fees if the client
    looped. Cancellation and its fee quote now resolve the rider's whole seat set on the trip
    and act on it once: one fee over the total, one refund, one receipt, one counter decrement
    (clamped), and a message that says how many seats went.
11. **Redispatch only ever excluded the most recent cancelling driver.** `startCascade` wipes
    the previous run's state, so on the second redispatch the driver who dropped the trip first
    was a candidate again. Driver cancellations are now recorded as `DispatchAction.action =
    'CANCELLED'` (durable, survives the wipe and a Redis flush) and every one of them is
    excluded. Deliberately asymmetric with `DECLINED`, which stays re-offerable. Side benefit:
    abandoning a trip no longer counts against a driver's decline rate.

---

## Part 8 — Already ruled out (checked against the code; the claim was WRONG)

A previous review round produced these. Each was verified in source and is **not** a defect.
They are listed with their evidence so the next reviewer does not spend a cycle on them.

| Claim | Why it is wrong |
|---|---|
| `IN_PROGRESS → REASSIGNING` strands a rider mid-journey | That edge does not exist. `TRANSITIONS[IN_PROGRESS]` is `{COMPLETED, CANCELLED(sys), EXPIRED(sys)}`. |
| Concurrent booking of the last seat overbooks the vehicle | Booking creation runs in `$transaction(..., { isolationLevel: 'Serializable' })`. Postgres aborts the loser. |
| Cron workers double-dispatch the same scheduled task | `scheduled-task.service.js#claimDue` uses `FOR UPDATE SKIP LOCKED` plus a claim lease. |
| `SIMULATED` wallet credits inflate the revenue dashboard | Revenue reads `Booking.fareAmountPesewas WHERE paymentStatus = PAID`. It never touches `WalletTransaction`. (The *root* risk was real and is closed by the boot guard.) |
| An `OFFER_REVOKED` race lets a driver accept a cancelled ride | `cascade.cancelCascade` calls `forgetOffer` (so the 2 s poll answers `null`), and accept goes through `applyTransition`, which rejects every edge out of a terminal status. |
| `trip:eta` stops arriving after a reconnect | `tripChannel.ts` rejoins on `connect`, detects seq gaps, and replays via `/events?since=`. |
| An out-of-bounds GPS ping evicts a driver from the geo-index permanently | The next in-bounds ping calls `supply.upsertDriver` unconditionally. Recovery is automatic. |
| `fitBounds` on a degenerate bbox SIGABRTs | `packages/maps/src/camera.ts` pads every box to `MIN_SPAN` and refuses to fit an empty one. |
| One passenger's no-show cancels the whole group trip | `riderNoShow` updates the **Booking** (`status: 'NO_SHOW'`, `seatNumber: null`) and never touches `Trip.status`. No code path anywhere transitions a Trip to `NO_SHOW` — the edge is defined in the table but unused. |
| Two drivers accepting one `TripRequest` race each other | `acceptTripRequest` already claims with a conditional `updateMany` (`where: { id, status: { in: ['PENDING','DISPATCHED'] } }`) inside a transaction. That **is** a compare-and-swap; the loser updates 0 rows. |
| Driver marker stays frozen after a reconnect | The `trip:subscribe` reply and `GET /rides/active` both carry `driver.lat/lng` (from `Driver.currentLat/Lng`) and the cached `path`, and `tripChannel` runs `subscribe()` **and** `recover()` on every redial. Position and route line are both rehydrated. |

---

## Part 9 — What to review, and how

Work in this order; the earlier items have caused the most damage historically.

### 9.1 Highest-value: cross-surface consistency
The recurring failure mode in this codebase is **the same fact derived independently in two
places, which then disagree**. Confirmed instances: three definitions of "an active trip"; ten
seat predicates; two fare denominators; two distance measures; an ETA computed one way for the
driver and another for the rider; and — most recently — **two entire dispatch engines**. Look
for:
- Any figure computed on the client that the server also computes
- Any seat/occupancy predicate written inline rather than via `seatOccupyingWhere()`
- Any `?? 0` on money or seats that would render a confident, wrong number
- Any status list hard-coded rather than read from the shared enum/helper
- Any code that selects candidate drivers without going through `driver-availability.js`

### 9.2 Stringly-typed domain values
Only five Prisma enums exist (§5.4). Every other status/tier/type/method is a free `String`
compared to exact literals. Two have already bitten: `ECO` vs `ECONOMY` greyed out every tier
card; `Driver.status` `'APPROVED'` vs `'ACTIVE'` silently removes a driver from dispatch. Audit
the rest: `Vehicle.status`, `Booking.paymentStatus`, `Booking.paymentMethod`, `Trip.tier`,
ticket status, promotion type, notification type, chat message type.

### 9.3 Silent failures
- Empty `catch {}` blocks on paths a user is waiting on
- Socket frames or pushes emitted with no listener on the other end (this has happened at least
  four times: the offer sheet, passenger-joined, pickup-changed, and — nearly — the new
  `DRIVER_LINK_LOST`)
- Endpoints that return 200 with no side effect
- Fallbacks that fabricate data rather than admitting "unknown"
- Generic error handlers that absorb a specific error's meaning (§ invariant 28)

### 9.4 Lifecycle and race conditions
- Every path into a terminal `TripStatus` — is there one that can strand a rider on a spinner?
- Concurrent claim on one trip
- What happens when the driver app is suspended for longer than the 90 s presence TTL, in each
  of `DRIVER_ASSIGNED`, `DRIVER_EN_ROUTE`, `ARRIVED_AT_PICKUP` and `IN_PROGRESS`
- Cancellation and refund correctness, in every combination of paid/unpaid and
  cash/wallet/card
- Redispatch: is anything (a receipt, a chat thread, a rating, a Live Activity, the *previous
  driver's client state*) orphaned when a trip is reassigned?
- `MAX_REDISPATCH` exhaustion: a "poison pill" trip (bad pin, unreachable rider) is currently
  offered to driver after driver with nothing learning from the pattern

### 9.5 Money
- Can any balance go negative? Can any commission be charged twice?
- Idempotency on every mutating money endpoint
- Do the rider's receipt, the driver's receipt and the admin revenue figure agree for the same
  trip — including cash, and including a cover-all group?
- Cancellation fees on a cover-all booking: the fee endpoint takes **one** `bookingId`, but a
  cover-all rider owns N rows. Is the fee charged once or N times?

### 9.6 Security & privacy
- Can a rider read another rider's booking, trip, chat or receipt?
- Can a driver read a trip they are not on?
- The public share/join endpoints: `shortId` is a full `cuid()` (~41 bits of randomness plus a
  timestamp prefix) and `RideGroup.shareToken` is 96 bits. Both are now rate-limited and the
  tracking one is lifecycle-gated. Is anything else reachable without a token?
- Is the Mapbox secret genuinely absent from both app bundles?
- Does admin RBAC actually enforce the read-only roles, on the **server**, not just in the nav?

### 9.7 Missing features to consider
Compare this inventory against what Uber, Bolt, inDrive and Yango ship in this market, and flag
anything absent that a Ghanaian rider or driver would expect — with an honest note on whether
the gap is a real product hole or a deliberate scope decision listed in Part 7.

---

## Part 10 — Open questions for the reviewer

**Still open:**

1. **Is the sequential dispatch cascade right at low supply density?** With one driver online,
   a 45 s offer window and a 300 s search, a rider can wait five minutes on a single driver who
   never looks at their phone. The proposed answer is a hybrid: stay sequential for the first
   full sweep (this protects match quality and earnings fairness), then broadcast to all
   eligible drivers if that sweep exhausts with no acceptance — the per-trip Redis lock already
   solves the "two drivers accept at once" race that broadcast introduces. **Not built.**
2. **Cover-all creates N `Booking` rows for one person.** Every "one card per seat" bug traces
   back to this. One row with a `seatCount` is architecturally cleaner, but seat maps,
   per-seat boarding PINs and per-seat ratings all hang off the booking row, so it is a real
   migration. Should it be done, or should `getTripFareForRider` and the seat-predicate helpers
   be made the only legal way to touch bookings, enforced by a test?
3. **Should the shared `TripStatus` be a discriminated union keyed on product type?** An
   on-demand trip can in principle be pushed into `FILLING`; a group trip can be pushed into
   `MATCHING`. Neither is meaningful. `assertTransition` currently guards from→to and actor,
   but not product.
4. **Poison-pill redispatch.** A trip that keeps being cancelled for a rider-side reason is fed
   to `MAX_REDISPATCH` drivers in turn, damaging each one's acceptance rate. Should repeated
   cancellation on one trip escalate to ops instead of continuing to redispatch?
5. **The 264 remaining `react-native` `Pressable` imports.** Migrate wholesale, or leave and
   rely on the function-style guard?

**Answered since the last revision — do not re-ask:**

- *What happens if a driver departs a group trip with one passenger?* They used to absorb the
  entire shortfall silently. The server now refuses once with `409 BELOW_MIN_OCCUPANCY` and
  requires an explicit acknowledgement, recorded on the `TripEvent`.
- *What values exist in `Driver.status`?* Canonically five (§3.1). Anything else is normalised
  at the write edge and repaired at boot; unmappable rows raise an ops alarm rather than being
  guessed at.
- *Can a `SIMULATED` credit be mistaken for revenue?* Not through the revenue query, which
  reads `Booking`. The underlying risk — simulated money existing on a production host — is now
  refused at boot.
