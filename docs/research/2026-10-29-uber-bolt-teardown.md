# Uber Driver / Bolt Rider — Static Teardown (2026-10-29)

Source: user-supplied XAPKs (APKPure). Uber Driver 4.603.10001 (`com.ubercab.driver`), Bolt rider CA.231.0
(`ee.mtakso.client`). Decompiled with jadx-headless 0.8.0. **Static evidence only** — nothing was executed.
App code is obfuscated; generated network models (Thrift/Wire) keep their real names, which is where
everything below comes from. Behaviour and protocol shapes only — no code or assets are copied into EyeGo.

Dispatch MATCHING runs on their servers and is not in any app. What the apps reveal is the client half:
the offer protocol, its timers, delivery, recovery and the trip state model.

---

## 1. Uber Driver — the offer protocol

### 1.1 An offer is not a job
`rtapi.models.offer.DriverOffer`: `offerUUID` (+`offerUUIDV2`) **and** a separate `jobUUID`. One job → many
offers (re-offers, re-dispatch, multiple drivers). Also: `offerStatus`, `offerType`, `sourceType`,
`supportedActions`, `offerView`, `offerRichNotificationView` (the offer rendered inside the push itself),
`liveActivity` (iOS Live Activity), `sideBarOfferView`, `matchingOfferMetadata.ctRequestUUID`.

- `OfferStatus`: OPEN · ACCEPTED · INVALID · FINALIZED · UNKNOWN
- `OfferType`: GENERAL · JOB · POSITIONER · UPFRONT · UNKNOWN
- `SourceType`: **PUSH · POLL** — the client records how each offer arrived.
- `OfferActions`: **ACCEPT · ACKNOWLEDGE · EXPIRE · REJECT · RELEASE**

**EyeGo today:** the trip id is the offer identity; no ack; no release. → Give each offer its own id.

### 1.2 Timing lives in the payload, as absolute times (`offeractions.JobOfferModel`)
| Field | Meaning |
|---|---|
| `expiresAtEpochMS` | absolute deadline (not a relative TTL) |
| `acceptWindow` | window length, seconds |
| `discardAfterEpochMS` | a push arriving after this is dropped unseen |
| `expiringSoonWindowMS` | card enters EXPIRING_SOON state |
| `minimumViewTimeMS` | the card may not disappear before this (no flash-offers) |
| `expiryAction` | server decides what lapse means (EXPIRE vs REJECT) |
| `backgroundedOfferConfig` | `backgroundedExpiryWindowSec` + `backgroundedExpiryAction` + `overlayExpiryAction` |
| `chimeDurationSec`, `isDefaultVibrate`, `voiceOverConfig`, `experienceConfig.speechConfig` | alert + read-aloud |
| `isForwardDispatch` | offer while finishing the current trip |
| `isPassive` / `enablePassiveDispatch` | non-interrupting offer |
| `isOutOfPreferences` | outside the driver's destination/filters, flagged not hidden |
| `shouldIgnoreOnFocusMode` | suppressed in focus mode |
| `etaToStartLocation`, `segmentTimeMap`, `locationMap`, `polylineMap`, `start/end/viaLocationRefs` | the map story |
| `rejectionAction` / `acceptanceAction` | optional confirm step |
| `releaseButton` | un-accept affordance |

`AcceptanceConfirmation.minimumOfferExpiryRemainingSeconds` — skip a confirm dialog when too little time is left.

`OfferViewState` (edge offerexperience): ACTIVE · EXPIRING_SOON · EXPIRED · MATCH_IN_PROGRESS ·
**MATCHED_TO_ANOTHER_EARNER** · PERSISTED → some jobs are shown to several drivers, first accept wins.

### 1.3 Accept / reject payloads
- `AcceptOfferParams`: offerUUID, offerType, reservationUUID, **positionEvent (driver GPS at accept)**,
  conditionalAcceptanceInfo (counter-fare).
- `RejectOfferParams`: offerUUID, reason, **blockFutureRiderDriverPairing**, actionData.
- `AckOfferParams`: offerUUID — the phone confirms receipt.

### 1.4 Client-side runtime constraints (`OfferMobileRuntimeConstraint` union)
AppState · **Cooldown** (`group`, `maxImpressionCap`, `periodSeconds`) · FocusMode · Sampling ·
**Speed** (`minSpeedConstraint`, `maxSpeedConstraint`) · TripRadar.

### 1.5 The card is server-driven UI (`edge.models.upfrontofferviewv2.UpfrontOfferViewV2`)
`sections[]` (typed: header, itinerary rows + progress item, info items, map card, alerts), `pageTitle`,
`acceptOfferActionTitle`, `declineOfferActionTitle`, `cancelOfferActionTitle`, `onOpenAlert`,
`cancelOfferAlert`, `cancelOfferConfirmationScreen`, `blockFutureRiderAlert`, `cancellationSurvey`,
`policyContent`, `analyticsData`. Header = title + subtitle + tags + trailing illustration.

### 1.6 Trip Radar / job board (`com.uber.carbon.driveroffersjobboard`)
Browse list + map carousel + focus view + entry pill on the online screen + sidebar + snackbar. Workers:
`ForwardDispatch`, `OverlayInvalidation` (stale offers withdrawn), `OOA`, bid pricing. Each row
(`DriverOfferJob`): driverOffer, `invalidDriverOffer` (+`offerErrorOverlay`, `offerViewState`,
`isPassivelyNotified`), offerState, `showNewOfferIndicator`, `matchingTitles`, `isOfferClickable`, and a
`SwipeableDriverOffer` (server-defined left/right swipe: icon + text + action each).

### 1.7 Delivery — RAMEN
Push channel with a polling fallback (`app_ramen_polling.core.RamenPollApi`). Every feature subscribes to
its own topic through a `*RamenPluginFactory` (dashboard, checklist, courier state, identity results…).

### 1.8 Go-online eligibility — `edge.models.dispatchability`
`DispatchabilityStatus`: DISPATCHABLE · NON_DISPATCHABLE · BANNED. `NonDispatchableReason`: PAUSE ·
**UNRESPONSIVE_SESSION** · FACIAL_VERIFICATION · MANDATORY_RECORDING. The driver is told why.

### 1.9 In trip — tasks on waypoints (`rtapi.models.driverstasks`, `taskbuildingblocks`)
job → workflow → waypoint → task (`ServerTaskInformationData`: jobUUID, workflowUUID, waypointUUID,
taskId). Typed task data per waypoint (PIN/verification, blocking confirmation, beacon, accessibility…).
`AutoProximityTrigger.distanceThresholdMeters` — auto-arrive radius set per task by the server.

---

## 2. Bolt rider (`ee.mtakso.client`, code under `eu.bolt.*`, RIBs architecture)

### 2.1 Pre-order flow is an explicit screen-state machine (`PreOrderScreenState`)
Home · SearchDestination · SearchPickup · SearchHome · SearchWork · ChooseOnMap · ConfirmOnMap ·
**CategorySelection** · **ConfirmPickup** (pin confirm AFTER choosing the ride) · ConfirmPrice ·
**DriverShopping** (searching) · **AllDriversAreBusy** (keeps pickup + destinations + categoryId + rider
name/phone → one-tap retry) · ScheduledRide · ReviewScheduledRide · None.

### 2.2 Rider order states are few (`OrderState`, name + isActive)
Requesting(**hasDriverRefused**) → DriverAccepted → DriverArrived → DrivingToDestination(hasArrived) →
Finished → Completed; plus Cancelled(error) and **PinToMatch** (rider shows a PIN; the vehicle at the front
of a pickup zone takes them — the closest existing product to "board the next bus at a stop").
A driver refusing is a FLAG on Requesting, not a new screen.

### 2.3 Ride-type row (`rideoptions.RideOptionsCategory`)
id, rawId, name, group, orderSystem, titleHtml, infoIcons, **isAvailable + categoryNotAvailableMessage**
(unavailable types stay listed, greyed, with a reason), description, disclaimerHtml, categoryIconUrl,
detailsIconUrl, route, **etaInfo**, **price**, priceOptions, action, info, **secondaryInfoItems /
tertiaryInfoItems** (each with `Visibility` + **`BottomSheetVisibility`** — a row shows more as the sheet is
pulled up), isDriverShoppingEnabled, offerHtml, **badges**, vehicleIcon, stickyBanner, inlineNotifications,
categoryDetailsBadges, selectionMessage, **primaryButtonModel** (CTA label per category), sortData,
categoryGroupingData, hasRiderPreferences, flow. Category list itself arrives as a server-driven
`StickyViewNetworkModel`. Category actions: Order (with optional dialog / modal-list confirmation),
Schedule, SelectVehicle, UpfrontPricing, VerificationRequired, CategoryDetails, BottomSheet, WebView…

### 2.4 Live order sync = versioned POLLING (+ MQTT for driver location)
`PollingTimeKt`: **1 000 ms** while waiting for a driver, **4 000 ms** while driving with the client,
**2 000 ms** otherwise. `PollingResponse`: orderHandle, **orderVersion**, orderState, driverLat/Lng/Bearing,
**secondsTillArriveToClient**, **secondsTillArriveToDestination**, **retryTime** (server-set back-off),
presentation (server-driven sheet UI), route, mapMarkersList, **walkingPath (+tooltip)**,
**driverGpsIssue**. `OrderPollingManager.ForceRefreshOrder` for user-initiated refresh;
`VehiclesPollingArgs.Stage` polls nearby vehicles per screen.

---

## 2b. Uber rider (`com.ubercab` 4.654.10002, APKMirror bundle, base.apk)

### Rider status is four states (`rtapi.models.rider.RideStatus`, via `marketplacerider.ClientStatus`)
LOOKING → DISPATCHING → WAITING_FOR_PICKUP → ON_TRIP. Everything finer is server text (`statusDescription`),
flags (`isArriving`), cancellation info (`lastRequestType/Msg/Note`, `lastRequestJobUUID`) and
`tripPendingRouteToDestination`.

### Product row (`vehicleview.VehicleView`)
displayName, groupDisplayName, **capacity**, description, detailedDescription, **fare**, productImage,
**waitTimeString**, tripTime, **noneAvailableString** (unavailable rows stay, with a reason),
**requestPickupButtonString** (per-product CTA), **requiresPrecisePickupLocation** (pickup-confirm only for
products that need it), productTier, productFeatures, recommendationInfo, isSchedulable/schedulable,
reservations, **maxFareSplits**, allowRidepool, **poolOptions**, **shuttleInfo**, **hourlyHireInfo**,
multiDestinationOptions, mapIcons, hideProductInApp.

### Shared seats (Pool / Share)
`PoolVehicleViewType`: REGULAR · COMMUTE · WAITING (wait & save) · **HIGH_CAPACITY** · DIRECT_LINE · …
`PoolToggleOptions`: **capacityTitle** (1 vs 2 seats), **walkingEnabledByDefault** + walkingTitle/Subtitle
(walk to a better spot to save), requestButtonTitle/Subtitle, productNameOverride.

### Shuttle (`rtapi.models.shuttle`)
`ShuttleInfo{routes[], displayInterval}` · `ShuttleRoute{uuid, name, description, pickup, dropoff}` ·
`ShuttleStop{name, location}`; schedule rendered from a server template per vehicle view. Shuttle is
sold as **frequency + named stops** ("every 15 min from X"), not as a specific vehicle.

### Fare quote (`pricingdata.UpfrontFare`)
uuid, **capacity** (seats priced in), fare, discountedFare, originalFare(PrePromo), **signature**
(signed quote), surgeMultiplier, estimatedDuration, estimatedDistance, viaLocations, origin/destination
location ids, alternativePrices, ufpType.

No in-app Charter product; time-based hire is `hourlyHireInfo`.

### 2c. Uber's bus product — HCV ("High Capacity Vehicle"), field-level (dex field tables)
- `HCVRoute{uuid, name, color, category, description, stops[], times[], programID, **reverseUUID**}`
- `HCVRouteStop{uuid, name, neighborhood, location, **departures[]**, directions, noDeparturesMessage, **routeStopType PICKUP|DROPOFF|BOTH**}`
- `Departure{arrivalTimeInSecs, **countdownETAInMins**, **departureStatusBadge**, **vehicleLicensePlateNumber**, serviceScheduleUUID}`
- `HCVStopSupplyInfo{**numVisibleETAs**, **upcomingSupplies[]**, schedules[]}`; `HCVStopSupply{etaTimestampSec, etdTimestampSec, scheduledEta/Etd, **seatsAvailable**, tags[], isScheduled, serviceScheduleUUID, supplyUUID}`
- `HCVSupply` (a bookable departure for a pickup→drop-off): ETA/ETD live + scheduled, fareDisplay (+ strikethrough/discount), departureInformation, event name/image, `hcvRouteScheduleType ON_DEMAND|SCHEDULED`
- `HCVPassData{**seats**, passNumber, **qrCodeURL**, formattedFare, isCash, capacityTitle, tripUUID, route/venue info}` — one booking, N seats, one QR
- `HCVReservationInfo{pickupStop, dropoffStop, targetPickupTimeMS}`; `HCVDispatchInfo{routeUUID, pickupStopUUID, dropoffStopUUID, serviceScheduleUUID, scheduledEtaTimestampSec}`
- `ServiceScheduleType`: ACTIVE · **LOOP** · RESERVE · **EVENT** · EVENT_DISPATCH · HCV_POOL_ACTIVE; `HCVJobType`: DEFAULT · EVENT · LOOP · HCV_X_POOL
- `HCVRouteTimes{days, hours, frequency}`; `HCVRouteStatus BOOKABLE|UNAVAILABLE`; `ClosestStopInfo{stop, walkingInfo{etaText,…}}`
- Map segments: PICKUP_WALKING · ON_TRIP · DROPOFF_WALKING · PRE_TRIP · POST_TRIP; `HighlightedTimeType` pickup vs drop-off
- Supply browse by day: `GetSupplyInfoDayTile/DayInfo{isDaySchedulesEmpty, isDaySchedulesOver, noScheduleMessage}`
- Failure types: NoRouteAvailable · NoSchedulesAvailable · NoLiveDeparturesAvailable · **TargetLocationNotNearCommute**
- Rider can **suggest a route** (`HCVSuggestRouteConfig`); passes/subscriptions (`HCVPassData`, membership hub)
- Sheet detents are server-defined: `BottomSheetSnapConfig{initialSnapPointId, snapPoints[{identifier, heightType FIXED_SPACE_UNITS|RELATIVE, value}]}`

### 2d. Uber rider — other relevant modules (names only)
`groupride` (host/guest lobby + waiting room, each guest submits own pickup `WaypointPickupRefinement`, fare split, **host lock**, invite/leave) · `hubpool` (board at a hub, walk from the drop-off hub, hub schedule picker) · `accesspointselection`, `rider_wayfinding`, `rider_pickup_step` · `requestblockers` · `trip_cancellation` · `tipping` · `receipt` · `spender_cash_handshake` · `delegateprofile` / `booking_agent` (book for others) · `multipledestination` · `routeshare` · `postdropoff` · `women_preferences` · `senior_hub` · `riderfamily` · `transit_ticket` · `intercity` · `commute` · `scheduledrides`/`reserve` · `credits`/`voucher`/`gifting`/`membership`/`pass`.

### 2e. Uber driver — other relevant modules (names only)
`directed_dispatch` (**PIN entry at a queue + next card**) · `speedintervention` (speed alerts, audio + border) · `ride_checks` · `unresponsive_force_offline_prevention` (warns before force-offline, diagnostics) · `stop_future_request` ("last trip / stop new requests") · `offline_confirmations` (consecutive trips) · `inspection_sheet` (stop/job inspection rows on the map) · `fleet_break_management` (break bank, start/queue/end break, restrictions) · `real_practice_trip` (practice route for new drivers) · `cash_drop` / `payment_carbon_cash_collect` / `in_person_payment` · `hourlimits` · `waittime`/`manual_wait_time` · `rate_rider` · `driver_scheduler` · `earningshub` / `opportunitycenter` / `driver_loyalty` · `learning_hub` / `training_wheels` · `beacon` · `dashcam` / `audio_recording` · `preferred_destination` · `checklist`.

### 2f. Bolt rider — other relevant modules (names only)
`smartpickups` · `pickupcode` · `parallelorders` · `rhpricebidding` · `orderpreferences` · `scheduledrides` · `trustedcontacts` · `geofencing` · `nointernet` · `cancelreason` / `cancellationconfirmation` · `expensecodes` · `familyprofile` · `boltplus`/`subscriptions` · `backenddrivenui` · `calendarsuggestions` · `ministories`/`stories` · `servicedesk` · `survey`.

---

## 2g. Yango rider (5.98.4, `com.yandex.go` + `ru.yandex.taxi`; R8-obfuscated to field level — names below
come from class names and string literals, which survive obfuscation)

**Order (drive) states:** search/searching → driving → waiting → transporting → complete; plus
scheduling/scheduled (pre-order), pending, assigned, cancelled, failed, expired.

**Shuttle / intercity (seat products):** `shuttle_route`, `shuttle_point_a_id`/`shuttle_point_b_id` (board A,
alight B), `shuttle_trip_id`, `shuttle_statuses`, `SELECT_SHUTTLE_STOP_POINT`, `INTERCITY_SHUTTLE_STOP_POINT`,
**`AUTO_SHUTTLE_ON_ORDER`** (a ride request on a shuttle corridor is switched to the shuttle),
`SHUTTLE_TARIFF_FLOW`, **`seats_selector` / `incrementSeats` / `decrementSeats`** (N-seat stepper),
**`SeatsSelectorTariffRule`** (max seats per tariff), **`timetable_with_seats`** / `getScheduledOrderSeatsAvailable`,
due timetable with day selector (`due_timepoints`, `due_precision_minutes`), intercity "get to the meeting point"
directions, book for a contact.

**Mass transit (`masstransit`):** live vehicles on the map (`LiveVehiclesLayer`, `LiveVehiclesPoller`), nearest
vehicle, online schedule, route detail cards, **Bluetooth boarding** (`MtBleScannerRepository`, iBeacon/Eddystone,
`beacon_ttl_seconds`, **`checkout_vehicle_outdated`**), **geo-zone payment** (`MtGeoPayment*`), **one-click
purchase widget**, linked transport cards, tickets stored offline (`LocalTicketsStorage`) with
`validity_sec`, `LockCountdown`, `checkout_locked_until` (no double pay) and a **live animation on the ticket**
(`ExpirationAnimationStorage`) so a screenshot can't pass as a ticket.

**Pickup & address:** `altpins` (alternative pickup + walking route + price comparison), `pickup_from_photo`
(recognise the pickup from a photo; porch number), `clarify_address` (clarify before ordering), entrance/porch,
**landmark guidance** (`LandmarkAfterBridge`, `LandmarkAtTrafficLights`, `LandmarkBeforeBridge`…, cloud landmarks).

**Resilience:** `call_order_fallback` (order by phone call), offline places/search/suggests/map, xiva push +
location polling, replay-on-no-internet.

**Order extras:** `requirements` (counters e.g. luggage, child seats, AI-validated driver comment), `orderforanother`
("who's riding" pane), `linked_order` (track others' orders), `multiorder`, `checkin`, free → paid waiting
(`free_waiting_until`, `paid_waiting_timer_in_card`), `no_show`, grouped cancel reasons, `tariffcard`,
`zonemodes`, `surge`, `costcenters`, `trusted_contacts`, `geosharing`, `inapp_calls`.

**UI:** DivKit (`com.yandex.div2`) — Yandex's open-source server-driven UI — for flexible screens.

---

## 3. What EyeGo should take (proposals — see the review doc)
1. **Offer identity + lifecycle:** `DispatchOffer{id, tripId, driverId, status OPEN|ACCEPTED|EXPIRED|REJECTED|INVALID, expiresAt, discardAfter, source PUSH|POLL}`; client sends ACK on render; accept/reject carry offerId + GPS; stale offerId → 409 `OFFER_INVALID`.
2. **Absolute deadlines** (`expiresAt`, `discardAfter`, `expiringSoonMs`, `minimumViewMs`) instead of a relative TTL; countdown computed from server time offset.
3. **Server-defined offer card** (sections: header/fare, itinerary with stop count + seats, info chips, CTA labels) so copy and layout ship without an app release.
4. **Dispatchability with reasons** shown to the driver (paused, unresponsive, docs, banned) — `explainIneligible` already exists server-side.
5. **Auto-pause on unresponsiveness** (N missed offers → NON_DISPATCHABLE:UNRESPONSIVE) instead of silently cooling down.
6. **Rider live sync like Bolt:** versioned snapshot polling (1 s searching / 4 s riding / 2 s otherwise) as the floor under the socket; the snapshot carries ETA seconds, driver bearing, walking path, `driverGpsIssue`.
7. **Ride-type rows like Bolt:** unavailable rows stay visible with a reason; per-row CTA label; badges; detail revealed by sheet detent.
8. **"Board the next bus at a stop" ≈ Bolt PinToMatch + Uber Trip Radar broadcast** for item 1 of the client meeting.
9. Waypoint/task model for the driver trip (pickup/drop-off tasks per stop, per-stop auto-arrive radius).
