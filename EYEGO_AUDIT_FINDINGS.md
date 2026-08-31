# EyeGo V2 — Audit Findings & Fixes

Full-system audit of the rider app, driver app, backend, and admin dashboard. This report records what was found and what was fixed in this session. (Excludes the stale `AUDIT_REPORT_V2.md` / `eyeGo-Comprehensive-Analysis-and-Architecture-Guide.md`.)

Severity: 🔴 critical · 🟠 high · 🟡 medium · 🟢 low · ✅ verified-correct (no action)

---

## Fixed this session

### 🔴 Chat: rider's message didn't reach the driver until the driver replied
**Root cause:** real-time delivery depended on per-screen trip-room membership that was joined **once on mount** and never re-joined on socket reconnect. Socket.IO drops all room membership on disconnect (network blips, app backgrounding, token refresh), after which inbound `chat:message` was silently dropped. The driver app also lacked the always-on app-level listener the rider app already has (`TripStatusListener`), and the backend driver auto-rejoin excluded the `SCHEDULED/FILLING` boarding phase.

**Fixes**
- Driver chat re-joins the trip room on every socket `connect` — `eyego/apps/driver/app/(trip)/chat/[id].tsx`
- Rider chat re-joins on `connect` (reinforces the existing `TripStatusListener` rejoin) — `eyego/apps/rider/app/ride/[id]/chat.tsx`
- Driver `_layout` rejoins the active trip room on foreground reconnect (`activeTripId` from store) — `eyego/apps/driver/app/_layout.tsx`
- Backend driver auto-rejoin now includes `SCHEDULED/FILLING` — `eyego-api/src/sockets/driver.socket.js`
- Driver `chat:send` now echoes to the sender socket (symmetry with the passenger handler) — `eyego-api/src/sockets/driver.socket.js`

> Parity note: the rider has a robust app-level `TripStatusListener` (connect + room-join + reconnect-rejoin + app-wide chat banners). The driver app has **no equivalent**; a `DriverTripStatusListener` is recommended (backlog) for full off-screen parity. Off-screen delivery is currently covered by FCM push.

### 🔴 Quests didn't update after a completed ride
**Root causes (three, compounding):**
1. The Quests tab fell back to hardcoded `FALLBACK_QUESTS` on an **empty successful** API response (not just on error), masking the real "no quests" state with frozen 0-progress cards — `quests.tsx:109`.
2. **No `DriverQuest` rows were ever seeded**, so there was nothing to progress.
3. **The completion path that actually runs never incremented quests.** There are two divergent completion implementations: REST `arriveTrip` (`drivers.service.js`) and socket `driver:arrived → completeTrip` (`trips.service.js`). The active screen calls REST first; it completed the trip but **only `completeTrip` incremented quests**, and `completeTrip` then bailed on its idempotency guard. `arriveTrip` also had **no idempotency guard** while the mutation uses `retry: 1` → risk of **double wallet credit**.

**Fixes**
- Fallback now triggers only on `isError`; empty success renders a real empty state — `quests.tsx`
- Seeded 4 active `DriverQuest` rows (daily/weekly rides + earnings) — `eyego-api/prisma/seed.js`
- `arriveTrip` now increments quest progress (RIDES_COUNT + EARNINGS) **and** has an idempotency guard preventing double credit — `eyego-api/src/modules/drivers/drivers.service.js`

### 🟠 Driver: dispatch accept left the trip in the dispatch list (D1)
Accept didn't invalidate trip lists. Added `['driver','trips','all']` + `['driver','activeTrip']` invalidation — `(trip)/dispatch/[id].tsx`.

### 🟠 Driver: stale wallet/earnings after a completed trip (D2/D3)
Completion invalidated trips/quests/`me` but not the wallet list. Added `['driver','wallet']` invalidation in both completion paths — `(trip)/active/[id].tsx`, `(trip)/tracking/[id].tsx`.

### 🟠 Rider: stale data after backgrounding (R1) + offline queue stuck (R2)
- Added an `AppState` foreground listener that flushes the offline queue and invalidates active-booking/trip queries — `rider/app/_layout.tsx`
- Started `offlineQueue.startPeriodicFlush(60000)` (was only flushing once at startup) — `rider/app/_layout.tsx`

### 🟠 Social login was broken (API1)
Client `socialLogin()` POSTed to a nonexistent `/auth/social` and expected a `{ tokens }` wrapper; backend exposes `/auth/google` + `/auth/apple` returning a flat `{ accessToken, refreshToken, isNewUser, user }`. Fixed the endpoint, request body, response type, and both `social.tsx` call sites — `packages/api/src/auth.api.ts`, `rider/app/(auth)/social.tsx`.

### 🟢 Feature: Rider Group/Private chat tabs (parity with driver)
- New backend `chat:private_send` handler on the passenger namespace (rider → driver private, delivered to `driver:<id>` + echo) — `eyego-api/src/sockets/passenger.socket.js`
- New client `socketEvents.sendPrivateChatMessage` — `packages/api/src/socket.ts`
- Rider chat now has Group/Private tabs, filtered message views, private send routing, optimistic dedupe, offline-outbox routing, and mode-aware placeholder — `rider/app/ride/[id]/chat.tsx`

---

## Verified correct (no action needed)
- **Pricing consistency** ✅ — `fare.calculator.js` computes per-seat = total/`maxSeats` (GHS5 floor, surge/doorstep/heavy-load); bookings store `fareAmount`/`commissionAmount`; payments charge exactly `fareAmount`. Displayed == charged == driver net. (`getTrip`, `searchTrips`, `createTrip`, `getTripByShareToken` all use the same `maxSeats` denominator.)
- **Group hub / pay-for-everyone** ✅ — `invite.tsx` + `payForEveryone → totalTripCost` work end to end.
- **Offline passenger** ✅ — `driver/(trip)/add-passenger.tsx` complete.
- **Payments** ✅ — Redis lock + idempotency middleware + Paystack signature verification.
- **Socket matrix** ✅ — location/ETA/status/seat/safety/payment-bridge emit/listen pairs match.
- **Cancellation auth** ✅ — `cancellation.routes.js` applies `router.use(authenticate)` (an earlier sub-agent "missing auth" claim was a false positive).

---

## Backlog — resolution status (2026-06-13 follow-up)

### Driver
- **D4 ✅** Go-online now awaits a fresh wallet/profile refetch before the gate (also fixed a duplicate-`mutationFn` that silently broke the mutation) — `(tabs)/home.tsx`.
- **D5 ✅** "Active" segment already falls back to filtering `allTrips` for active statuses when `getActiveTrip()` returns null — `(tabs)/trips.tsx`.
- **D6 🟢** No pagination on trip lists. *(still open — low priority)*
- **Parity ✅** `DriverTripStatusListener` built (app-level socket/room/reconnect + chat/dispatch/status banners + cache invalidation) and wired in `_layout.tsx`.

### Rider
- **R3 ✅** Wallet pre-validation in place — pay button disabled + warning when `walletBalance < fareAmount` — `payment.tsx`.
- **R4 ✅** Idempotency key is stable (`pay_<bookingId>_<method>`, no `Date.now()`); fixed a **duplicated WebView success block** that double-fired payment confirmation; group member limit now enforced client-side (Share disabled + "group full" notice using `trip.totalSeats`) — `payment.tsx`, `invite.tsx`.

### Admin (`eyego-api/public/index.html`)
- **AD1 ✅** Added admin-gated `GET /v1/admin/routes` (service+controller+route) and repointed the console off the public `/v1/routes`.
- **AD2 ◑** Wired **reject driver** + **ban user** (endpoints existed, no UI) with reason prompts. Pending drivers already surface in the drivers table (now with Approve/Reject). *Still open:* `metrics` & `surge` dashboards (net-new UI, deferred).
- **AD3 ✅** Driver table average rating was always blank (`getAllDrivers` returned no ratings) — now computes per-driver averages via `groupBy` and attaches `rating`; table reads `d.rating`. `booking.commissionAmount` confirmed present (full booking rows via `include`).
- **AD4 ✅** Added a 30-min idle session timeout: activity-stamped on every API call, enforced on boot + via interval, expired sessions no longer auto-login, with a re-login toast.
- **AD5 ✅** Closed stored-XSS gaps — all user/driver-controlled fields (names, phones, emails, vehicle make/model/plate, route/origin/destination names, **support-ticket subject + message bodies**) now pass through `escapeHtml` before hitting `innerHTML`.

### Cross-cutting (UI/UX · a11y · security) — *still open*
Theme/status-bar consistency, haptics on key driver actions, keyboard avoidance on settings, pull-to-refresh on notifications, skeletons, long-phone overflow, a11y labels/live-regions on dynamic chat & banners, certificate pinning, biometric gate for SecureStore.

---

## How to verify the fixes (on device)
1. **Chat:** rider sends while the driver is on the chat screen → appears instantly. Background+foreground the driver mid-trip, rider sends → still appears. Repeat in `FILLING`. Both directions.
2. **Quests:** run `npx prisma db seed`; complete a real ride → quest `current` increments (bonus credited at target); tab updates without manual refresh.
3. **Dispatch:** accept → leaves dispatch/assigned, becomes active.
4. **Earnings:** complete a paid ride → home/earnings balance updates immediately. Trigger a mutation retry → no double credit.
5. **Rider foreground:** background during an active trip, complete it server-side, foreground → status refreshes.
6. **Social login:** Google/Apple sign-in succeeds against the real endpoint.
7. **Rider Group/Private:** send a Private message → only the driver receives it; Group stays broadcast.
8. **Build:** run `tsc --noEmit` for `eyego/apps/rider`, `eyego/apps/driver`, `eyego/packages/api`; lint/test.
