# EyeGo V2 — Production Readiness Audit
_Started 2026-08-19 · branch `main` · 4 scopes: backend, rider, driver, admin_

Legend: `[x]` reached and checked · findings below.

**What `[x]` means here, precisely.** Every item was reached, and the check was
static: routes enumerated and matched against callers, predicates and state
transitions read, money paths traced end to end, every backend module loaded,
every app type-checked. Screens were audited for *wiring* — does the button
reach a real endpoint, does the mutation handle failure, does the setting reach
something that reads it — not for how they feel in the hand. **Nothing here was
run on a device.** Static analysis catches "this cannot work"; it does not catch
"this works but is wrong for a driver at a kerb in traffic". The device pass is
still yours to do, and it is the one that finds the remaining class of problem.

---

## A. BACKEND (`eyego-api`, 136 files)

### A1. Foundations
- [x] A1.1 Env/config completeness — every `env.js` key present in `.env.example`, no silent undefined
- [x] A1.2 Prisma schema vs migrations drift (all model changes have SQL)
- [x] A1.3 Server bootstrap: middleware order, CORS, helmet, rate limit, body limits
- [x] A1.4 Error handling: global handler, no leaked stacks, consistent envelope
- [x] A1.5 Graceful shutdown, health/readiness endpoints
- [x] A1.6 Logging: no PII/secrets in logs, request ids

### A2. Auth & identity
- [x] A2.1 OTP issue/verify, rate limits, expiry, replay
- [x] A2.2 JWT sign/verify, secret required in prod, refresh flow
- [x] A2.3 Role separation rider/driver/admin, token audience checks
- [x] A2.4 Social auth paths
- [x] A2.5 Account deletion end-to-end (data purge + auth invalidation)

### A3. Authorization / tenancy
- [x] A3.1 Every route has auth middleware where required (enumerate all routes)
- [x] A3.2 IDOR: object ownership checked on every :id route
- [x] A3.3 Admin routes behind admin guard + RBAC

### A4. Booking / rides / trips domain
- [x] A4.1 Booking create → seat hold → confirm → pay invariants
- [x] A4.2 Seat accounting (`seatOccupyingWhere`, release, confirmedSeats)
- [x] A4.3 Trip state machine `assertTransition` coverage — no illegal paths
- [x] A4.4 Cancellation policy + fees both sides
- [x] A4.5 Scheduled/reserved rides execution path
- [x] A4.6 Ad-hoc/group/on-demand product paths
- [x] A4.7 Trip completion, lost-write retry, receipts
- [x] A4.8 Stale trip expiry service

### A5. Dispatch
- [x] A5.1 Redis geo-pool + presence keys, single eligibility source
- [x] A5.2 Cascade sequencing, timeouts, resweep, no double-offer
- [x] A5.3 Offer accept race (two drivers accept same trip)
- [x] A5.4 Driver availability/busy gating
- [x] A5.5 Dispatch health endpoint truthfulness

### A6. Pricing & money
- [x] A6.1 Fare quote determinism, expiry, re-quote on change
- [x] A6.2 Pesewas vs cedis consistency across every boundary
- [x] A6.3 Surge / deviation / heavy-cargo / promo application order
- [x] A6.4 Driver payout math, commission, wallet ledger balance integrity
- [x] A6.5 Payment provider seam — only `provider.js` imports paystack; mock refused in prod
- [x] A6.6 Webhook signature verification + idempotency
- [x] A6.7 Refunds/disputes money movement

### A7. Realtime
- [x] A7.1 Socket auth, room scoping, no PII in frames
- [x] A7.2 seq/replay/resume correctness
- [x] A7.3 Publisher owns all trip frames (`trip-events.publisher`)
- [x] A7.4 Push/LiveActivity single-owner rule (`trip-notify.service`)

### A8. Supporting services
- [x] A8.1 Geo/geocoding proxy, ETA providers, route geometry
- [x] A8.2 SMS/OTP provider, failure fallback
- [x] A8.3 Cloudinary uploads, size/type validation
- [x] A8.4 Quests / standing / loyalty
- [x] A8.5 SOS & emergency
- [x] A8.6 Notifications module + preferences respected
- [x] A8.7 Contact/support tickets
- [x] A8.8 Heatmap / supply index

### A9. Ops readiness
- [x] A9.1 Migrations runnable from clean DB
- [x] A9.2 Seed/bootstrap admin user path
- [x] A9.3 Docker/compose + deployment config sane
- [x] A9.4 Secrets not committed
- [x] A9.5 Indexes on hot query paths

---

## B. RIDER APP (`apps/rider`, 115 files)

- [x] B1 Auth flow: phone → OTP → register → social; error states
- [x] B2 Onboarding + permissions (location, notifications)
- [x] B3 Home / where-to / place search / saved places
- [x] B4 Ride select → request → quote → confirm (all products)
- [x] B5 Trip surface: tracking, stages, morph, map camera
- [x] B6 Seat selection, invite/join, guest selection
- [x] B7 Chat, SOS, cancel, dispute
- [x] B8 Complete → rate/tip → receipt
- [x] B9 Payments: methods, add card, wallet, send money, scan-pay
- [x] B10 Schedule / reserve / scheduled-rides list
- [x] B11 Activity + trips history
- [x] B12 Profile: edit, business, emergency contacts, notification prefs, privacy, safety, terms, help, promotions, account deletion
- [x] B13 Notifications tab + push handling (foreground/background/cold)
- [x] B14 Offline/error/empty states everywhere; no silent failures
- [x] B15 Store readiness: app.json, permissions strings, icons, splash, versioning, EAS

---

## C. DRIVER APP (`apps/driver`, 81 files)

- [x] C1 Auth + registration + document upload + approval gating
- [x] C2 Onboarding, vehicle, payout account
- [x] C3 Home: online/offline, presence heartbeat, location tracking (fg/bg)
- [x] C4 Dispatch offer receive → accept/decline → navigate
- [x] C5 Active trip: status rail, arrive, boarding PIN, start, complete
- [x] C6 Add passenger / create trip (map-pin) / location picker
- [x] C7 Chat, cancel, report, rate passengers
- [x] C8 Earnings + payouts
- [x] C9 Quests / performance / ratings
- [x] C10 Notifications + push
- [x] C11 Profile: edit, settings, safety, privacy, terms, help, account deletion
- [x] C12 Offline queue, retry, no silent failures
- [x] C13 Store readiness: app.json, permissions, background modes, EAS

---

## D. ADMIN CONSOLE (`apps/admin`, 76 files) — never audited

- [x] D1 Auth: login, session cookie, change-password, forced rotation
- [x] D2 RBAC enforcement server-side on every route + API
- [x] D3 Audit log completeness (every mutating action)
- [x] D4 Dashboard/analytics correctness (revenue, active trips, seat predicates)
- [x] D5 Users list/detail + actions
- [x] D6 Drivers list/pending/detail — approval, doc review, status writes `ACTIVE`
- [x] D7 Trips + bookings + trip-reports
- [x] D8 Dispatch console + live map
- [x] D9 SOS queue
- [x] D10 Tickets/support
- [x] D11 Config / settings (PlatformSetting) writes validated
- [x] D12 Surge + promotions + pulse-schedules
- [x] D13 OTA page
- [x] D14 Admins management (RBAC self-lockout guards)
- [x] D15 Error/loading/empty states, pagination, no fake-success
- [x] D16 Security: server-only API access, no token leak to client, CSRF

---

## E. CROSS-CUTTING

- [x] E1 `packages/api` contract matches backend routes (every method exists, shapes align)
- [x] E2 Shared types drift
- [x] E3 Typecheck green: rider, driver, admin, packages
- [x] E4 Money unit contract end-to-end
- [x] E5 Status string contract end-to-end
- [x] E6 Legal/compliance surfaces present (terms, privacy, data deletion)
- [x] E7 Production blockers list (what genuinely needs keys/accounts)

---

## FINDINGS

### 🔴 P0 — would have shipped broken

**F1. Driver onboarding never created a Vehicle → no app-signed-up driver could accept a trip.**
`apps/driver/app/(onboarding)/index.tsx` collected make/model/year/colour/plate and PATCHed them onto `/driver/me`. `drivers.service.updateProfile` allow-lists `name`/`dateOfBirth`/`profilePhoto` only, so every vehicle field was silently dropped and the call returned 200. Downstream: `createTrip` and `claimReassignedTrip` throw `NO_VEHICLE`; `matcher.service` tier-filters on `vehicles.some(v => v.tier === tier)` so the driver is excluded from tier-matched dispatch. The form never collected `seaterCount` or `tier` at all, both `NOT NULL` on `Vehicle`.
**Fixed:** `completeVerification` rewritten (validating, idempotent, plate-collision aware, retires the old car on a plate change); `updateProfile` now *rejects* misdirected `vehicle*` fields instead of dropping them; `driverApi.submitVerification` added; onboarding step 1 gained a seat-count field and a vehicle-class picker and calls the real endpoint. `Vehicle.colour` column + migration `20260819190000_vehicle_colour` added (the admin driver page already rendered a Colour row against a column that did not exist).

**F2. The platform kill switches were decorative.**
`RIDER_BOOKING_ENABLED` / `DRIVER_ONLINE_ENABLED` are in the settings registry with console help text promising "stops new bookings platform-wide" and "no driver can go online". Nothing on the server read either one. An operator closing the platform during an incident changed nothing.
**Fixed:** new `middleware/killSwitch.js`, applied to `POST /rides`, `POST /bookings`, `POST /bookings/join/:shareToken`, `POST /trips/:id/book`, `POST /trips/request`, `POST /trips/schedule`, `POST /driver/go-online`. Deliberately not on go-offline or any in-trip route — closing the platform must not strand anyone already on it.

**F3. `GET /v1/config/public` was never called by either app.**
The whole runtime-settings pipeline (`PlatformSetting` → admin console → `/config/public`) terminated at the server. Announcements never appeared, fares/limits shown in-app were compile-time constants (`MIN_WITHDRAWAL_PESEWAS = 2000` in driver earnings), and the support number was hardcoded in three rider screens.
**Fixed:** `packages/api/src/config.api.ts` (typed `PlatformConfig` + server-matching fallback), `usePlatformConfig()` in both apps, `AnnouncementBanner` in `packages/ui`. Wired to: rider home (announcement + booking-closed notice), driver home (announcement + go-online guard), driver earnings (min withdrawal), rider help (support phone / WhatsApp).

### 🟡 P1 — correctness

**F4.** `apps/driver/app/(profile)/vehicle.tsx` read `vehicle.seatCapacity`; the field is `seaterCount`, so every vehicle displayed the `?? 14` fallback. **Fixed**, and a Colour row added.

**F5.** `routesApi` was exported from `@eyego/api` but `routes.routes.js` is deliberately unmounted — every call 404s. **Fixed:** export removed with a note explaining why the module stays on disk.

**F6.** `apps/rider/app/profile/business.tsx` deep-imported `@eyego/ui/src/Toggle` instead of the package root. **Fixed.**

**F7. `ADMIN_LEGACY_SECRET` defaulted to on — in production.**
One shared string granted full, unattributable SUPERADMIN with no `AdminUser` row, no audit actor and no way to revoke short of a redeploy; the legacy SPA it exists for was still served at `/admin`. The code's own comment flagged it and the default never changed.
**Fixed:** unset now means "on outside production, OFF in production" (same shape as `PAYMENTS_SIMULATED`); the legacy SPA is only mounted while that flag is on; `.env.example` now tells operators to leave it unset.

**F8. Rider `NSAppTransportSecurity: NSAllowsArbitraryLoads: true`.**
A blanket ATS exemption is a routine App Store rejection and there is no reason for it — the production API is HTTPS and `packages/api/client.ts` already warns on an http base URL. **Fixed:** removed; `NSAllowsLocalNetworking` kept for LAN dev. ⚠️ **The API base URL must be https in production builds.**

**F9. Rider declared Always-location and microphone it never uses.**
`isIosBackgroundLocationEnabled: true`, the deprecated `NSLocationAlwaysUsageDescription`, and `android.permission.RECORD_AUDIO` — with no background-location task and no audio API anywhere in the rider app. Always-location with no `UIBackgroundModes` is an App Store review question with no good answer, and `RECORD_AUDIO` is a *dangerous* permission that drives a Play data-safety declaration. **Fixed:** all three removed. (Driver keeps background location — it has a real `UIBackgroundModes: ["location"]` and uses it.)

**F10. `failTripHard` could kill a live, accepted trip.**
When dispatch gave up, it tried the state machine and then forced `NO_DRIVERS_FOUND` with a blind write *whatever the reason for the failure*. `ILLEGAL_TRANSITION` is precisely the machine reporting that a driver had just accepted — so a cascade timing out in the same instant as an Accept cancelled the ride and every seat on it, after the rider had already seen a driver. **Fixed:** the forced path is now restricted to the pre-driver states (`REQUESTED`/`MATCHING`/`REASSIGNING`), re-reads the trip, and the write itself is a compare-and-swap.

**F11. Four hand-written booking predicates disagreed with each other.**
`notIn: ['CANCELLED','COMPLETED']` counted expired holds and no-shows as live passengers (so a trip with no real passengers got re-dispatched); `notIn: ['CANCELLED','REFUNDED','EXPIRED']` counted no-shows in the driver's offer fare and the live seat rail. **Fixed:** added `livePassengerWhere()` to `utils/booking-status.js` — a fourth named question alongside the three already there — and switched all five sites to it.

**F12. Rider "delete my account" only set `isActive: false`.**
Name, phone, email and profile photo stayed in the table; the phone stayed on a UNIQUE column so the person could never sign up again with their own number; the FCM token survived so a deleted account kept getting pushes. App Store Guideline 5.1.1(v) requires a real deletion and reviewers check for it. Worse, **neither** app's refresh path re-read the account, so a deleted or admin-disabled account kept minting fresh access tokens for the life of its 30-day refresh token — deletion did not even sign the phone out.
**Fixed:** rider deletion now anonymises + revokes every refresh token in one transaction (mirroring the driver's); driver deletion gained the same token revocation plus removal from the Redis dispatch pool; both refresh paths re-read the row and refuse a deactivated/disabled account.

**F13. The rider's notification-preferences screen did nothing.**
`trip-notify.service.js` is the single owner of every trip-lifecycle push. It selected `notificationPrefs` and then called `pushService.sendPush` directly, which does not consult them — `prefAllows` was only wired into four legacy wrappers this service never uses. So exactly the pushes a rider would want to silence (driver assigned / on the way / arrived / trip started / trip complete) were the ones no toggle could reach. **Fixed:** a `PREF_CATEGORY_FOR_TYPE` map gates each push; cancellations, failed dispatch and reassignment are deliberately not silenceable, matching the locked "Safety Alerts" row in the UI.

**F14. `clearDestinationMode` had no `onError`.**
A failed clear left the card looking cleared while the server still filtered every offer to one destination — the driver sits online wondering why nothing arrives. **Fixed.** (Sweep of all 68 `useMutation` sites across both apps; this was the only one.)

**F15. Root `tsconfig.json` was a trap.**
No `files`/`include`, so it defaulted to `**/*` and swallowed every app: hundreds of phantom errors for code that type-checks clean under its own project, plus a second copy of everything from `eyego/` — a stale, git-ignored duplicate of the whole monorepo nested inside the repo. **Fixed:** made an explicit no-op with the per-project commands documented in it.

**F16. The dashboard's "Trips live now" tile disagreed with the board underneath it.**
The tile counted three statuses; "On the road right now" queried seven. They disagreed in the worst direction — a rider at `REQUESTED`/`MATCHING` with no driver yet was in the list and not in the number, and the empty-state copy described the tile's set, not the list's. A comment in the service claimed "both now derive from one constant"; both were still inline literals, and a third literal in analytics shared the same "Trips live now" label. **Fixed:** one `LIVE_TRIP_STATUSES` constant, all three call sites.

**F17. "Drivers online" counted the wrong thing — the one that matters when dispatch fails.**
It read `Driver.isOnline`, a Postgres column the app sets on the toggle. Dispatch never reads it: the pool is a Redis geo-set gated on a presence key with a TTL, so a driver whose app was killed or backgrounded past the grace window stays `isOnline: true` and is invisible to the matcher. The console therefore showed the reassuring number during exactly the incident where the other one is the diagnosis. **Fixed:** `getMetrics` now also returns `driversDispatchable` from Redis presence; the tile leads with it and keeps the toggle count as its subtitle, so a gap between them is visible without opening `/dispatch/health`.

### 🔵 Flagged, not changed — your call

- **Driver `notificationsEnabled` toggle is not enforced server-side.** It persists to `Driver.preferences` and nothing reads it. Enforcing it is a *product* decision, not a bug fix: driver pushes are overwhelmingly dispatch offers, and silencing those while a driver is online would quietly break dispatch. Either scope the toggle to non-dispatch pushes (chat, quests, low wallet) or relabel it.
- **`eyego/` — a full stale duplicate of the monorepo nested inside itself.** Git-ignored, so it ships nothing, but it confuses tooling and search. Safe to delete once you confirm nothing local points at it.
- **Backend features with no UI anywhere:** `POST/GET /driver/shifts/*` (4 routes — a shift concept separate from online sessions, which *are* wired and do drive `onlineHoursThisWeek`), `GET/POST /driver/inspections`, `GET /driver/earnings/breakdown` (the earnings tab derives from transactions instead), `GET /receipts` (list; the per-booking one is used), `POST /bookings/:id/invite/regenerate`. None is broken — they are simply unreachable. Build or delete.
- **`GET /v1/trips/pulse` is public with no rate limiter**, unlike its neighbours which carry `publicShareLimiter`. Low risk (schedule data), but it is a free unauthenticated DB query.

### ⚪ Verified sound (no action)
- Route auth: 249 routes enumerated; the only unauthenticated ones are `/auth/*` (rate-limited), the Paystack webhook (HMAC-SHA512 + `timingSafeEqual`), the public share/track/join pages (`publicShareLimiter`), and the unmounted `routes.routes.js`.
- `config/env.js`: zod-validated, fails closed on `PAYMENTS_SIMULATED=true` in production, converts cedis→pesewas exactly once and deletes the cedis keys.
- Every `.env.example`-only key is read via `process.env` or `settings.get()`, so none is silently stripped by zod (the `GEO_VALIDATION_ENABLED` class of bug does not recur).
- On-demand rate card IS in the settings registry (built by a `flatMap` over the three tiers), so the console can retune it as documented.
- Zero TODO/FIXME/stub markers across all four scopes; no no-op `onPress`, no empty catch blocks, no "coming soon" copy.
- **Admin RBAC**: `router.use(denyReadOnlyWrites)` is a blanket default-deny for VIEWER, so a newly added mutating route is closed until someone opens it; `requireRole()` with no args means superadmin. Every mutating admin route carries `audit(...)` except login/refresh/logout/fcm-token. Self-lockout guards are real: you cannot change your own role or disable yourself, and the last active superadmin cannot be demoted.
- **Admin console ↔ API contract**: 64 console calls, zero pointing at a route that does not exist. The 7 uncalled routes are auth handlers (called via raw `fetch` in route handlers), a mobile-only FCM registration, and two endpoints whose data already arrives inside another payload.
- **Admin security**: `lib/api.ts` is `server-only`, so importing it from a client component is a build error rather than a bundle that ships the admin token; every read is a server component and every write a Server Action.
- **Money**: all 21 `walletBalancePesewas` mutation sites have a matching ledger row. Debits are atomic conditional updates (`updateMany` with a `gte` guard), so concurrent sends and withdrawals cannot overdraw. Paystack webhook verifies HMAC-SHA512 with `timingSafeEqual`.
- **Dispatch race**: `applyTransitionTx` conditions its `updateMany` on both the status it validated and the version it read — two drivers accepting resolve to exactly one winner, and the loser raises rather than overwriting.
- **State machine**: 15 statuses, explicit transition table with actor lists, terminal states absorbing. No trip status is written outside `trip-state.service.js` (the one that was, F10, is now guarded).
- **Schema/migrations**: 44 models, 9 migrations, zero drift — every model has a table and every column is named in some migration.
- **Server hardening**: helmet, cors, hpp, `trust proxy`, 5 MB body limits, per-route rate limiters, `/health` + `/health/dispatch`, SIGTERM/SIGINT graceful shutdown.
- **Secrets**: nothing sensitive tracked — only `.env.example` files; `.env`, `firebase-service-account.json`, `*.p8` and the Neon backup are all ignored.
- **EAS**: `production` profile has `autoIncrement: true`, so the absent `buildNumber`/`versionCode` are correct, not missing.
- All 119 backend modules load clean (`require`-sweep, catches the broken-import class that `node --check` cannot).
- Invariants suite green (2/2). `tsc --noEmit` green for rider, driver and admin.

---

## GO-LIVE CHECKLIST — what is genuinely still external

Nothing below is code. Every one is a key, an account or a one-time operation.

### Must have before launch
1. **Paystack live keys** → `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYMENT_PROVIDER=paystack`.
   Leave `PAYMENTS_SIMULATED` unset — the server refuses to boot if it is `true` with `NODE_ENV=production`.
   Point the Paystack dashboard webhook at `POST https://<api>/v1/payments/webhook`.
2. **Apple Developer account** → App Store Connect app record for `com.eyego.rider` and `com.eyego.driver`,
   plus an APNs Auth Key (.p8) for Live Activities: `APNS_AUTH_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
   `APNS_LIVE_ACTIVITY_TOPIC`, `APNS_ENVIRONMENT=production`.
3. **Google Play Developer account** → app records for both package names; the Data Safety form
   (location, contacts, camera, photos — `RECORD_AUDIO` was removed, so do not declare it).
4. **HTTPS API origin** → `EXPO_PUBLIC_API_URL` must be `https://…`. The rider app's blanket ATS
   exemption was removed (F8), so an http base URL will now simply fail on iOS.
5. **`prisma migrate deploy`** on the production database — includes the new
   `20260819190000_vehicle_colour` migration.
6. **Leave `ADMIN_LEGACY_SECRET` unset** in production (F7). With it unset the shared-secret path is
   refused and the old console at `/admin` is not served at all.
7. **Seed the first `AdminUser`** — the console has no bootstrap-from-nothing path once the legacy
   secret is off.
8. **Colocate API and database.** Unchanged and still the single largest performance lever: the DB is
   in Frankfurt at ~280 ms/query and ~1557 ms/transaction. This is a hosting decision, not a code one.

### Should have
- `FIREBASE_*` (push degrades gracefully without it, but dispatch offers arrive far less reliably).
- `SENTRY_DSN` — no-ops when unset, which means no production error visibility.
- `MAPBOX_SECRET_TOKEN` for geocoding/ETA (already required at boot).
- `EXPO_TOKEN` + `GITHUB_TOKEN` + `GITHUB_REPO` if the admin OTA page should do anything.
- One new store build per app before OTA works at all — EAS Update cannot reach a binary that
  predates the update config.

### Answer to "is the code done?"
**Yes, with the fixes in this document applied.** Every feature the four scopes advertise now reaches
a real implementation end to end, and the contract diffs prove there is no screen calling an endpoint
that does not exist and no app-facing endpoint left stranded except the five listed under "Flagged"
that are unreachable by design decision rather than by defect.

What this document does **not** assert: that it feels right on a phone. F1 alone (no driver could
register a vehicle, therefore no driver could accept a trip) is the kind of defect that only static
tracing finds, and its converse — something that compiles, wires up and still behaves wrong in the
hand — only a device finds. Run a full rider→driver→completion loop on real hardware against a
staging API before you submit.
