# State — 2026-11-22 — mobile-agent-testers setup (IN PROGRESS)
Goal: ONE Claude agent drives 2 iOS sims (rider iPhone SE 3rd gen, driver iPhone 16 Pro) on a GitHub macos-15 runner, full functional test.
Decisions (grilled, user-approved):
- Backend runs ON the mac runner: brew postgresql@17 + redis, eyego-api NODE_ENV=development (app shows _dev_otp), API http://localhost:5020/v1.
- Secrets user sets: MAPBOX_SECRET_TOKEN, MAPBOX_PUBLIC_TOKEN, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET. No Paystack -> PAYMENT_PROVIDER=mock (MoMo auto-accepts; card checkout = dead example.invalid page, test the close/fail handling). AT_*/PAYSTACK_* need dummy non-empty values (env.js zod min(1)).
- Repo: SpencerGeee/eyego-testers (public, from template, cloned at ../eyego-testers). User runs setup.ps1 THEMSELVES (Claude token + key pair). Never read ~/.mobile-agent-testers.
- Runs: 2 core-ride, 3 things-going-wrong, 4 group/seats/scheduled on OPUS (user has Pro plan -> one run per 5h window). Runs 5 money, 6 profile+dark/large-text sweep LATER on Sonnet. Run 1 signup SKIPPED (seed driver: verify + /driver/dev-activate; rider signs up in-app).
- 4h job timeout; agent rewrites findings.json + progress.md after EVERY finding (usage-limit safe, next run resumes).
- Between runs: user decrypts (bash scripts/collect.sh <id>); I verify each finding vs screenshot+code; fix bugs, tsc+hooks+e2e, commit+push main; missing features -> list for user.
Done:
- EyeGo .github/workflows/ios-sideload.yml: workflow_call (app, api-url, sdk, ref) + sdk=iphonesimulator path -> artifact `<app>-sim-app` (<app>-sim.zip). NOT committed yet.
TODO (tester repo):
- .github/workflows/eyego.yml: build-rider/build-driver = uses SpencerGeee/EyeGo-V2/.github/workflows/ios-sideload.yml@main; test job macos-15 timeout 240.
- scripts/eyego/{backend.sh,seed.mjs(plain fetch, fixed 12-digit phones, driver ACTIVE),phone.sh (rider|driver wrapper: sets UDID/APP_ID + per-phone RUNNER_TEMP; gps/drive-to via simctl location start),run_agent.sh}
- patch scripts/ios/screen.py + gesture.sh: height memo per RUNNER_TEMP (width memo already per RUNNER_TEMP).
- briefs/eyego-{common,core-ride,things-wrong,group}.md (screens listed in session; 59 rider / 36 driver routes).
- results/<run>/{findings.json,report.md,progress.md,rider/NN.png,driver/NN.png,api.log}; encrypt via scripts/encrypt_results.sh <run>.
- Then commit both repos, push, tell user: run setup.ps1, gh secret set x5, gh workflow run eyego.yml -f run=core-ride.
Notes: context-mode 2.2.1 truncates Read of big files — use Read offset/limit.
UPDATE 21:00Z: harness WORKS end to end (run 45056196522, results in ../eyego-testers/runs/45056196522). core-ride blocked: RIDER CRASHES ON FIRST LAUNCH (SIGABRT, worklets::scheduleOnUI -> Hermes throwPendingError, a UI-thread worklet throws). Suspects: fresh-install-only screens 39673e7 onboarding particle field (ParticleHero useBand/interpolateColor) / b589cb9 (auth)/_layout sign-in scene; colours checked valid. Driver findings: #2 signed-out on relaunch (likely unsigned-sim Keychain = harness, now ad-hoc codesigned), #3 seeded driver forced through onboarding/no vehicle (seed lacks docs? check), #4 Earnings biometric -> passcode prompt no Cancel, #5 terms links eyego.app unreachable (needs live site pre-submission), #6-14 minor.
Smoke run 45066272483 (run=smoke: no agent) started to capture <who>-syslog.txt + crashes/*.ips -> read JS error, fix, then rerun core-ride.
User decrypts with: & "C:\Program Files\Git\bin\bash.exe" scripts/collect.sh <id>   (PowerShell `bash` = WSL, no gh).
UPDATE 21:45Z: crash narrowed: fresh install -> index.tsx -> (onboarding) (eyego_onboarded unset); crash ~5s = first AUTOPLAY slide change (3200+900ms) -> BlurWordText exiting FadeOut + Keyframe entering and/or ParticleHero morph; .ips has no JS message (worklet throw in scheduleOnUI). Not Model3D, not vec, colours valid. User's phone never saw it (keychain flag survives sideload reinstall). Harness: apps_from_run=45066272483 skips builds; rider REDUCE_MOTION_RIDER=1 workaround; smoke pages slides by hand -> launch.txt alive/DEAD. Smoke 45073322095 running.
UPDATE 23:30Z: REAL crash = phone.tsx withOpacity in useAnimatedStyle (stderr capture showed "Object is not a function at phoneTsx1"); FIXED EyeGo 377c11d (withOpacity is a worklet). Harness now: unsigned builds (ad-hoc signing hung simctl), phone.sh open/relaunch = background simctl launch with lifelong --stdout/--stderr capture, parallel sim boot (~8 min each), smoke cap 25 min. Fixed builds = run 45076594057. core-ride run 45083125606 started 23:30Z (apps_from_run=45076594057). Next: if alive -> core-ride (fresh Pro window); fix onboarding in EyeGo (needs rebuild + REDUCE_MOTION_RIDER=0 smoke to verify).
UPDATE 2026-11-23 10:30Z (user away, asked: decrypt myself, loop till harness works): core-ride 45083125606 hit 225-min cap at scenario 4/12; runner overloaded (rider screenshot ~3 min apart, boot 9 min + FIRST LAUNCH 12-14 min). Decrypted (collect.sh works from Bash tool). Triage: #1/#3 = seed used 233… but app sends +233… -> app made a 2nd unseeded driver (seed fixed ad8212a). #2 Earnings passcode sheet = simulator has no Cancel -> EXPO_PUBLIC_SIMULATOR_BUILD skips gate (EyeGo 1835728, needs rebuild). #22/#23 likely tier mismatch (Comfort req vs ECO car) -> brief says request Economy. OPEN: #21 tap on request card opened DestinationModeCard picker (not explained), #16 configure-stage map blank (zoom 23), #20/#24 fare drift 53.38/53.54/53.46 + driver 46.04, #15 autocorrect (prefs not applied?), layout #6-8 #18. Harness fix in test: prefs pre-boot (no reboot), no log stream, timings -> smoke 45154229227.
UPDATE 11:55Z: runner load ROOT CAUSES fixed in eyego-testers: debug log streams removed, prefs written pre-boot (no 2nd reboot), crash-looping sim daemons (TypeToSiriWidgetExtension/searchd -> spindump) booted out in background, host mdutil off, no terminate on first launch. Smoke 45159992690 (fresh builds incl. EyeGo 1835728 sim gate + 7dfdb04 autocorrect/greeting) = launch 40 s, screen 5-11 s. Load avg ~700 is boot disk I/O, not CPU. core-ride 45169396506 started 11:55Z with apps_from_run=45159992690.

UPDATE 2026-11-26 14:30Z: core-ride 45814292257 (cancelled by hand at 59 min, scenario 3/12; boot to both phones up 7 min). 13 findings in runs/45814292257 (not yet triaged vs code: 2-seat price = 1-seat, doorstep +5 not added, cash-only booking, SE layout cuts). Dispatch: first offer reached driver socket + ack, arm.py never saw "Swipe to accept" (no driver screenshot to confirm render), offer lapsed; then resweep dropped the re-offer silently = withLock/setImmediate race, FIXED cd90199 (+ resweep-retake.test.js), jest 248 green. API CI red since >=10-12 (sqlite file: URLs vs postgres schema, DIRECT_URL) - pre-existing, untouched. Next: rerun core-ride.
UPDATE 15:20Z: rerun core-ride 45838978641 RUNNING (apps_from_run=45159992690 = OLD app build, backend = main incl. cd90199; arm.py now logs every poll + driver/arm-*.png). Triage of 13: fixed+pushed fb1fe5c (consent gate in-app docs + "Before you continue", no intro replay after register, Activity CTA contrast, RidePicker SE wrap, driver Create Trip above destination card, earnings Top up/Cash out row, geo text dedupe, DOB picker Done/commit, phone a11y label). NOT bugs: #1 doorstep fee is in the first quote already + party<=included = one car (by design) + pesewa drift = live duration; #2 cash-only on-demand = product decision (user list); #6 = seed has no docs. Brief scenario 11 now MoMo top-up (05b1f46). fb1fe5c needs a FRESH app build: next run with apps_from_run empty.

UPDATE 2026-11-26 18:00Z: core-ride 45838978641 DONE (10/12, runner stalled at end; OLD app build). 26 findings. FIXED: driver mid-trip logout = /rides/:id/events rider-only auth (1206/1206 driver polls 401 -> refresh every 5 s) + 15 s refresh grace < client retry (now 60 s, logout deletes row); acked offers pulled at 60 s = ackOffer withLock dropped while offerNext held lock (now own redis key); rider rate/tip 'Could not identify your booking' (id from snapshot.booking). Seed now tops up driver wallet GH₵200. OPEN to triage: #4 marker/ETA frozen, #6 share link ENDED, #5 'Paid' on cash, #24 Today GH₵0, #26 Fare/Seat, #3 PIN (old build?), #11 'unfinished trip' after accept. Next run needs FRESH builds (apps_from_run empty).

# State — 2026-10-30 PM — teardown proposals pass DONE (10 local commits 62716c4…b0d5ce9, NOT pushed, NOT device-tested)
Source: docs/research/2026-10-29-visual-teardown.md §6–7 + 2026-10-29-uber-bolt-teardown.md §3 + §2g (Yango ideas).
Yango feel: 62716c4 inline ride card (SelectStage InlineRideDetails) + Reveal (packages/ui motion/Reveal.tsx) + full
 STAGE_TRANSITIONS + durations ladder + RidePicker unavailable rows · af6cb1f Celebrate/WalkDots (motion/SignatureMoments)
 · b0d5ce9 skeletons on the booking path. Radar = existing SearchingIndicator. Sheet height→map = existing SheetMetrics.
Yango ideas: 83e93ea Y3 BookByPhone (SUPPORT_PHONE) + Y2 VirtualStop.landmark (admin Demand page edits it) ·
 55e22d7 Y4 useLiveBuses + Y1 walkM on suggestedPickupStop + doorstep saving in cedis.
Uber/Bolt logic: 96c932b L1 offer-ack (+DISPATCH_OFFER_ACK_GRACE_SECONDS, old apps exempt, offer-ack.test.js) ·
 edd78b5 L3 offerChips → driver card chips + server button words · 8ed638c L9 auto stop-arrival in driver.socket
 (15 s gate) + PICK UP n / DROP OFF n. L6 = already built (driverLinkLostSinceMs).
NOT done (deliberate): Yango fullscreen-at-90% snap (sheet caps at 88%); per-stop radius is ONE knob (ARRIVAL_RADIUS_M).
Verify: tsc x3 0 · jest 245 · maps 37 · invariants 6 · static e2e 87 · prisma valid. Live e2e not run.
USER MUST: prisma generate + migrate deploy — THREE pending: 20261029120000, 20261029130000, 20261030120000_stop_landmark.

# State — 2026-10-30 (client meeting full build — DONE except the deferred detour variant; 21 local commits, NOT pushed)

All tracker phases 0/A/O/P/B/C/D/E/F/G built (286ee70 … c325ee8 + ParticleHero loop gate). Deferred, not built: Phase C
 detour version (SHARED_SEAT cascade kind, needs driver consent).
Final verify 2026-10-30: tsc rider/driver/admin 0 · API jest 242 pass/7 skipped · test:maps 37/37 · invariants 6/6 ·
 static e2e 87/87 (ui/conditional-hooks/motion/ux/maestro/button-wiring/prisma-fields/shader/h3/formatters).
 Live e2e suites NOT run (need the local stack up). NOTHING device-tested.
USER MUST: stop the local API, `npx prisma generate`, `npx prisma migrate deploy` — TWO migrations:
 20261029120000_client_meeting_build + 20261029130000_pulse_schedule_driver. Splash/native changes need a new store build.

# State — 2026-10-29 (client meeting full build — IN PROGRESS; tracker = docs/superpowers/plans/2026-10-29-BUILD-TRACKER.md)

Specs: review-pack + client-meeting-gaps (docs/superpowers/plans/2026-10-29-*), visual teardown §7 (Motion & Card Spec v2).
Decisions: D1–D8, G1–G5 (MIN 6 seats), Q6 polling floor yes, Q7 offer v2 yes, Q8 server text/native layout, Q9 auto-pause after 3, Q10 walk-up yes.
Commits (local, NOT pushed): 286ee70 phase 0 · a44e56c phase A1 (segment seats, bookSeat running, corridors, seatFareData) ·
 a031a95 phase A2 (search running buses, no-show grace, seat-passing push, walk-up API) · 5014bd6 home product picker + walk-up UI.
Verified each step: API jest 239/239 · invariants 5/5 · tsc rider/driver 0.
USER MUST: stop the local API, `npx prisma generate`, `npx prisma migrate deploy` (20261029120000_client_meeting_build).
NEXT (tracker order): Phase O offer v2 + auto-pause · P polling floor · B rest (flat cards, transition matrix, tier turn, splash,
 countdown bar) · C shared/private · D charter return + N-seat driver row · E seat map out · F repeat run, PulseSchedule
 materialiser, admin demand + corridor CRUD. A7 deferred. Nothing device-tested.

# State — 2026-10-22 (12-item pass: onboarding/auth, cards, morph reset, 3D maps, seat page)

Grilled decisions: D1 morph = strip to 2 rules (delete HeroBus flights, depth turns, Cascade, StageSweep;
 keep ONE card->screen container transform + ONE sheet stage transition: height spring + content fade-through;
 3D bus/cabin = static content only). D2 card system = own engine on usePanelMotion (measured section detents,
 finger-tracked), both apps. D3 brand = Geist + #4be277 for splash/onboarding/auth. D4 order = rider booking
 path first (seat page -> morph -> live card + 3D maps), driver, onboarding/auth last. No subagents. No DB probes.
Done (local commits, NOT pushed): ec9fb74 swipe stuck · e751ecc one seat price list->payment · c9921c1 picker race + OSM/Photon reverse.
Research: Reanimated 4.2 SET = not production; Material container transform = persistent container + fade-through.
Then: d9e96c6 seat page + SnapSheet + Cabin3D UI-thread orbit · 9eb44eb morph reset (HeroBus static, depth=fade-through, Cascade inert)
 · b5120f9 rider request/assigned/tracking on one SnapSheet via SheetSections · 741b055 driver dispatch on SnapSheet
 · 412cfd6 useShowcaseCamera + driver camera seed frozen · 39673e7 onboarding particles · b589cb9 splash + auth scene.
 ALL 12 ITEMS DONE. tsc rider/driver 0, static e2e checks green, test:maps 37/37. NOT device-tested, NOT pushed (ask).

# State — 2026-10-13 (immersive 3D pass: P1–P7 DONE + seat fare fairness; PUSHED 27984e1)

Plan docs/superpowers/plans/2026-10-13-immersive-3d-pass.md ALL DONE: P1 e36d5ec · P2 66d8b15 · P3 f2127b9 · P4 9fdb4b8 · P5 8a72dea · P6 8e9eeca · P7 ebf9389 · fare fix (next commit). Cabin render harness: scratchpad/cab (project.mjs + paint.py). NOT device-verified. PUSHED 2026-10-13.
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
