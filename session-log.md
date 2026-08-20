# EyeGo V2 Session Log

## 2026-07-22 [saved]
Goal: Fix 25-item stress-test bug list across both apps + backend (pricing, payments, maps, morph, disputes, dispatch).
Decisions:
- Fare floor (MIN_FARE_PER_PERSON) now per-tier (= tier's own base fare) instead of a flat ₵5 — flat floor was clamping ECO and COMFORT to the identical price on most routes.
- "Pay for everyone" wired to real isCoverAll/RideGroup settlement in confirmPayment/initiatePayment — previously pure UI-only, host's payment never covered the group.
- boardPassenger now deducts commission for CASH bookings at boarding (mirrors addCashNoPhone/verifyOfflineOtp) — cash trips never moved the driver wallet before.
- Added driver:arrived_at_pickup socket event — 'driver:arrived' was already taken (means arrived at destination/trip complete); pickup arrival had zero real-time signal to rider.
- Route polylines recolored to violet (#A855F7) both apps — was colors.primary, which matched the base map style's own road color on both (green rider, blue driver).
- Driver foreground location (useDriverLocation applyPosition) now also emits via socket — previously ONLY the background TaskManager task emitted, so a driver without background/"Always" location permission never entered the dispatch geoset at all.
- SupportTicket.driverId now populated by submitDispute (schema had the column, never written) — driver ticket visibility was previously a phone-number account-match coincidence, not real trip linkage.
- expo-camera and expo-location added to apps/rider/app.json plugins — both used natively (CameraView, requestForegroundPermissionsAsync) but never registered; matches the objc_exception_rethrow/TurboModule SIGABRT signature in both provided .ips crash logs. Needs a new EAS build to take effect, not OTA-fixable.
Rejected: renaming 'driver:arrived' to avoid confusion — client/server already consistent on it meaning trip-complete; touching it risked breaking working completion flow for no real gain.
Open: Business "auto-email receipts to expense email" toggle is 100% unimplemented (no email infra exists anywhere in eyego-api) — flagged to user, not built (needs provider/credentials decision). Full group-hub payment UI (server now supports it) not yet re-tested live.

## 2026-07-23 [saved]
Goal: 4th stress-test pass (11 bugs) + client-driven pivot: drop fixed Route/trotro system for group/on-demand pickup-from-map booking, per client meeting.
Decisions:
- Client pivot scoped via user Q&A: sequencing = fix isolated bugs first, pivot second; deviation fare = free under threshold then per-km; driver-created trips discovered via browsable nearby-trips list (not push); fleet is ALL minibus/14-seater — tier is comfort level only, no separate solo car tier; fare must be point-to-point distance-based.
- Refresh-token rotation now has a 15s reuse grace window (auth.service.js) instead of hard-erroring on an already-rotated token — driver app polls far more (location/earnings/nearby-trips) than rider, so concurrent-refresh races were forcing logout on "every touch"; rider hits the same code path but rarely races it.
- Driver tracking map camera locked to north-up (heading 0, rotateEnabled false) instead of auto-rotating to bearingBetween(driver,target) — Mapbox AnimatedMarkerView rotation is screen-space only, so any map rotation (auto or user gesture) desynced the driver pin from true GPS heading. Trade-off: lost the tilted "faces direction of travel" camera polish for correctness.
- place-picker.tsx crash fixed (unguarded feature.geometry.coordinates destructure on an admittedly-unverified Mapbox event contract) + added a search bar inside the picker (previously drag-pin only) for parity with where-to search.
- rider tracking.tsx: removed bogus `.trip` unwrap (tripsApi.getById() has no nested .trip field) that made a freshly-opened/joined trip's data silently fall back to stale/null Zustand state.
- rider notifications.tsx: AnimatedList was missing style={{flex:1}} — list occupied zero height, looked blank even though the data fetch worked.
- Driver-side "Show Payment QR" added to active trip screen (eyego:trip:<tripId> payload) — there was previously ZERO driver-side QR generation anywhere; rider scan-pay.tsx now also handles that prefix (routes to tracking) alongside the existing P2P eyego:pay:<phone> format.
- scheduled-rides.tsx cards now show distance + (once MATCHED) driver name/vehicle/fare-per-seat, computed server-side via calculateFare — previously only route name/time/seats/status, which read as "no details" once a driver was actually assigned.
Rejected: chasing an exact single root cause for the driver logout bug (e.g. a specific duplicate-refresh caller) — closed the whole race-class with a grace window instead since the single-use-rotation design is what's fragile, not one call site.
Open: Phase 2 (the actual pivot — drop Route/VirtualStop from booking, driver create-trip map-pin rewrite, dispatch overhaul, deviation-surcharge fare calc, nearby-trips browse) NOT started — isolated bugs were fixed first per user's sequencing choice. Also open: saved-places.tsx crash (no cause found after full read, may already be fine — retest), rider home-card→tracking crash (fixed the one proven data bug, but no unguarded throw was ever found — retest before assuming fully fixed), dispatch silent-failure investigated but not changed independently of the pivot (TripRequest fallback path already exists and looks structurally correct; item folds into Phase 2 anyway since primary rider flow currently searches route-based Trips first).

## 2026-07-23 [saved] Phase 2 pivot
Goal: Client meeting revealed real business model = group/bus booking (map-pin pickup, invite-link co-riders, driver-created ad-hoc trips), not fixed trotro routes. Build it.
Decisions:
- Ad-hoc Trip creation reuses the EXISTING Trip→Route relation (no Trip schema change) — driver/rider now supply raw lat/lng, backend auto-creates a `Route{isAdHoc:true}` row with haversine distanceKm. Mirrors a pattern trip-request.service.js already had; avoided a much riskier Trip-model migration.
- Found and fixed a real standalone bug while building this: `searchTrips` destructured `destLat/destLng` but the client has only ever sent `destinationLat/destinationLng` — proximity filtering was silently a no-op on every real request, returning ALL upcoming trips regardless of distance. This alone explains a chunk of "matching/dispatch feels wrong."
- Deviation/detour fare: `detourKm()` (insert-waypoint distance formula) + `calculateDeviationSurcharge()` in fare.calculator.js, free under `FREE_DEVIATION_KM` (default 1.5km, tunable single constant per user's "I'll get real numbers from client later").
- Group-hub joiner's own pickup point stored on Booking (`pickupLat/Lng/Address`, `deviationSurcharge`) — new `PATCH /bookings/:id/pickup` (pre-payment only) since the booking is already created the instant invite.tsx mounts (needed for the invite link), so pickup has to be settable after the fact, not at creation.
- Driver create-trip (create.tsx) Step 1 rewritten: map-pin pickup (defaults to GPS) + destination search/map-pin, built on a new `apps/driver/app/(trip)/location-picker.tsx` (ported rider's place-picker pattern — driver app had no geocoding/place-picker utils at all before this).
- "Nearby trips browse" = the existing SelectStage trip list, now correct after the searchTrips fix — no new discovery UI needed, just fixing the broken filter.
- Fleet is 100% minibus/14-seater per client; tier (ECO/COMFORT/PREMIUM) is comfort-level only — confirmed NO new vehicle-category schema needed, "solo vs group" is just seat-count + group-hub usage on the same Trip model.
- `refreshDriverToken`/`refreshPassengerToken` given a 15s reuse grace window (auth.service.js) — real fix for "driver app logs out constantly," a single-use-refresh-token race that's structurally more likely to fire for the driver app (polls far more than rider).
- Schema pushed via `prisma db push` (SQLite dev.db, no migrations/ dir exists in this repo — that's the established workflow here, not a one-off).
Rejected: adding a bearing-angle "same direction" matching algorithm for nearby-trips — the existing dual-radius origin+destination proximity check already achieves this without new failure modes.
Open: Admin panel untouched (isAdHoc routes will now appear in the admin route list; needs a filter, but admin needs separate user review per earlier session). trip-request.service.js's own inline ad-hoc-route creation not refactored to share the new helper (works fine standalone, just slightly duplicated). No live device/simulator test performed this session — tsc is clean on both apps and the API dev server ran clean through ~25 nodemon restarts, but nothing has been tapped on a real screen yet.

## 2026-07-23 [saved] Cross-codebase bug hunt + admin fixes
Goal: Find remaining well-hidden standalone bugs across rider/driver/backend/admin (4 parallel agent audits) instead of finding them one at a time manually; fix admin panel pivot-compat; commit for user testing.
Decisions:
- "Heavy cargo in group" toggle (invite.tsx) was 100% client-only — changed the displayed price (+GHS 10) but never charged anything server-side (confirmed zero backend representation). Wired for real: `Booking.heavyCargo` column, `PATCH /bookings/:id/heavy-cargo`, shared `applyFareAddons`/`recomputeBookingAddons` helper in bookings.service.js so pickup-deviation and heavy-cargo surcharges compose correctly instead of each update silently clobbering the other.
- `recomputeBookingAddons` runs as one atomic read-check-write ($transaction + conditional updateMany), matching bookSeat's existing Serializable pattern — the original single-purpose `updateBookingPickup` (built earlier today) was a plain read-then-write with no race protection; replaced entirely rather than patched.
- Added express-validator on `PATCH /bookings/:id/pickup` (lat/lng must be finite floats) — the original endpoint had zero validation and would have written NaN straight into fareAmount/commissionAmount on a malformed request.
- Ad-hoc Route + Trip creation (trips.service.js createTrip) now share one `$transaction` — previously a failure between the two (e.g. bad departureTime) permanently orphaned the just-created `isAdHoc` Route row with no cleanup path.
- `dispatch.service.js` read `trip.route.origin`/`.destination` — Route only has `originName`/`destinationName`. Every dispatch push/socket payload showed blank route names. Pre-existing, not pivot-caused. Fixed.
- Driver create-trip GPS-default-pickup race: the mount-time GPS+reverse-geocode effect could resolve AFTER a driver manually picked a pickup point via the map picker, unconditionally overwriting it — the `if (origin) return` guard could never fire again since the effect has a `[]` dep array. Fixed with the functional-setState form (`setOrigin(prev => prev ?? ...)`), which reads latest state at commit time regardless of when the async work resolves.
- Driver create-trip seats stepper was hardcoded 1-14 regardless of the driver's actual vehicle capacity — backend already silently clamped `maxSeats` down to `vehicle.seaterCount`, so a driver could review/confirm a fare estimate for more seats than would actually be published. Now fetches `driverApi.getMe()` and caps the stepper to the vehicle's real `seaterCount`.
- Rider help.tsx support tickets list was always empty — `ticketsData?.data?.tickets` skipped one unwrap level (`ApiResponse<T>` needs `.data.data`), so riders who filed a dispute could never see it landed.
- Admin console (`eyego-api/public/index.html`, a single static-HTML admin — there is no separate admin app/repo): `createRoute()` silently caught EVERY failure (very likely `ROUTE_GEOCODE_FAILED` since the form only collects place names, no coordinates) and fabricated a fake local-only route object with hardcoded `distanceKm:15`, showing "Route created (offline)" as if it had succeeded — it hadn't, and vanished on refresh. Fixed by making `apiGet/Post/Put/Delete` surface the backend's real error message (reads response body) and showing that instead of faking success.
- Admin `getRoutes()` now excludes `Route.isAdHoc` rows by default (`includeAdHoc=true` query param to see them) — otherwise every ad-hoc trip permanently added a "Pickup point → Destination" row sorted to the top of the curated Routes list and the Pulse Schedule route picker.
- Admin `getAllDrivers`/`getAllUsers` controller responses were dropping `total/page/limit` even though the service computed them — currently harmless (console always requests limit=500, no pagination UI), but silently invisible truncation the moment either list exceeds 500. Fixed to pass through.
- Admin bookings table now shows a small "+GHS X detour" / "heavy cargo" note when a booking's `deviationSurcharge`/`heavyCargo` differ from the trip's base fare — these columns existed on Booking already (Prisma returns all scalars by default, no backend change needed) but were invisible in the UI.
Rejected: reconciling "Total Group Fare" (invite.tsx, an aggregate estimate across all group members) to also include other members' individual heavy-cargo/deviation surcharges — no aggregate-fare endpoint exists and each booking's addons are independent; left as the pre-existing approximation, only "Your Split Share" (the current viewer's own booking) was made authoritative since that's what's actually charged to them.
Open: tsc clean on both apps, admin HTML script blocks parse clean (checked via `new Function()`), API dev server ran clean — but nothing tested on a live device/simulator/browser this session either. Committed and pushed at user's request without device testing; user is testing now.


## 2026-07-26 02:30 [saved]
Goal: Diagnose why rider trip requests never reach the driver app; verify dispatch end-to-end.
Decisions:
- Camera crash confirmed via pulled on-device crash report: MapboxGL.Camera with no initial coordinate throws SIGABRT on first layout. Fixed in ride/[id].tsx.
- Redis not installed locally; InMemoryRedis fallback was missing geoadd/geosearch/georadius/sadd/smembers, so dispatch silently matched zero drivers. Implemented and verified all 5.
- Audited all redis.* calls: eval/sendCommand already dev-bypassed, ping() already try/caught — no other gaps found.
- Backend process had died independently of any code change; restarted via `npm run dev`, port 5020, nodemon confirmed picking up both redis.js fixes.
Rejected: Ghana-geofence theory as sole dispatch root cause — real cause was the Redis fallback gap.
Open: Confirm on phone post-rebuild that a rider request now reaches the driver app; confirm installed build's actual API host (EXPO_PUBLIC_API_URL unset in all EAS environments).

## 2026-07-26 03:15 [saved]
Goal: Deep silent-failure hunt across backend + both mobile apps (not typecheck — real logic bugs), per user request.
Decisions:
- InMemoryRedis.set() never implemented NX — payment double-charge lock + webhook dedup lock silently always succeeded when Redis down. Fixed, verified.
- Audited all useMutation blocks in both apps (automated brace-matched scan): 0 missing onError; 9 flagged as "no visible feedback" all manually verified false positives (toast/setError/dedicated error UI exists, just didn't match regex).
- Admin panel <-> backend route parity: 100% match, zero dead endpoint calls.
- Backend cron jobs (6 setInterval loops): all try/caught, no unhandled-rejection risk.
- JSON.parse audit across backend: all unguarded instances are safe-by-construction (parsing own just-written JSON) or already try/caught.
Rejected: Treating tsc/typecheck as sufficient — user explicitly wants logic-level bug hunting, not compile checks.
Open: Did not exhaustively read every backend module (e.g. quests, promotions, heatmap) line-by-line — checked highest-risk (money/dispatch/safety) areas only.

## 2026-07-27 12:40 [saved]
Goal: Fix admin live map showing fake drivers + cash bookings stuck "pending".
Decisions:
- Live map "2 hardcoded drivers" = seed.js seeded Kwame/Kofi with isOnline:true forever, static coords. Fixed seed.js (isOnline:false) + patched existing DB rows. Map code itself was already correctly dynamic.
- Cash "pending" = boarding (which flips PENDING→PAID) is a manual per-seat driver tap, easily skipped; completed trips could leave cash bookings PENDING forever. Added auto-settle-on-completion in both trips.service.js completeTrip AND drivers.service.js arriveTrip (two independent completion paths) — force paymentStatus PAID + deduct commission at trip close.
- Found + fixed real money-safety bug while there: completeTrip credited driverEarnings to wallet for ALL paid bookings incl. CASH, double-paying drivers who already collected cash in hand + had commission deducted at boarding. Excluded CASH from the wallet-credit sum (receipts still generated for all methods).
- Standardized cash-pending status string to 'PENDING' everywhere — payments.service.js confirmPayment was writing 'CASH_PENDING', a value nothing downstream (admin badge map, arriveTrip's booking filter) recognized. Grepped confirmed zero other readers of 'CASH_PENDING'.
Rejected: didn't rewrite admin's whole badge system — added CASH_PENDING as defensive map entry only.
Open: 2 historical bookings on already-completed trips still show PENDING (pre-date this fix, idempotency guard skips re-running completeTrip) — backfill script blocked by permission classifier (wallet balance write), needs user go-ahead.

## 2026-07-27 13:15 [saved]
Goal: Full admin dashboard audit (Riders/Trips/Support/Analytics/OTA) after live-map + cash-pending fixes.
Decisions:
- Backfilled 2 historical stuck-PENDING cash bookings to PAID + deducted commission (user-approved).
- Sub-agent audit found real dispatch-safety bug: 'ARRIVED_AT_PICKUP' trip status (real, written by drivers.service.js:316) was missing from every "active trip" status set — admin live map showed a driver who'd arrived and was boarding as "Free"/available, risking double-dispatch. Fixed in 4 places: index.html badge map + active-stat filter, admin.service.js getMetrics/getLiveDrivers/getAnalyticsOverview/ACTIVE_TRIP_STATUSES.
- Also added missing 'NO_SHOW' booking-status badge (fell through to unstyled default before).
- Riders/Support/Analytics/OTA/Promotions/Driver-approval tabs: audited, all correctly wired to real Prisma queries, no bugs found.
Rejected: not building rider-wallet-adjustment admin feature (doesn't exist, out of scope, needs product decision). Not building trip cancel/reassign admin action (money implications, needs ops-policy decision, flagged only). Not removing dead renderCharts()/canvas code (inert, zero impact, unrelated scope).
Open: none — this closes the admin-dashboard sweep the user requested.

## 2026-07-27 14:05 [saved]
Goal: Stress-test bug list from real device sideload (13 items) — fare, map heading, crashes, admin gaps, group booking.
Decisions:
- User picked: skip Claude Context MCP install (native tools sufficient, avoids uploading proprietary code to Zilliz/OpenAI); group-seat booking reuses existing Group Hub invite flow (no new payment-links UI); raise per-km fare rates (not seat-divisor logic); repurpose (not remove) admin Assign Trip panel for driver-goes-offline-mid-trip reassignment.
- Root cause of "300km = 73 GHS" fare bug: .env ECO/COMFORT rates (3.50+0.38/km) were calibrated against seed.js's old <25km in-city routes pre-pivot, never updated for arbitrary-distance intercity trips. Bumped to ECO 5+3.00/km, COMFORT 8+4.20/km, added PREMIUM 12+5.50/km override (none existed before, fell back to code default 50+16). Estimates, not client-confirmed final numbers — .env.example already had closer-to-right placeholder values (20/5.00 etc), confirms drift not intentional design.
- Admin revenue=0 root cause: getAnalyticsOverview() summed PaymentTransaction.status='SUCCESS' only — CASH bookings' PaymentTransaction row is created PENDING and never flips (cash has no gateway callback); real settlement lives on Booking.paymentStatus='PAID' instead (set at boarding/completion). Since platform is majority-cash, revenue showed ~0. Fixed to aggregate from Booking.paymentStatus='PAID' instead, matching the pattern already used correctly in getDriverDetail's earningsAgg.
- Dispatched 4 parallel background agents (isolated worktrees, to merge+review before commit) for disjoint file scopes: driver/rider tracking-map circle+heading rendering; rider where-to zoom + suggested-trips removal + home-page crash; post-dispatch-accept cluster (unmatched-route nav, cannot-advance-from-confirmed resume bug, rider requesting-page crash) — all suspected to share the driver-accepts-trip event as trigger; admin detail-modal thoroughness pass.
Rejected: doing exhaustive personal deep-dive on every one of the 13 items solo — scope too large for single-context pass, delegated cleanly-scoped clusters instead.
Open: group-seat-count booking feature (rider seat picker + fare×seats + reuse Group Hub + dispatch capacity match) NOT started — deliberately held until the 4 background agents finish and are merged, since it needs edits to the same backend files (trips.service.js, trip-request.service.js) Agent C (status-machine cluster) is currently editing in its own worktree. pymobiledevice3 not installed / no device connected this session — rider home-crash diagnosis had to proceed via static code read only (delegated to Agent B), no live syslog available.

## 2026-07-27 15:30 [saved]
Goal: Merge 4 background agents + diagnose real device crash logs from "ios crash logs/" folder.
Decisions:
- Merged all 4 agents cleanly (no file conflicts): map-heading fix (active/[id].tsx rotateEnabled + NavCamera trackUserLocation='course' removal — 2 independent rotation sources, both fixed), admin detail-modal depth pass (+ real backend gap: support tickets only fetched last message, added getSupportTicketDetail), rider where-to zoom fix (missing cameraRef.setCamera imperative call, TripMap.tsx was the one map missing this established pattern) + suggested-trips section removed, post-dispatch-accept cluster (driver STATUS_FLOW missing CONFIRMED state entirely — client-side threw before ever hitting backend; rider dual-poller race between RequestStage and activity.tsx's LiveRequestCard both navigating on match).
- EyeGoLiveActivity crash logs (7x, "ios crash logs/"): all identical CODESIGNING/Invalid-Page native fault, zero symbolication, device on iPhone OS 27.0 BETA. No App Group entitlement misconfig found in source. Concluded this is an OS/signing-level issue outside what app-code changes can fix — reported honestly rather than fabricate a fix. Correlated timestamps suggest LiveActivity crashes may be a side-effect of the main app crashing nearby, not fully independent.
- Main app crash logs (2x, EyeGo-*.ips): IDENTICAL stack both times — MLRNCamera _setInitialCamera → uncaught native exception → SIGABRT. Real, reproducible, fixable. Root cause: shared Camera wrapper (packages/maps/src/index.tsx) passed centerCoordinate/zoom/heading/pitch straight to native MLRNCamera with no finite-number guard — a NaN/Infinity coordinate (e.g. from a geocode/haversine result computed before inputs resolved) crashes the native layer with no JS-catchable error, so it could happen from any screen. Fixed once at the chokepoint (Camera render, setCamera imperative call, fitBounds, NavCamera fallback) rather than chasing the one caller — no JS stack was in the crash report to identify it precisely.
Rejected: guessing at a specific screen-level fix for the crash without stack evidence — fixed at the shared component level instead since that protects every current and future caller.
Open: group-seat-count booking feature (reuse Group Hub, user-approved) and admin Assign-Trip repurpose (reassign on driver-offline, user-approved) — still NOT started, deliberately deferred past this already-huge session. Nothing committed to git yet. User should rebuild+resideload before next test pass — several fixes (camera NaN guard, map rotation, status-flow) require a fresh binary, not just JS-only OTA-deliverable ones.

## 2026-07-27 16:45 [saved]
Goal: Implement the 2 deferred items — group-seat booking + admin Assign-Trip repurpose.
Decisions:
- Group-seat booking: backend (trip-request.service.js seatCount/coverAll) was already 70% built — TripRequest.seatCount existed and fed vehicle-capacity sizing, but every booking-creation path only ever created 1 booking per rider regardless of their seatCount (silently under-booked/undercharged groups). Added TripRequest.coverAll column (schema + db push — SQLite dev.db). coverAll=true: books all N seats under the requester now (N bookings, 1 booking = 1 seat everywhere else in the codebase so this preserves that invariant), auto-creates RideGroup so one payment settles all N via existing sibling-settlement logic (zero payment-flow changes needed). coverAll=false: books just their 1 seat, leaves N-1 open on the already-correctly-sized trip, auto-creates RideGroup(isCoverAll=false) so they have an invite link immediately — 100% reuses existing invite/join flow, zero new booking mechanism. Frontend: seat stepper + pay-for-all toggle added to SelectStage.tsx's "Request a Trip" CTA (the only entry point into the on-demand flow), stored in ride.store.ts, consumed by RequestStage.tsx (previously hardcoded seatCount:1).
- Admin Assign-Trip: redefined getUnassignedTrips from "SCHEDULED/FILLING + driver offline" (structurally near-empty, drivers always self-attached) to "any non-terminal trip + driver offline" (real mid-trip-dropout scenario). assignDriverToTrip no longer resets status to FILLING (was designed for pre-departure only — would have wrongly reset an in-progress trip with riders aboard back to "gathering passengers"); now swaps driverId in place, keeps existing status, added a push notification to the newly-assigned driver (previously silent).
Rejected: none — both items landed within original scope from the AskUserQuestion answers.
Open: Prisma client regen (`prisma generate`) blocked by EPERM — the locally running `npm run dev` backend process holds the query engine .dll.node file locked. User must stop the dev server, run `npx prisma generate` (or `node node_modules/prisma/build/index.js generate`), then restart, before the new TripRequest.coverAll field is usable — until then requests will still work but coverAll will be silently ignored by the stale client. Nothing committed to git this entire session — nearing 30 files touched, strongly recommend a review pass + rebuild/resideload before continuing further.

## 2026-07-27 17:30 [saved]
Goal: Auto-request dispatch flow, driver-cancel redispatch, scheduled-ride Activity polish. Committed+pushed (2d42e52).
Decisions:
- Where-to CTA now skips SelectStage's "browse existing routes" screen entirely — picks destination, taps Order Ride, goes straight to RequestStage (now styled with GlassSurface/GradientGlowBorder). SelectStage still exists as a component, just no longer the default path.
- Driver-cancel-mid-trip redispatch: new Trip status 'REASSIGNING', reuses the EXISTING generic kind-based dispatch-offer pipeline (driver home screen's 20s poll + live socket 'trip:assigned' listener + dispatch/[id].tsx screen) by adding a second 'REASSIGNMENT' kind alongside the pre-existing 'REQUEST' kind — no new UI screens built, just branched the existing accept/decline mutations. New endpoint POST /driver/trips/:id/claim-reassignment, atomic first-claim-wins matching acceptDispatch's pattern.
- Scheduled rides: discovered the ENTIRE backend matching/dispatch worker (processScheduledRideIntents, runs on a server.js interval) + a full standalone /scheduled-rides screen with live status card (GradientGlowBorder) + an Activity tab "Scheduled" sub-tab ALREADY EXISTED from a prior session, fully functional end-to-end. Only fixed 2 real drift bugs: Activity tab's embedded version was missing the DISPATCHED status label and DISPATCHED cancel-button condition that the standalone screen already had.
Rejected: none this round — scope matched what was asked.
Open: dev server needs restart for driver/rider apps to pick up new API routes; native rebuild needed for full device testing (matches earlier open item).

## 2026-07-28 09:15 [saved]
Goal: Fix rider tracking-page crash, bare where-to page, morph smoothness, suggested-trip crash.
Decisions:
- Tracking-page/suggested-trip crash: root-caused to the SAME MLRNCamera NaN-guard bug already fixed in commit 41bc768 — verified both apps/rider/app/ride/[id]/tracking.tsx and app/ride/[id].tsx (the suggested-trip screen) import MapboxGL via utils/mapbox.ts, which is a pure re-export of the already-patched @eyego/maps Camera. Fix commit (41bc768, 15:37) predates the new crash log's timestamp (17:22) but the user almost certainly hadn't done a fresh native rebuild+resideload between them — JS source fixes don't reach the device without one. Told user plainly rather than claiming false certainty; no code change made here since the fix already exists and is verified intact.
- Where-to page: removed Quick Destinations chips (Home/Work/Accra Mall) and all dead code behind them (QUICK_DESTINATIONS, getQuickChips, handleQuickChip, unused saved-places query) — idle state now shows nothing but the search fields, matching Uber/Bolt.
- Morph "not smooth" — found a real, well-known root cause: MorphProvider's overlay animated raw left/top/width/height every frame. Even UI-thread-driven (Reanimated worklet), assigning layout properties forces a native layout recalculation every frame — the classic reason a "technically smooth" animation still looks janky, especially significant here since a card can grow to full-screen (large width/height delta ~60x/sec). Rewrote to the standard container-transform technique: fixed layout frame pinned at target rect, 100% of position/size driven through `transform` (translateX/Y + scaleX/Y) — pure GPU compositing. Inner content gets inverse scale so it isn't visually stretched by the outer transform.
Rejected: did not attempt to "fix" the tracking crash with speculative new code with no crash evidence pointing to a new location — reused the existing verified fix instead of guessing.
Open: user needs to confirm a genuinely fresh native rebuild before the tracking/suggested-trip crash can be considered verified fixed on-device; morph transform rewrite needs on-device visual confirmation (cannot be verified from this environment).

## 2026-07-28 19:40 [saved]
Goal: Ten stress-test defects across rider, driver, backend.
Decisions:
- MLRNCamera SIGABRT root cause is upstream `_setInitialCamera` running on the map's first (zero-size) layout; fix = don't mount Camera until MapView reports a real size.
- Camera must push its first stop imperatively — `-[MLRNCamera setMap:]` applies nothing, so a late-attached camera otherwise sits at world zoom.
- maplibre v11 region events are flat `ViewState`, not legacy GeoJSON; adapter normalises so screens stay unchanged.
- SCHEDULED/FILLING trips past departure are now EXPIRED — they were blocking dispatch forever and faking "Resume Trip".
- `getTrip` is viewer-scoped and `searchTrips` lists only joinable public trips; both leaked live driver GPS and co-rider identities.
Rejected: NaN-coordinate theory as the crash cause — guards were already in place and it still aborted.
Rejected: Redis geo-set as the dispatch membership list — absence there silently excluded free drivers.
Open: nothing device-verified; needs a fresh native build, not OTA.

## 2026-07-29 01:20 [saved]
Goal: Isolation audit, payment-path audit, Scan & Pay reality check, morph correctness.
Decisions:
- `include: { trip: { where } }` is invalid Prisma for a to-one relation — verified it throws; driver OTP-verify and board-passenger were 500ing on every call.
- Socket rooms are a separate isolation surface from REST: driver:join_tracking had no ownership check and leaked chat history for any tripId.
- Morphs read as fades because the clone's inverse scale cancels the container scale AND the target stayed hidden until settle; target now reveals from morph progress.
- Morph ids must be keyed on the same entity both sides — activity used booking.id vs target's trip id, so every ride-card morph timed out.
- QR codes must encode real URLs, not `eyego:pay:<phone>` — a bare custom-scheme string is not actionable by a phone's stock camera.
Rejected: keeping Nominatim-only geocoding; keeping the pencil button as the avatar morph's trigger.
Open: no gateway integration, so card/MoMo paths are unexercised end-to-end; nothing device-tested.

## 2026-07-29 03:05 [saved]
Goal: Hunt runtime-fatal bug class systematically; make morphs cheap per-frame.
Decisions:
- Wrote two throwaway analyzers (scratchpad) instead of eyeballing: a schema-aware Prisma arg-shape linter and a wiring linter (exports, api surface, socket event drift). Both found real bugs; both confirmed the rest is clean.
- Prisma `select` + `include` at the same level throws — driver earnings GraphQL resolver was dead on every call.
- Morph smoothness was never a timing problem: the animated style wrote left/top/width/height every frame, forcing a layout pass per frame. Static frame now lives in React state; animated style is transform/opacity/borderRadius only.
Rejected: tuning spring constants to fix morph jank — the cost was layout, not easing.
Open: socket `payment:confirmed` listener added to the API surface but not yet consumed by a screen; nothing device-tested.

## 2026-07-30 12:40 [saved]
Goal: Fix 11 defects found sideloading rider + driver builds.
Decisions:
- One distance authority: `mapbox.service.roadDistanceKm()` — preview priced road km while creation stored haversine km, ~2x apart.
- One fare denominator: `trip.maxSeats` everywhere; driver side had silently been dividing by 4.
- `useVehicleHeading` in @eyego/maps replaces compass-first rotation on all three vehicle markers — compass reads the cradle, not the road.
- Chronic low-raters (services/rating-integrity.service.js) excluded from driver averages, the go-online gate and dispatch ranking; admin views stay unfiltered.
- Where-to card became real type-to-search (inline dual inputs + suggestions), keyboard deferred 380ms so the morph keeps its frames. [superseded by 2026-07-30 15:10 — reverted to picker-on-tap]
Rejected: trusting a client-supplied distanceKm for the fare preview — a rider-editable fare.
Rejected: reading `res.data.data` for `/trips/:id` — the controller wraps it as `{ trip }`.
Open: cash false-failure trigger never reproduced from logs, only made impossible; native build + API deploy required before any of this is testable. [resolved 2026-07-30 15:10 — real cause was `bookingId: ''`]

## 2026-07-30 15:10 [saved]
Goal: Fix 14 defects from stress-testing the sideloaded builds.
Decisions:
- RN's `flex` shorthand means `flexBasis: 0`; never use it in a height chain over an auto-height parent — that collapsed the where-to card to an empty pill.
- API client types must match the wire envelope: `POST /bookings` returns `{ booking, fareData, holdExpiry }`, and mistyping it sent `bookingId: ''` — the cash "validation failed".
- Trip expiry is two layers (5-min sweep + lazy deadline guard) and marks `EXPIRED`, not `CANCELLED`, so housekeeping never hits drivers' cancellation rates.
- Route lines are casing+core, and the colour must differ per app because each map style paints its own roads that hue: driver amber, rider azure.
- Irreversible driver actions (arrive/start/end) are swipe-to-confirm, not tap — a cradled phone on a rough road taps itself.
Rejected: tying route-line colour to trip status — the driver's line must not change hue as the trip advances.
Rejected: "a started trip stays resumable forever" — that is exactly what kept a midnight trip live at 13:00.
Rejected: a hand-written `{z}/{x}/{y}.pbf` OpenFreeMap URL — returns 403; `/planet` is TileJSON.
Open: "tiles stop outside Accra" diagnosed by elimination, not reproduced — recheck after rebuild.
Open: vehicle marker still MarkerView+SVG; Uber/MLRN both favour a SymbolLayer raster sprite.

## 2026-08-02 [saved]
Goal: Rewire EyeGo to industry-standard ride-hailing architecture (Uber/Bolt parity).
Decisions:
- Trip becomes the one canonical ride object (nullable driverId, dropoff coords, TripStatus enum, version, append-only TripEvent) — rider/driver disjointedness is caused by two rows with two free-string statuses.
- Dispatch state moves to Redis + a ScheduledTask outbox table; in-process Map + setTimeout strands rides on every deploy and forbids multi-instance.
- Socket events collapse to one seq-numbered `trip:event` envelope with replay-on-reconnect, plus Socket.io Redis adapter.
- Redis mandatory, fail loud — InMemoryRedis fallback silently voided payment/dedup locks.
- DB reset (dev-only data), so Phase 5 Float→integer pesewas is a schema rewrite, not a data migration.
Rejected: adding a parallel `Ride` model alongside Trip — recreates the two-row split being fixed. Haversine candidate ranking — must be routing-engine ETA.
Open: explicit go-ahead for Phase 0; ~9 scorecard rows unaudited (map mount count, chat outbox, SOS delivery, Paystack idempotency).

## 2026-08-03 [saved]
**Goal:** Execute all 7 phases of the Uber-grade rewire plan.

**Done:** Canonical `Trip` (nullable driver, dropoff, `version`, `TripStatus`
enum, `TripEvent`, `ScheduledTask`); `applyTransition` as the single write path
with all 13 legacy `trip.update({status})` sites converted; Redis-backed durable
dispatch with ETA ranking and a GEO supply index; the second dispatch path
(`dispatch.service.js`) deleted; one sequenced `trip:event` channel with replay
and both bootstrap endpoints; both clients projecting server state with all
polls removed; signed single-use fare quotes + idempotency keys; Redis made
mandatory and stuck-trip alarms added.

**Decisions:** dev DB sqlite→postgresql (prod already was; sqlite hides every
concurrency bug); kept the existing status vocabulary instead of the plan's
synonyms and put who-cancelled in `Trip.cancelledBy` (~170 fewer edits);
scheduled `TripRequest`s broadcast rather than cascade (a 20s exclusive offer is
meaningless for a ride four days out).

**Rejected:** Float→integer pesewas — ~263 sites across 4 codebases, missing one
gives a 100×-wrong charge, invisible until a real rider is billed. Needs a live
DB + end-to-end payment test. `money.js` hardened instead.

**Open:** never run against a live database or device. `docker compose up -d`,
migrate, request a ride, watch `GET /health/dispatch`.

## 2026-08-12 [saved]
Goal: 22-item stress sweep, then booking-flow invariant audit (pass 1).
Decisions:
- Shared `TripStatus` must mirror the Prisma enum exactly; it had 8 of 15 values plus a phantom `'BOARDING'`, so no client switch could ever be exhaustive.
- `recordEvent` is the sole version bumper — never bump `Trip.version` in a sibling write, or `seq === version` breaks and client replay gaps.
- One shared `packages/ui/src/tierTheme.ts` owns tier colour/label/icon/ring; server says `ECO`, UI said `ECONOMY`, and the cast hid it.
- `AppBackground` shader is a single-slot singleton (`effects/shaderSlot.ts`), newest mount wins; per-screen mounting stacked 3-4 raymarch canvases.
- Admin rebuild approved: `apps/admin` Next.js on Vercel, adminAuth JWT + RBAC + audit log, parity-first over the 46 existing endpoints.
Rejected: passing a function `style` through to Reanimated's AnimatedPressable (fixes layout, breaks press-scale — resolve against local pressed state instead). Resolution *fractions* for shader downscale (use an absolute pixel budget; 0.5x is 3x more work on a flagship than a cheap Android). First-come shader slot (pins it to the root layout, no screen shows the effect).
Open: booking-flow pass 2 unaudited (payments/refunds, seat-race concurrency, guest+offline, confirmedSeats column drift). Nothing committed; nothing device-tested.

## 2026-08-12 18:00 [saved]
Goal: Rebuild the admin console as apps/admin, enterprise-grade and complete.
Decisions:
- Console is Next 15 server-components + Server Actions; `import 'server-only'` in lib/api.ts makes a client import a build error, so no admin token can reach the browser.
- Server-to-server calls mean CORS never applies to the console — dropped from the plan.
- Real AdminUser identity + 5 roles; lib/roles.ts gates navigation only, adminRbac.js is the gate.
- AdminAuditLog is append-only, written on res.finish, and records refused attempts with their status code.
- Settlement anywhere in admin reads Booking.paymentStatus === 'PAID'; PaymentTransaction is not settlement truth on a cash platform.
Rejected: keeping the legacy shared secret as the auth model (one leaked string = anonymous superadmin). Inline booking/trip status lists in admin reads (use seatOccupyingWhere + DRIVER_OCCUPYING_TRIP_STATUSES).
Open: nothing browser-tested against a live API. Migration SQL is gitignored, so schema travels by db push.

## 2026-08-12 23:30 [saved]
Goal: Fix 16 reported admin/rider/driver defects and confirm dispatch matches drivers.
Decisions:
- `Driver.status` approved value is `ACTIVE`; the column is a free-form String, so lib/status.ts owns the vocabulary and no literal may be inlined.
- The dispatch pool is Redis (90s presence), not `Driver.isOnline`; diagnose via the new `/admin/dispatch/health` rather than psql.
- Console maps use `@eyego/map-styles` over OpenFreeMap — same styles as both apps, no API key, so no map ever needs a token.
- Per-seat fare is DERIVED by fare.calculator from stored rates; there is no `farePerSeatPesewas` column.
- Trip identity = journey title + `EY-` + the random TAIL of the cuid; leading characters are a shared timestamp.
- Brand lives in the ground and edges (veil + glass chrome + accent rims), not by colouring more components.
Rejected: testing `status === 'APPROVED'` anywhere. A promo form with discountType/description/minFare — the Promotion model has none of them. Front-truncated cuids as references.
Open: nothing browser-tested. Pushes still need the APNs key; chat works only because it is a LOCAL notification.

## 2026-08-13 01:20 [saved]
Goal: Duplicate key, missing route polyline, runtime config page, skeletons, animation pass.
Decisions:
- `PlatformSetting` + `src/config/settings.js` is the override layer for every commercial knob; env is only the default and secrets stay out of the registry.
- Tunables must be read per call (getters), never captured in a module-level const from `process.env`.
- MapLibre layers are rebuilt on `style.load`, never from `styledata` — `styledata` fires repeatedly and the add races its own removal, which silently killed the trip route line.
- `?? 0` is for arithmetic, not display: an unloaded figure renders `SkeletonValue`, never a fake zero.
- The existing spring tokens (all ζ=1.0, response-derived) already exceed the "damping 26–30 / stiffness 170–190" brief — `springs.emphasized` IS that spring. Do not retune them.
- The map route reveal stays JS-driven with a fixed ~24-update budget; `ShapeSource` takes GeoJSON as a React prop, so a shared value cannot reach it.
Rejected: animating `line-dasharray` per frame on the RN map. Retuning motion.ts to the prompt's numbers. Reading `env.X` inside fare.calculator.
Open: /config not browser-tested; route reveal not device-tested. PlatformSetting table was created directly on the dev DB (migration file exists but repo gitignores migration SQL).

## 2026-08-13 [saved]
Goal: 13-item stress sweep — Skia lag, trip card, dispatch delivery, driver statuses, motion.
Decisions:
- Ambient-background ownership is navigation FOCUS, not mount order; tabs never remount so mount order stranded the shader on an invisible tab.
- Dropped LightPillar's dwell frame-rate decay; duty cycle is now visibility (`isAnimated`), constant 30fps on screen.
- `Pressable` must come from @eyego/ui, never react-native — NativeWind's css-interop registers RN's and drops `({pressed}) => style`.
- Driver polls `/rides/driver/state` every 5s while idle: offers carry no seq and have no replay, so a dropped socket frame loses the ride.
- `MOTION_PROFILES` added as an additive role-named view; existing `springs` tokens still NOT retuned (see 2026-08-06).
Rejected: mount-order background registries. RN Pressable with function styles. TACTILE_BUTTON (ζ0.78) on press-scale — breaks motion.ts's own ζ=1.0 rule for buttons.
Open: item-4 root cause unproven (poll is a safety net — check logs for "OFFER published to an EMPTY room"). NODE_CONVERGENCE not wired to map markers.

## 2026-08-13 18:40 [saved]
Goal: One morphing sheet across the rider trip stages, interlocked with the map camera.
Decisions:
- Sheet edge moves by translateY on a screen-tall container, never by animating height — layout props cost a Yoga pass per frame over a whole stage subtree.
- useMapCamera now takes a padding GETTER; the 60 Hz loop samples the sheet's live top edge off a shared value, since MapLibre padding is a native prop and cannot be a Reanimated node.
- Padding-driven fitBounds is issued with duration 0 — a live padding changes ~25x per transition and 600 ms eases restart forever.
- Stages publish panel bodies into a zustand slot store, not React context: a provider is an ancestor of the stages, so context publishing loops.
- MorphSheet reuses usePanelMotion; only new idea is a measured, re-snapped resting stop.
Rejected: animating height/flexBasis per the brief; driving MapLibre padding from withSpring; portal-via-context for the sheet slot.
Open: only assigned+tracking converted; MorphCTA has no caller yet.

## 2026-08-17 [saved]
Goal: 20-item stress sweep across rider, driver, backend and admin.
Decisions:
- `resweep()` must REBUILD its candidate list from live supply and rewind `index`; filtering by "not already seen" made a missed 45 s offer permanent.
- `supply.upsertDriver` reports the absent→present edge so a rejoining driver re-runs parked searches once, not per ping.
- Absolutely positioned children lay out against the parent's PADDING box — sheet padding therefore belongs on a content wrapper, never on the surface.
- Light mode inverts the elevation DIRECTION: cards pure white, tone in the page. Copying dark's "card lighter than page" gives a 3% step the wrong way.
- Every ETA is floored by `realisticDurationMin` (ETA_MAX_AVG_KMH, 32): routing providers answer free-flow wherever they lack congestion data.
Rejected: raising MIN_FARE_PER_SEAT to lift driver earnings (it flattens the distance curve — raise base + per-km). Silently clamping a driver's seat count to the vehicle row. Treating `safety:location` frames as SOS incidents.
Open: item 1 fix is inferred from the code path, not a reproduced offer — watch for "Dispatch re-sweeping supply" in the log. Nothing device-tested.

## 2026-08-20 12:20 [saved]
Goal: First runtime end-to-end test of the admin console; attest production readiness.
Decisions:
- Fixture set lives at eyego-api/prisma/seed-e2e-admin.js, `e2e_` id prefix; teardown matches parent keys too, because console-created children get cuids.
- One `settledRevenueWhere()` in admin.service is the only definition of settled revenue; `updatedAt` is never a revenue date.
- Image columns hold URLs only — utils/asset-url.js refuses `data:` and non-http(s) on rider+driver photo writes.
- Test the console against a production `next build`, never dev; dev masks nothing but costs minutes per page.
Rejected: trusting static audit marks for UI correctness — 3 of 8 defects were confidently-wrong on-screen numbers. Grepping "activeTrip" as proof a field is consumed (name matched, shape did not).
Open: no refund path, no CSV export, SOS alerts reach nobody from the web console.
