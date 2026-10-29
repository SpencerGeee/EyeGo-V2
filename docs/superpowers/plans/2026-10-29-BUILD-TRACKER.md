# BUILD TRACKER — 2026-10-29 full build

Source of truth for what is done. Update after every item. Specs:
`2026-10-29-review-pack.md` (decisions), `2026-10-29-client-meeting-gaps.md` (Phase A detail),
`docs/research/2026-10-29-visual-teardown.md` §7 (Motion & Card Spec v2).

Accepted on review: D1–D8, G1–G5, Q6, Q7, Q10; Q8 = recommendation (server text/sections, native layout);
Q9 = recommendation (auto-pause after 3 consecutive missed offers, reason shown, one-tap resume).

Verify gate per phase: `node node_modules/typescript/lib/tsc.js -p apps/rider|driver|admin` · `yarn test` ·
`cd eyego-api && npx jest` · static e2e. One commit per phase. NO push without the user.

## Phase 0 — confirmed bugs + bus-only
- [x] 0.1 B1 mid-ride offers: `eta.etaMinutes` → `etaSeconds` (+ invariant: eta.* calls name real exports)
- [x] 0.2 B2 matcher filters `seaterCount >= party`
- [x] 0.3 Android Skia background sized from container layout (LightPillar + AppBackground blobs)
- [x] 0.4 Bus-only: MIN_VEHICLE_SEATS = 6 (API validation + driver onboarding), reviewer fixture 14 seats, saloon/van cabin layouts removed — DONE 286ee70 (cabin layouts go with Phase E)
- [x] 0.5 Private ride priced as whole vehicle × `PRIVATE_RIDE_MULTIPLIER` (setting, default 1.2); `RIDE_INCLUDED_SEATS` saloon model retired

## Phase A — join a moving bus (items 1, 6, 7)
- [x] A1 `utils/segment-seats.js` + jest
- [x] A2 Booking.boardRatio/alightRatio/stopArrivedAt + migration; priceSeat returns ratios; bookSeat writes them
- [x] A2b Corridor model + Trip.corridorId/corridorSeatPricePesewas; `fullSeatFarePesewas()` single reader; createTrip pins
- [x] A3 `services/trip-position.service.js` busRatioFor + jest
- [x] A4 bookSeat: running trips, span capacity, BUS_PASSED_STOP, mid-route prepaid, ETA-bounded hold, seatNumber optional
- [x] A5 searchTrips: running trips, polyline+direction, span seats, ETA, segment fare; rider rows "Passing your stop in N min · K seats · ₵X"
- [x] A6 POST /driver/trips/:id/stops/arrive + riderNoShow grace (NO_SHOW_GRACE_MINUTES=3) + resale
- [ ] A7 driver stop timeline progress by ratio (busRatio on snapshot) — DEFERRED (needs busRatio on the driver snapshot; lower demo value)
- [x] A8 trip-notify.notifySeatPassing + 60 s sweep + rider listener + "tell me when a bus passes"
- [x] A9 invariants + verify + commit + state/session-log

## Phase A+ — walk-up boarding (Q10)
- [x] Per-trip 4-char boarding code; POST /bookings/walk-up + GET lookup; rider "Board" quick action + code screen; driver manage card shows the code {code, dropoff}; prepaid; same span pool; driver timeline shows walk-ups; rider "Board with code" entry

## Phase O — offer protocol v2 (Q7) + driver eligibility (Q9)
- [ ] DispatchOffer identity (offerId), ACK, discardAfter, minimumViewMs, expiringSoonMs, accept carries offerId + GPS, stale → 409 OFFER_INVALID
- [x] Auto-pause after 3 consecutive missed offers → requestsPaused + push with the reason; reset on accept/pass; resume = existing Pause Requests switch
- [ ] Offer card text/sections from server (Q8)

## Phase P — rider live sync floor (Q6)
- [ ] Versioned snapshot polling 2 s searching / 5 s riding / 4 s otherwise, served from Redis snapshot

## Phase B — first screen + Card/Motion Spec v2 (items 8, G2, G3, G5)
- [x] Home: Book a seat / Whole bus / Private bus → trip.tsx `product` (seat → bus list with auto-search; bus → group flow, full party; ride → configure)
- [ ] Flat card system per spec §7 (tokens, rows 76 dp, outlines 2/1 dp, no glass on sheets)
- [ ] Transition matrix (named per rider-phase pair) + height+opacity reveal
- [ ] Tier pick: in-place bus turn (G2)
- [ ] Splash: Reanimated brand intro (G5), both apps
- [ ] Driver offer countdown as rounded bar

## Phase C — shared vs private (item 2)
- [x] Shared = "a bus is heading your way" card above the private picker (Yango AUTO_SHUTTLE pattern): seat price, opens the bus list; no bus → the private picker (whole bus × multiplier) is the fallback
- [ ] (detour version, needs driver consent) Shared eligibility branch (drivers on trips heading the rider's way with span seats) in driver-availability + cascade kind SHARED_SEAT; accept → bookSeat on host trip; placeholder trip CANCELLED (MERGED_INTO_TRIP)
- [x] NO_SHARED_BUS → private picker shown (private = whole vehicle × multiplier, 0.5)

## Phase D — charter + N seats (items 3, 4)
- [ ] Charter product (party = capacity, private pricing, door to door) + "book the return"
- [ ] bookSeat seats: N (one row, one pass/QR), driver shows "N passengers · 1 booking"

## Phase E — seat map removal (item 5, D1)
- [ ] ride/[id] → seats stepper → drop-off → payment; Cabin3D out of the path; client stops sending seatNumber

## Phase F — supply + admin (item 9)
- [ ] Driver "Repeat last run"
- [ ] PulseSchedule materialiser (B4)
- [ ] DemandSignal (searches with 0 results) + admin /demand (stop/corridor × hour) + corridor CRUD

## Final
- [ ] state.md + session-log.md + memory; full verify; report what is NOT device-verified
