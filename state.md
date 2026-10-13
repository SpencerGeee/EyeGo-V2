# State — 2026-10-13 (immersive 3D pass: P1–P7 DONE + seat fare fairness; local commits, NOT pushed)

Plan docs/superpowers/plans/2026-10-13-immersive-3d-pass.md ALL DONE: P1 e36d5ec · P2 66d8b15 · P3 f2127b9 · P4 9fdb4b8 · P5 8a72dea · P6 8e9eeca · P7 ebf9389 · fare fix (next commit). Cabin render harness: scratchpad/cab (project.mjs + paint.py). NOT device-verified. Push only on approval.
All decisions D1–D8 approved by user. Diagnoses for items 1–3 verified (see plan). Push only on approval.

# State — 2026-10-12 (4-item request: sched expiry, driver uri crash, request card, share page + premium UI pass)

## 9-item device report (2026-10-12, second pass) — ALL FIXED, uncommitted, NOT device-verified
Fixes: DriverTripMap IDLE_PITCH 52/zoom 16/bus 50 · DispatchMiniMap fill = pitch 50 + bearing driver→pickup,
 seeded camera, fit ×3 · SwipeToConfirm label padded past knob, 1 line, chevrons hidden when narrow ·
 DispatchOfferCard = 3 snaps (peek/half/full) Uber-style, finger-tracked drag (worklets+runOnJS),
 sheetContentLayout/rowLayout + fades, eyebrow+fare+one meta line, ring 62, rail no longer restarts per tick ·
 SearchingPanel one-line beats, no 2nd timer, boost badge "+₵x", FareBoostRow "Boost … · 100% to your driver" ·
 perf tier: 3 probe windows (6/16/30 s), judged by BEST, published once; useMeasuredPerformanceTier ignores
 the Android shader ceiling · useDepthMotion() = the ONE 3D gate (6 call sites) · depth.ts card-deck
 (P1100, rise 84, tilt −24/+20, sink .14) + depthEnterBack/depthExit/depthEnterAfter (Keyframe.delay MUTATES) ·
 MapSheetHost panel bodies turn in 3D (stageOrder → direction) · trip.tsx every swap 3D incl. request/assigned/
 tracking, direction from TRIP_STAGE_ORDER · Configure + driver create steps: exit + back variants ·
 HeroBus Transit = drive (yaw tween to travel heading, arc, swell, bank), origin measured, mid-flight
 retarget/steer, land 'into' · seat: bus lands INTO cabin (top-down) + cabin delayed 820 ms ·
 RouteDropoffMap seeded/fit×3/pin starts on route midpoint/naming never sticks/approximate → "X km into the
 ride · Y km before Z"/map pan locks page scroll · placeFor() delegates to geo.service (right tier order),
 stops short-named + legacy ", Ghana" names healed in place · rider follow pitch eased to 46 on every stage ·
 OutcomeSheet `inline` (no Modal in OverlayPortal) · ConsentGate pointerEvents none when not required ·
 create.tsx publish → goFresh(active trip) · RidePicker used RN Pressable with a function style (unstyled
 tiles; invariant was red) → @eyego/ui Pressable.
Verified: tsc rider/driver 0 · test:maps 37/37 · invariants 2/2 · conditional-hooks · motion-invariants · API jest 209.
Open: Android freeze cause not reproduced (iOS cause = Modal-in-portal, fixed).

### Causes (as found)
1 driver home flat: DriverTripMap idle pitch hard-coded 0 (only 'course' tilts).
2 offer: DispatchMiniMap fit {pitch:0} + no camera seed; SwipeToConfirm label centred under the knob; card = badge row + eyebrow + chip row + ring + rail (busy).
3 rider request card: two timers, 2-line substatus copy, FARE label, FareBoostRow repeats boost + policy line.
4 offer peek/expand = bare boolean flip, no layout animation, drag not tracked.
5/7 3D journey gated on usePerformanceTier (JS-thread rAF probe at launch → latches 'low' → depth+flights OFF); depth 9°/28px too subtle; steps enter-only (no exit); HeroBus flight = flat sprite slide (no yaw/arc); Transit ignores provider origin (iOS modal create.tsx offset).
6 create.tsx onSuccess goOut(home) → goFresh((trip)/active/[id]).
8 RouteDropoffMap: one unseeded fit at 120 ms (discarded pre-layout) → world view "blank"; centre null until pan → button disabled; naming can stick true. "Accra, Greater Accra, Ghana" = placeNameFor (virtual stop names) asks Mapbox city tier BEFORE OSM + client ignores `approximate`. Seat bus flies to header corner.
9a rider tracking flat: TripMap overviewPitch only on configure/select; follow pitch 0.
9b driver freeze (iOS): AwayOutcomesSheet → OutcomeSheet <Modal> inside OverlayPortal FullWindowOverlay = same bug rider fixed in BoardingPinSheet (invisible presentation swallows touches).

## Current pass (2026-10-12) — committed locally (19 commits since abc3a76), NOT pushed (ask user)
Grilled: peek+expand cards · share page immersive auto-theme · maps tilt-intro + orbit-on-waits · audit-first,
 full redesigns/native OK · 3D journey = hero bus + depth page turns · auto-degrade by perf tier · Where-to
 focused (no map) · bus LANDS on pickup (never poses as a car) · driver bus tells the story.
Key commits: 8a549c4 sched settle · 867377b MLRN Images {uri} crash · 0f5a975 peek cards · 22db970/0b1ffaa share
 page + web 3D bus · 3c8871b neutral highways · 4f2bc12 puck drives road · daa9be3 tilt-in · b861ae9 RidePicker ·
 a4f1f49 invite page · d2a5685 EAS Firebase file env · e8d7532 widget pill · b04ff6d quiet live-trip channel ·
 0242c0c READ_MEDIA_IMAGES · c9337a6 abandoned sessions/vanished bookings · ff81581 rider 3D journey ·
 367d885 driver create + bus-booking path journey.
Verified: tsc rider/driver 0 · API jest 209 · test:maps 37 · static suites green · web pages in real Chrome.
NOT device-verified: every RN visual (HeroBus flights, depth turns, RidePicker, Where-to, driver create).
User must: push approval · eas env:create GOOGLE_SERVICES_JSON / GOOGLE_SERVICE_INFO_PLIST (type file) per app ·
 new EAS builds (widget, permissions, Firebase) · Play declarations (background location, contacts).

## Decisions (grilled with user 2026-10-10)
- Inbox (both apps) = away-outcomes.service facts over 30 days in the sheets' words; read state per device.
- Late-cancel / no-show fee → driver minus commission (CANCELLATION_FEE ledger row).
- Wait fee: hailed only; free minutes + cap are settings; RATE = tier card RIDE_<T>_WAIT_PER_MIN_PESEWAS (existed, never charged).
- Mid-trip destination / stops: hailed only, rider re-quotes, no driver consent; Trip.dropoff = NEXT place, Trip.onwardStops = queue.
- Fatigue 12 h / 6 h break; referral rider→rider (GH₵10 each after first paid ride); lost item → driver; cash change → wallets.
- Ride prefs (quiet/AC/luggage) + pickup note; providers key-gated: Resend email, AT voice masked calls, selfie check.

## Commits (main, local only)
622288a inbox+away · 30bc069 cancel/wait fee · a9387e8 cash change · 1c83d04 prefs+note · d844a85 route change
7455014 expiry-spam fix + departure reminders · 361b7bc fatigue · f8d4f31 referrals · 9f74491 lost items
084c0aa email receipts · 76748cb masked calls · eb68e42 selfie check

## Bugs found & fixed on the way
- Driver SOS ticket used userId=driverId (User FK) → never created (ticketUserFor).
- Every rider dispute 404'd (trip id posted as booking id).
- Doc-expiry sweep re-pushed hourly for 30 days (~720 pushes/doc) → expiryNoticeDays.
- SupportTicket.driverId ambiguity (own ticket vs rider dispute about driver) → phone discriminator.

## Verification
tsc rider/driver/admin green; API jest 178 pass / 3 fail (PRE-EXISTING stale mocks: payments.service, concurrency.webhook,
bookings.e2e — fail identically on bf3abc1); static e2e invariants all green; server e2e suites not run (no local API).

## Hidden-bug hunt (2026-10-11, user: "find all the hidden bugs before pushing")
Method: hunt by bug CLASS with scratch scripts (scratchpad/*_audit.js), verify each hit by hand.
Clean classes: client→server route match, route shadowing, socket emit/listen, swallowed writes,
req.user.id, enum literals, missing await, async filter/forEach, nav targets (button-wiring).
Fixed (db67b00): scheduled rides → dead TripRequest engine; scheduled seat SEAT_HELD vanishing +
confirmedSeats leak; wrong-trip receipt/rating via store activeBooking; 11 env-reads of console knobs.
Fixed (0e58681): driver top-up + payout reversal double-credit race (FOR UPDATE row lock); 3 stale suites → API jest 181/181.
Fixed (5cf6083): passenger chat leaked to browsing riders (trip:<id>:chat room); cash-change + route-change double-apply;
  FCM raw fetch ignored 401; WALLET_CREDITED/DISPUTE push taps.
Fixed (a6d62fa): away/inbox seen-state per account, not per device.
Checked clean: refunds (cash excluded, claim-once), rider top-up claim, settleTip, IDOR on receipts/booking/contact/events,
  room-join auth, my new endpoints' ownership.
Fixed (cfbc391): boarded cash commission never returned when a trip ends undriven.
Not re-audited this round (covered by earlier passes per memory): auth refresh, cover-all group.
Final: tsc rider/driver/admin 0, API jest 181/181, static e2e all green, prisma valid. PUSHED to main.

## User must do
1. `npx prisma migrate deploy` (migration 20261010120000_parity_pass) — boot refuses pending migrations.
2. Optional keys: RESEND_API_KEY, AT_VOICE_NUMBER (+ AT voice callback → /v1/contact/voice), DRIVER_SELFIE_CHECK_HOURS.
3. Push when ready (asked).

## Device-test watch list (new)
- Away sheet: no repeats of live banners after background/foreground; inbox badge clears.
- Wait meter at hailed pickup; receipt 'Waiting time' line.
- Change destination / add stop → driver banner + 'At the stop — continue'.
- Cash change sheet; referral share/redeem; lost item → driver Lost items → rider push.

## Thoroughness pass (2026-10-11, user: "check all the other places you haven't checked")
- Local stack up (docker pg+redis, migration applied). Full harness: 526/526 checks, 28/28 suites GREEN.
- Fixed 0172623 (socket trust): payment_confirmed relayed blind (told drivers cash riders had paid); join_trip_room
  streamed ANY client-named driver's location; rider private chat to client-named recipient; SOS location
  overwritable by any rider; unauthenticated driver:seat_updated relay deleted; typing/chat:read gated; dead listeners removed.
- Fixed 84ea60f: earnings report now nets COMMISSION_REFUND.
- jest 181/181 at that point; superseded by the hunt below.

## Ownership-class hunt (2026-10-11, user: "hunt the bug class of the ownership check")
Method: scratchpad analysers (owner_audit 1-4, transition_audit, admin_routes_match, unwrap_audit) +
hand-verify every hit. Sub-shapes found: client-named ids trusted · "any booking row" as membership ·
nullable-owner `x.userId && x.userId !== me` · a second verb with weaker guards · gateway reference not
bound to caller · personal fields in ROOM frames.
- 3c0251f: /rides/:id/cancel let any booking-holder (even cancelled) cancel a whole BUS; GraphQL trip had no
  login + exposed driver phone/wallet, subscription refused owning driver; claimReassignedTrip bypass deleted
  (REASSIGNING → acceptRide); masked calls on ended trips; driver map reports readable; lost item on cancelled seat.
- 3a90847: group cover-all by a seatless stranger held every seat; card-save verify saved ANY reference's
  card to the caller; admin notes retractable by any admin; dead confirmTopUp removed.
- 2824114: "Unsafe driving"/"Rude conduct" disputes were pushed to + readable by the accused driver → SAFETY.
- 5840511: /rides/:id/start skipped the wait fee → delegates to departTrip. NEW e2e parity-features.mjs.
- 4636c51 admin Retract gated · 75055c7 receipt NEVER loaded in the app (validated the envelope) ·
  126bc89 room frames leaked driver/guest phones + every passenger's name/fare to bus BROWSERS; masked
  calling now real (callable flag + /contact/call); /trips/:id/contact deleted; subscribe/join on live seats only.
Verified: API jest 187/187 · harness 557/557, 29/29 suites · tsc rider/driver/admin 0 · admin console
calls all match routes · auth refresh rotation + logout revoke reviewed clean · cover-all via party-boarding.
Known, not a bug: /admin live-map socket uses the shared ADMIN_SECRET_KEY (documented transitional login).

## Hardening pass — 8 bug classes (2026-10-11, user: "hunt all of 1–8, fix everything", no subagents)
Commits: a3cb8b3 over-posting + abuse limits · d436712 input bounds + socket crash · 4521963 races ·
63d0a36 multi-instance jobs · 59d44b8 XSS + CSV · 90e0360 unbounded lists · 3198cf2 deps ·
2816792 production rate limits · c084998 acceptance rate.
- CRASH: one empty socket emit killed the API (listener throw on nextTick = uncaughtException → exit).
  sockets/middleware/guardListeners.js wraps every listener. Drivers could never trip:subscribe
  (resume.socket read socket.driverId, never set). Driver handlers registered after a DB await.
- MONEY: a finished ride could be "cancelled" for a full refund (occupying ≠ cancellable →
  riderCannotCancel). Double cancel refunded twice; confirmPayment could resurrect a cancelled seat;
  cash board / offline OTP / no-show charged or paid twice; admin refund cap ignored auto refunds and
  wasn't locked. All are claims now (conditional updateMany or FOR UPDATE).
- INPUT: phantom seats (seat 99), string pins skipped the deviation fee; 10k-char/1k-item body cap;
  ?limit clamped to 100 (admin excluded); GPS/SOS coords bounded.
- MULTI-INSTANCE: scheduled rides seated twice; every sweep now takes a Redis lease per tick.
- XSS: /track/:id and /invite/:token reflected the URL into an inline <script>.
- LISTS: driver trips tab loaded every trip ever; ratings + admin analytics summed in JS.
- DEPS: admin next 15.1.6 → 15.5.27 (critical RSC RCE + middleware auth bypass); API 4 critical → 0.
- RATE LIMITS (production-only, hidden by dev mode): 100 req/15 min per IP would have 429'd online
  drivers within minutes and everyone behind a carrier CGNAT; now per verified user/admin.
Verified: harness 572/572 (30 suites) + hardening.mjs 16/16 after its last check was added · jest 203/203 · tsc rider/driver/admin 0 ·
admin `next build` green · purge + reset-pool run, local DB clean.
Not changed (needs live verification): firebase-admin 12→14, @sentry/node 10→11, africastalking 0.7, jest 30.
Behaviour now live in production: the go-online acceptance gate (<30% over ≥10 offers, 30 days) has real data.
