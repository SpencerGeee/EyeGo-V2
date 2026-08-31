# EyeGo V2 — Full Monorepo Audit (Rider + Driver + Backend + Packages)

Date: 2026-07-12. Scope: `apps/rider`, `apps/driver`, `eyego-api`, `packages/*`.
Excluded (stale dupes): `eyego/`, `.claude/worktrees/`.
Every finding verified against actual source. False positives removed (noted at end).

Severity: **CRITICAL** = money/data-loss/crash on normal path · **HIGH** = broken feature · **MEDIUM** = edge case · **LOW** = polish/visual.

---

## BACKEND (eyego-api)

### CRITICAL
- **B-C1 — `searchTrips` crashes on every geo search.** `trips.service.js:329` declares `const [totalCount, trips]`, then `:355` reassigns `trips = trips.filter(...)`. `TypeError: Assignment to constant`. Fires whenever origin/dest coords passed (the normal "find ride near me" path). Fix: `let`.
- **B-C2 — Cash rides double-pay the driver.** Cash commission is debited from driver wallet at boarding (`drivers.service.js:706`, `:746`). Then `arriveTrip:502,529` credits `fareAmount*(1-commission)` for **all** bookings incl. cash (PENDING). Driver keeps cash in hand **and** gets 85% wallet credit. `completeTrip` correctly restricts to online `PAID` only (`trips.service.js:37`) — the two completion paths disagree. Fix: in `arriveTrip`, credit only online-paid bookings.
- **B-C3 — `banUser` always 500s.** `admin.service.js:510` writes `refreshToken: null`; `User` model has no such column (refresh tokens are a separate `RefreshToken` model). Banning any user crashes. Fix: drop the field; revoke via `RefreshToken.updateMany`.

### HIGH
- **B-H1 — Ride-group hub broken (wrong relation).** Schema relation is `group` (schema:252), but `bookings.service.js:508,511,517,534,546` use `trip.rideGroup`. `regenerateInvite` + `getGroup` throw every call. (Top-level `prisma.rideGroup` uses elsewhere are fine.) Fix: rename nested refs to `group`.
- **B-H2 — Admin active-trips list 500s.** `admin.service.js:556` selects `route.destName`; Route field is `destinationName` (schema:191). `GET /admin/trips/active` always fails.
- **B-H3 — Admin "pending approvals" always 0.** `admin.service.js:534` counts `status==='PENDING'`; drivers use `'PENDING_REVIEW'` (schema:128). Dashboard tile wrong.
- **B-H4 — Admin dispatch audit always logs `'admin'`.** `admin.controller.js:182` reads `req.admin` which `adminAuth.js` never sets (shared `x-admin-secret` only). No per-admin accountability. Larger issue: no admin identity/RBAC (see admin readiness).

### MEDIUM / LOW
- **B-M1** `wallet.service.js:45 confirmTopUp` dead + no idempotency guard; unsafe if ever wired.
- **B-M2** `bookSeat:50` cancels prior SEAT_HELD without nulling `seatNumber`; re-picking same seat throws raw Prisma unique error instead of `SeatTakenError`.
- **B-L1** `cancelBooking`/`submitDispute` accept `note` never persisted (silent drop).
- **B-L2** `emergencyAlert` creates SOS `SupportTicket` with `status:'URGENT'` — won't match standard status filters; SOS never surfaces in admin queue.
- **B-L3** `expireUnansweredDispatchOffers` exists but is not scheduled anywhere — confirm a cron wires it.

### Money-flow verified CLEAN
Wallet debit guarded (`gte` + count), withdrawal reversal exact, Paystack webhook HMAC + Redis-NX lock + idempotency, top-up double-credit guarded, completion double-credit guarded. Only real money bug is B-C2 (over-credit of cash).

### Admin backend readiness
Working: driver list/approve/suspend/reject/docs, user list/detail/trips, trips list/unassigned/assign+dispatch, route CRUD+stops, pulse list/create, support tickets, trip reports, promotions list/create/toggle, metrics, live-driver map, surge set.
**Missing/broken before admin build:** (1) real admin identity + RBAC (only shared secret); (2) B-C3/B-H2/B-H3 broken endpoints; (3) no pulse update/delete, no promo edit/delete; (4) no driver-payout management/override; (5) no SOS queue endpoint; (6) no financial reporting beyond today-only metrics; (7) `assignDriverToTrip` uses hardcoded 0.70 cut vs 0.85 real.

---

## RIDER APP (apps/rider)

### HIGH
- **R-H1 — "ALL TRIPS" tier filter is dead.** `SelectStage.tsx:109` inits `selectedTier='ECONOMY'`; never set to `null`. `!selectedTier` (ALL active state) always false; tapping ALL runs `setSelectedTier('ECONOMY')`. Riders can never see unfiltered results. Fix: `TripTier|null`, default `null`, pass `tier ?? undefined`.
- **R-H2 — Dead "Options" button in live tracking.** `ride/[id]/tracking.tsx:682` renders with no `onPress`. In-trip action menu unreachable.
- **R-H3 — Request can hang on "searching" forever.** `RequestStage.tsx:58-77` — if `requestTrip` returns no `requestId`, poll never arms, UI stuck; `handleCancel:94` routes home without server cancel. No timeout / no "no driver found" terminal state.

### MEDIUM / LOW
- **R-M1** `ride/[id]/payment.tsx:557` shows raw `GHS {fareAmount}` (no `formatCurrency`, no 2-dp).
- **R-M2** `eta.message` assumed present (typed required, backend may omit) → status line briefly blanks.
- **R-M3** `SelectStage.tsx:320` `(destText || destText)` copy-paste typo (harmless, dead logic).
- **R-M4** `cancel.tsx` invalidates only `['bookings']`, not scheduled/active queries → stale lists.
- **R-M5** Client-side fare recompute in SelectStage (haversine + 5% fee) can drift from server truth.
- **R-L1** Persistent trip surface: `trip.tsx renderStage` handles only search/select/request; `assigned`+`tracking` return `null` — fluid map handoff not wired (tracking works only via separate route).

---

## DRIVER APP (apps/driver)

### HIGH
- **D-H1 — Credits render as red debits.** `earnings.tsx:283,286,299,301` key row icon/color/sign on `tx.type==='CREDIT'` only, but `CREDIT_TYPES` (`:121`) also includes `TRIP_EARNING`/`EARNINGS_CREDIT`/`QUEST_BONUS`. Real earnings show red down-arrow + `−GHS`. Fix: `isCredit = CREDIT_TYPES.includes(tx.type)`.
- **D-H2 — Commission rate contradicts itself 3 ways.** active `/0.70` (30% cut), complete `?? 0.15`, detail 0% (raw fare). Same trip → 3 different earnings numbers. Fix: use backend `commissionAmount` everywhere.
- **D-H3 — Socket ref-count leaks (3 sites).** `home.tsx`, `useDriverSocket.ts`, `_layout.tsx` call `connectDriverSocket()` with no paired `disconnect`. Ref never hits 0 → `/driver` socket + listeners stay alive after logout. Fix: reconnect via `socket.connect()`, not the ref-counting connector.
- **D-H4 — Onboarding lets undocumented drivers "complete".** `(onboarding)/index.tsx` Continue always enabled; `documents.tsx DOCUMENT_CONFIG` only supports 3 types — Vehicle Reg / Insurance / Roadworthy have **no upload surface** despite being "required". Fix: gate on upload status, add missing doc types.
- **D-H5 — Background-location leak + wrong color.** `useDriverLocation.ts:73` uses rider green `#4be277` (not driver blue); `:250` stops on every unmount with no ref-count, but hook mounts on home+active+tracking → unmounting one kills tracking others need. Fix: driver blue + ref-count.

### MEDIUM / LOW
- **D-M1** `(trip)/cancel/[id]` orphaned — active/tracking cancel inline via Alert, so reason + penalty warning never shown. Route cancel buttons to the screen.
- **D-M2** "Mark No Show" reuses `cancelTrip` → no-show hurts cancellation rate like voluntary cancel. No no-show endpoint.
- **D-M3** Withdraw min copy inconsistent: `earnings.tsx:96` says GHS 1.00; real min is 20 (backend + hint).
- **D-M4** Withdraw invalidates `['driver','wallet']` but balance sourced from `['driver','me']` → stale balance.
- **D-M5** `active/[id].tsx:67` ignores route `id`, calls `getActiveTrip()` (findFirst by driver). Wrong trip if driver has >1 active. Fix: `getTripById(id)`.
- **D-M6** `create.tsx` route search is static Text, no TextInput — dead UI; "15% commission" copy conflicts with D-H2.
- **D-M7** `add-passenger.tsx:60` boardPassenger has no `onError` → silent stuck after OTP verify fails.
- **D-M8** Notifications tab is socket-only, no server fetch → notifications while app killed never appear.
- **D-M9** `rate-passengers` filters by `user?.id` → cash/offline riders unratable.
- **D-L1** `OnlineToggle.tsx` static colors, not theme-reactive.
- **D-L2** Moti still imported in documents/chat/tracking/vehicle/onboarding (rider stripped it for startup-crash risk — verify parity).

### Missing/incomplete driver features
Quest **claim** endpoint+UI absent (`quests.api.ts` list-only); vehicle doc upload (D-H4); no-show outcome (D-M2); earnings breakdown by day/week; reachable cancel-reason screen (D-M1); server-backed notifications (D-M8); payout-account validation.

---

## SHARED PACKAGES (packages/*)

### HIGH
- **P-H1 — `PaginatedResponse<T>` type is fiction (systemic drift).** `api.types.ts:18-27` declares `{data:T[], pagination}`; no backend endpoint returns that. Real shapes: `tripsApi.search`→`{trips,total,page,totalPages}`, `walletApi.getTransactions`→`{transactions,...}`, `notificationsApi.getAll`→`{notifications,...}`, `bookingsApi.getHistory`→ nested. Consumers already work around with `?.data?.data?.x`. Retype to `ApiResponse<{x:T[];total;page;totalPages}>`.

### MEDIUM / LOW (latent — currently unused, would 404 if called)
- **P-M1** `walletApi.withdraw`→`POST /wallet/withdraw` not mounted (only on `/driver/wallet`). Dead + 404.
- **P-M2** `routesApi.search`→`GET /routes/search` collides with `/routes/:id`.
- **P-M3** `configApi.getDynamicConfig`→`GET /config/mobile` has no backend.
- **P-M4** `referralsApi.*` has no backend module.
- **P-M5** `supportTicketsApi.addMessage` sends `{message}`; backend wants `text` → 400.
- **P-L1** `UpdateProfileRequest` lacks `preferredTier` (backend validates it).
- **P-L2** `Notification.type` union includes types backend never emits.

### Verified CLEAN
Maps = MapLibre + free OpenFreeMap tiles, no Google/Mapbox paid refs or tokens, both apps consume `@eyego/maps`. auth/payments/bookings/cancellation/trips/driver/notifications routes all match.

---

## FALSE POSITIVES REMOVED (verified NOT bugs)
- Rider "scheduled status MATCHED vs ACCEPTED mismatch" — `TripRequest` (live) uses ACCEPTED; `ScheduledRideIntent` (schema:525) uses MATCHED. Different models, both correct.
- Driver "active screen loses trip after ARRIVED" — backend `getActiveTrip` returns `ARRIVED_AT_PICKUP`/`IN_PROGRESS` (drivers.service:210). Real issue reduced to D-M5 (ignores id).

---

## SUGGESTED FIX ORDER
1. Backend crashes/money: B-C1, B-C2, B-C3, B-H1, B-H2, B-H3.
2. Driver money/leaks: D-H1, D-H2, D-H3, D-H4, D-H5.
3. Rider flow: R-H1, R-H2, R-H3.
4. Contracts: P-H1 (+ latent P-M1..5).
5. Mediums/lows + missing features.
6. Admin identity/RBAC before building admin app.
