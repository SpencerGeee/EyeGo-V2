# EyeGo Review Pack — 2026-10-29

One place to review before the full build starts. Three inputs:
1. the client meeting (gap plan: `2026-10-29-client-meeting-gaps.md`)
2. device bugs reported 2026-10-29
3. the Uber Driver / Bolt rider teardown (`docs/research/2026-10-29-uber-bolt-teardown.md`)

Nothing here is built yet. Every line marked **OPEN** needs your answer; everything else is a decision
already made with you, or a fact from the code.

---

## 1. Decisions already locked

| # | Decision |
|---|---|
| D1 | Seat map removed from the booking path; seats are a count |
| D2 | Private ride = ride card × `PRIVATE_RIDE_MULTIPLIER` (setting, default 1.2 — placeholder until the clients give a number) |
| D3 | Shared add-on to a bus heading your way: the driver accepts each one |
| D4 | Whole-bus charter = ride card with party = vehicle capacity (also private, so D2 applies) |
| D5 | Operator-fixed corridor seat prices, pinned on the trip at publish |
| D6 | No-show grace 3 min after the driver marks "at stop" |
| D7 | "Book N seats" on seat trips **and** on-demand |
| D8 | Joining a moving bus must be prepaid; cash stays at the origin |
| G1 | Group-trip crash: capture logcat when the Android phone is back, then fix |
| G2 | Tier pick: bring back only the in-place bus turn (no cross-screen flights) |
| G3 | Cards: keep SnapSheet mechanics; rebuild look + layout flat, Uber/Bolt-style |
| G4 | **Bus-only, minimum 6 seats per vehicle**; saloon pricing + saloon/van cabin removed |
| G5 | Splash: ~1.2 s Reanimated brand intro, skippable, cold start only, no Skia at launch |

---

## 2. Bugs

| Bug | Status | Root cause / evidence | Fix |
|---|---|---|---|
| Android Skia background mis-scaled | **Cause found** | Canvas sized from `useWindowDimensions()` (excludes system bars on Android) but centred in a full-screen container — `LightPillarBackground.tsx:297,433-442`; blobs same `AppBackground.tsx:131` | Size from container `onLayout` |
| Tier pick no longer animates the bus | **Cause found (deliberate)** | Removed by the 10-22 morph reset `9eb44eb` | G2: in-place turn only |
| Morph never works | **Needs device** | (a) Reduce Motion / "Remove animations" skips it by design `MorphProvider.tsx:449`; (b) since `b5120f9` stage content is portalled into `MapSheetHost`, so the landing target may never report → clone times out and fades | Check (a) on the phone; add a dev log on `targetReady` timeout; fix (b) by registering the target on the SnapSheet surface |
| Rider crash selecting a group trip | **Needs logcat** | Static suspects ruled out (degenerate fit is guarded `packages/maps/src/index.tsx:582`; helpers exist) | Reproduce with logcat |
| Android driver crash on first open + close | **Needs logcat** | Suspect: root UI-thread frame loop (`useFrameCallback`) ticking while the activity is destroyed on Back. Background location is configured correctly (`app.json:87-106`) | Test Back vs Home; stop frame callbacks on `AppState` background |
| Mid-ride ("queued") offers never fire | **Confirmed** | `eta.etaMinutes` doesn't exist; TypeError swallowed — `driver-availability.js:216-222` | Use `eta.etaSeconds` |
| Party can be sent a vehicle too small | **Confirmed** | `seaterCount` selected, never compared — `matcher.service.js:281,360-366` | Filter `seaterCount ≥ party` |
| Driver stop timeline stuck on first drop | **Confirmed** | No alight state — `useTripStops.ts:165-170` | Ratio-based progress (Phase A7) |
| Admin schedules publish nothing | **Confirmed** | `PulseSchedule` only read — `trips.service.js:690` | One materialiser (Phase F1) |

---

## 3. Client-meeting gaps (detail in the gap plan)

| # | Ask | Verdict |
|---|---|---|
| 1 | Join a bus already on the road; resell freed seats | MISSING |
| 2 | Shared vs private on-demand | PARTIAL (private exists) |
| 3 | Whole-bus charter + book the return | PARTIAL |
| 4 | N seats, one total, no app needed | PARTIAL |
| 5 | No seat picking | EXISTS (opposite) — D1 removes it |
| 6 | Pay first, no-show releases the seat | PARTIAL |
| 7 | Premium segment pricing, corridor prices | PARTIAL — D5 |
| 8 | Three products on the first screen | MISSING |
| 9 | Launch corridors, demand view, repeat runs | PARTIAL |

---

## 4. Uber / Bolt parity — what they do vs what we do

Evidence is static (decompiled network models). "Theirs" is observed; "Proposal" is a design choice.

### 4.1 Driver offer protocol
| Topic | Uber (observed) | EyeGo today | Proposal |
|---|---|---|---|
| Offer identity | `offerUUID` separate from `jobUUID` | trip id is the offer | **MISSING** — `DispatchOffer` row/key with its own id; accept/reject must name it; stale id → 409 `OFFER_INVALID` |
| Receipt ack | `ACKNOWLEDGE` verb | none | **MISSING** — client acks on render; cascade can tell "never delivered" from "ignored" |
| Deadline | absolute `expiresAtEpochMS` | absolute `expiresAtServerMs` + `serverNowMs` skew (`dispatch-cascade.service.js:718`) | **EXISTS** |
| Late delivery | `discardAfterEpochMS` | a late push can still render briefly | **MISSING** |
| Flash offers | `minimumViewTimeMS` | none | **MISSING** |
| Expiring soon | `expiringSoonWindowMS` state | ring only | PARTIAL |
| Backgrounded expiry | `backgroundedOfferConfig` | Pass vs Timeout handled server-side | PARTIAL |
| Delivery | push + poll, `SourceType` recorded | socket + FCM + 2 s REST poll | EXISTS (record source: add) |
| Accept payload | offer id + **driver GPS** + counter-fare | trip id | PARTIAL — send GPS, recheck distance |
| Reject payload | reason + **block this rider** | reason | PARTIAL |
| Offer while finishing a trip | `isForwardDispatch` | mid-ride window (dead — bug) | Fix bug B1 |
| Broadcast / first-accept-wins | `MATCHED_TO_ANOTHER_EARNER`, Trip Radar | backlog decision "broadcast first" | Use for item 1/2 (shared add-on) |
| Read aloud / chime | TTS + chime config | sound only | Optional |
| Card content | server-driven sections | hard-coded card | **OPEN Q8** |

### 4.2 Driver eligibility
| Topic | Uber | EyeGo | Proposal |
|---|---|---|---|
| Status | DISPATCHABLE / NON_DISPATCHABLE(reason) / BANNED | eligibility in `driver-availability.js`; `explainIneligible` admin-only | Expose the reason to the driver on the home screen |
| Unresponsive | auto-pause `UNRESPONSIVE_SESSION` | acceptance-rate gate at go-online; decline cooldown | **OPEN Q9** |

### 4.3 Driver trip
| Topic | Uber | EyeGo | Proposal |
|---|---|---|---|
| Model | job → waypoint → task | Trip + bookings, stop timeline derived client-side | Server sends stops with per-stop tasks (board N, PIN, drop N) — fits buses perfectly |
| Auto-arrive | per-task `distanceThresholdMeters` | one geofence setting | Per-stop radius |

### 4.4 Rider flow (Bolt)
| Topic | Bolt | EyeGo | Proposal |
|---|---|---|---|
| Pre-order states | 15 explicit screen states incl. **ConfirmPickup after ride choice**, **AllDriversAreBusy with 1-tap retry** | stages search/configure/select/request/… | Add ConfirmPickup + busy-retry state |
| Order states | 8, driver refusal is a flag | 15 TripStatus values shown through mapping | Keep server states; collapse rider-facing view to ~7 |
| Live sync | **versioned polling 1 s / 4 s / 2 s** + MQTT location; `retryTime`, `driverGpsIssue`, walking path | socket-first, 5 s recovery poll only when socket down | **OPEN Q6** |
| Ride-type row | unavailable rows stay, greyed with reason; per-row CTA; badges; detail per sheet detent | tier cards | Adopt in the card rebuild (G3) |
| "Board at a stop" | **PinToMatch** | — | Model for item 1 (join the next bus at a stop) |

### 4.5 Rider flow (Uber rider)
| Topic | Uber rider | EyeGo | Proposal |
|---|---|---|---|
| Rider status | 4 states (LOOKING · DISPATCHING · WAITING_FOR_PICKUP · ON_TRIP) + server text + `isArriving` | 15 TripStatus values mapped in the app | Rider sees 4 phases; server sends the sentence |
| Product row | `capacity`, `fare`, `waitTimeString`, `noneAvailableString`, per-product CTA, `requiresPrecisePickupLocation` | tier cards | Same as Bolt: unavailable stays with reason, CTA per row; pickup-confirm only for private/charter |
| Shared seats | Pool: seats 1–2 picker (`capacityTitle`), "walk to save" (`walkingEnabledByDefault`), HIGH_CAPACITY type | — | Seat trips: seats stepper + "walk to the stop on the route" (the bus never detours) |
| Shuttle | routes of named stops + `displayInterval` ("every 15 min") | trips listed individually | Corridors can show frequency ("buses every ~6 min") above the next-bus rows |
| Quote | signed, seat count priced in | signed quote, party size priced | EXISTS |
| Charter | not in app (web); `hourlyHireInfo` for time hire | — | D4 stands (ride card × capacity); hourly hire = later |

### 4.6 Uber's bus product (HCV) mapped to the client brief — the reference model
| Uber HCV | EyeGo equivalent | Status |
|---|---|---|
| Stop → `upcomingSupplies[]` (live ETA, scheduled ETA, **seatsAvailable**, tags) | "Bus passing your stop in 4 min · 1 seat" rows | **MISSING** → Phase A (A5 returns exactly this shape) |
| `HCVSupply` per pickup→drop-off (fare, ETA/ETD) | `searchTrips` result per rider span | PARTIAL → A5 |
| `HCVPassData{seats, passNumber, qrCodeURL}` | N seats, one QR for the group | PARTIAL (one QR per booking row) → D2: one pass, N seats |
| `ServiceScheduleType` LOOP / EVENT / RESERVE / ACTIVE | runs, events (beach trips), reservations | PARTIAL → F1 (recurring runs) + D (charter) |
| `HCVRouteTimes{days,hours,frequency}` | "Mon–Fri · 6–10am · every ~6 min" on corridors | MISSING → F |
| `RouteStopType` PICKUP/DROPOFF/BOTH | virtual stops are both-ways | Later |
| `reverseUUID` (return route) | "book the return" | MISSING → D1 |
| Walk-ride-walk map segments, `ClosestStopInfo` walking ETA | walk to the stop on the route | MISSING → A5/B |
| `TargetLocationNotNearCommute` | "No bus heading your way → go private?" | MISSING → C4 |
| Rider suggests a route | demand signal | MISSING → F2 |
| Server-defined sheet snap points | SnapSheet measured detents | different design, keep ours |

### 4.7 Feature adoption matrix (from all three apps)
| Tier | Feature (source) | EyeGo today |
|---|---|---|
| **Must (brief)** | Next buses at your stop with seats (Uber HCV) | Phase A |
| **Must** | One pass, N seats, one QR (Uber HCV) | Phase D |
| **Must** | Walk-up boarding by PIN at a stop (Uber `directed_dispatch`, Bolt `PinToMatch`) | **NEW proposal → Phase A+** |
| **Must** | Ride-type rows: unavailable stays with reason, per-row CTA (Uber + Bolt) | G3 |
| **Must** | Offer protocol v2 (Uber) | Q7 yes |
| **Must** | Rider snapshot polling floor (Bolt) | Q6 yes |
| Should | Group lobby + host lock + per-guest pickup (Uber `groupride`) | invite hub exists — add lock + waiting room |
| Should | Warn before force-offline / unresponsive diagnostics (Uber) | Q9 |
| Should | "Last trip — stop new requests" (Uber `stop_future_request`) | Pause Requests exists ✓ |
| Should | Speed alerts (Uber `speedintervention`) | MISSING — buses, safety value high |
| Should | Driver breaks with a break bank (Uber `fleet_break_management`) | fatigue 12 h/6 h exists; no break bank |
| Should | Cash collection at trip end (Uber `cash_drop`) | cash change exists ✓ |
| Should | Smart pickups / suggested stops (Bolt `smartpickups`) | virtual stops exist; no suggestion |
| Should | No-internet mode (Bolt `nointernet`, Uber `offline_confirmations`) | offline queue exists (driver) — rider MISSING |
| **Must** | "Your ride runs along a bus corridor → take the bus" auto-switch (Yango `AUTO_SHUTTLE_ON_ORDER`) | **NEW → Phase C** (shared = this) |
| **Must** | Seats stepper with a per-product max (Yango `SeatsSelectorTariffRule`) | Phase D/E |
| **Must** | Timetable with seats left per departure (Yango `timetable_with_seats`, Uber HCV) | Phase A5 / F1 |
| Should | Bluetooth boarding: phone detects the bus at the stop, one-click pay (Yango BLE checkout) | **NEW — later than Q10 code; needs a beacon in each bus (~₵60–100 hardware)** |
| Should | Live ticket animation so screenshots can't pass (Yango) | NEW → with Q10 / D2 boarding pass |
| Should | Landmark directions & pickup clarification ("after the bridge", entrance) (Yango) | MISSING — high value for Accra |
| Should | Order by phone call when data fails (Yango `call_order_fallback`) | MISSING |
| Should | Free → paid waiting with a timer on the card (Yango) | wait fee exists (hailed) ✓ — add card timer |
| Should | Live buses on the map for a corridor (Yango `LiveVehiclesLayer`) | MISSING → Phase A |
| Later | Pickup from a photo (Yango), offline places/search (Yango), alternative pickup with price comparison (Yango `altpins`) | — |
| Later | Practice trip for new drivers, learning hub, vehicle inspection, dashcam/audio (legal review), price bidding, family/business profiles, subscriptions/passes | — |

---

## 5. Card system rebuild (G3) — spec

> Superseded in detail by **`docs/research/2026-10-29-visual-teardown.md` §7 (Motion & Card Spec v2)** — tokens,
> durations, transition matrix, inline expansion and sheet states measured from Uber, Bolt and Yango.

- **Look:** flat solid surface, 16–20 pt top radius, no glass/aurora/glow rings on sheets, one hairline divider style, strong type hierarchy (price and ETA biggest), brand colour only on the selected outline and the CTA.
- **Mechanics:** unchanged SnapSheet (measured detents, finger-tracked, pinned footer).
- **Bus row (Bolt-shaped):** vehicle image · name · "14 seats · 3 free" · "Passing your stop in 4 min" · price right-aligned · badge (Fastest / Cheapest) · unavailable rows greyed with a reason · selected row outlined · CTA label from the row ("Book seat · ₵28", "Book whole bus · ₵420").
- **Detents:** peek = list of rows; half = rows + payment + seats stepper; full = route detail, stops, policy.
- **Driver offer card:** header (fare + "+₵x boost"), itinerary (pickup ETA → stops → drop, seat count), info chips, swipe to accept, Pass button, countdown on the top edge.

---

## 6. Build order (proposed)

0. **Bugs**: Skia sizing · B1 mid-ride ETA · B2 capacity filter (≥ party, vehicles ≥ 6) · bus-only cleanup (G4) · logcat-driven fixes when the phone is back.
1. **Phase A — join a moving bus** (segment seats, running-trip booking, no-show grace, prepaid mid-route, "bus passing your stop" push).
2. **Offer protocol v2**: offer id + ack + discardAfter + minimumView + GPS on accept.
3. **Phase B + G3 — new home picker and the flat card system** (same pass, one design).
4. **Phase C — shared vs private** (shared = broadcast to buses heading your way, driver accepts).
5. **Phase D — charter + N seats** · **Phase E — seat-map removal** · **Phase F — supply, corridors, demand admin**.
6. Splash (G5) and the tier turn (G2) slot into Phase B.

Each phase: tsc ×3, `yarn test`, API jest, static e2e, new unit tests, one commit, state.md + session-log.md. No push without you.

---

## 7. OPEN questions (asked one at a time)

| # | Question | Recommendation |
|---|---|---|
| Q6 | Rider live sync: add Bolt-style versioned snapshot polling as a floor under the socket? | **ANSWERED: yes** — 2 s searching / 5 s riding / 4 s otherwise, served from the Redis snapshot, never a DB query per poll |
| Q7 | Offer protocol v2 (offer id, ack, discardAfter, minimum view, GPS on accept)? | **ANSWERED: yes**, step 2 |
| Q10 | Walk-up boarding by bus code at a stop (Uber directed dispatch / Bolt PinToMatch)? | **ANSWERED: yes** — per-trip 4-character code, pays in-app, segment-priced, same seat pool; built right after Phase A |
| Q8 | Server-driven offer card content? | Partial: server sends the text/sections; layout stays native |
| Q9 | Auto-pause a driver who ignores N offers in a row? | Yes, N = 3, shown with the reason; one tap to resume |

## 8. Not verifiable here
Anything on a device (crashes, morph, Skia, splash, animations), iOS push (no APNs key), real Paystack,
real ETAs. Uber/Bolt evidence is static only — no runtime behaviour was observed.
