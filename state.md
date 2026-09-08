# State — 2026-09-08 twenty-item pass

## Current Goal
20 items from a two-device test. Plan: `docs/plans/2026-09-08-twenty-item-pass.md`.
Both apps `tsc --noEmit` clean; all touched server files `node --check` clean.
NOTHING device-verified.

## Decisions taken (user-confirmed, 2026-09-08)
- Driver manage-trip + tracking redesign → **Stop Timeline**: collapsible map
  pane on top, vertical stop timeline (PICKUP / DROP nodes) with the passengers
  for each stop nested under it, cabin strip inside the current stop, one action
  pinned at the bottom.
- QR → **two payloads, one scanner** (`pay` vs `book`) + universal links.
- Mid-ride dispatch offers → live ETA to final drop ≤ 5 min, as a PlatformSetting.
- New-ride alert → sound + haptic + full-screen popup, repeating, driver-toggleable.

## DONE (11 items complete)

### #1 driver Skia frozen — two independent causes
1. `useShaderSlot` is now PRIORITY-aware. The app's one `variant="animated"`
   background is in the root layout, which has no navigation context, so it
   claimed the slot once at launch and sat at the BOTTOM of a recency stack.
   Every other mount is `variant="static"` — a deliberately FROZEN frame — so
   the first one to focus took the canvas and painted a still image with it. On
   the driver that was five TAB screens, which never unmount. Animated now
   outranks static; a PAUSED animated instance drops to static priority, which
   is exactly when the covering screen should take over.
2. `backgroundActivity` busy counter could only go up (tap-to-catch a flinging
   list fires momentum-begin with no momentum-end). One dropped decrement froze
   the shader for the session. 6 s watchdog added.
Also: removed the redundant `<AppBackground/>` from 5 driver `(tabs)` screens
(the group is already `TRANSPARENT_CONTENT`), and `overFullBleedMap` now matches
segments, not substrings.

### #2 book-a-ride map
`tripFlow.setPickupCoord` is called from NOWHERE — `pickupCoord` was permanently
null, so the pickup pin never rendered and `fitFor` framed on the destination
alone. `TripMap` now derives it from `useRideStore.origin`. Recenter re-frames
the whole journey when one exists (`hasJourneyToFrame`) instead of locking onto
the rider, and the icon changes to match.

### #3 four-seat 409
Server defaulted `seatCount` to 1 at the destructure, so ABSENT and an explicit
1 were indistinguishable — any client path that lost the field asserted a party
of one against a quote signed for four. The quote is now the authority; the body
is a cross-check that can only fail when explicitly different, and it fails as
`PARTY_SIZE_MISMATCH` (not `FARE_EXPIRED`, which sent the client into a re-quote
that could only fail identically). Client reads the party from the store at call
time, not from a stale closure.

### #4 duplicate back control — the panel drew a second, INERT arrow
(`pointerEvents="none"`) directly above "We couldn't send that". Gone.

### #6 / #15b straight walking line
`/v1/geo/route`'s last-tier haversine ESTIMATE returns a well-formed two-point
LineString, indistinguishable from a real route, so the client drew it — which
is why the earlier walking-profile fix appeared to do nothing. Server labels it
(`geometryIsRoute`), a walk retries on the driving profile before falling
through, and the client refuses to draw a non-route as a polyline.

### #7 tracking freezes at "driver is here"
`DriverInfoCard` flips to `premium` at exactly ARRIVED_AT_PICKUP, mounting a
rotating ring, a sweeping sheen AND an iOS `glow` shadow over a live MapView —
with a ticking ETA inside it, so the blurred silhouette re-rasterises every
second. Bloom removed, ring kept (the same fix already applied to the driver's
map screens).

### #9 driver palette → deep near-black
`driverColors` was a saturated navy ramp. Now the rider's Onyx lightness ladder
(06 → 0A → 16 → 1A → 22 → 2C → 33) with a cool cast that only appears as the
surfaces rise.

### #10 receipt placeholders / "Your Driver"
The RIDE_COMPLETE push handler pushed a BOOKING id into `/ride/[id]/complete`,
whose `[id]` is a TRIP id — `ridesApi.events()` found nothing and every field
fell through to its loading placeholder. `push.service.rideComplete` now sends
`tripId`; the handler uses it. Same class of bug fixed on `RIDE_CONFIRMED`.

### #14 false "already on a ride"
`activeBooking` is PERSISTED and the COMPLETED branch never cleared it (only
CANCELLED did). Added `isLiveBooking()` (booking status AND trip status — the
rule the home screen and the server already use), a rehydrate-time purge, and a
clear on COMPLETED.

### #15a red payment toast
`notify()` defaults to `tone: 'error'`; the payment notice passed no tone. Fixed
that one plus the obviously-positive driver notices. The default is left alone —
its dominant caller is `onError`.

### #16 boarded never reached the rider
`mergeSnapshot` preserves the personal `booking` across room frames (correct — a
room snapshot cannot carry it), which made the field permanently STALE: nothing
could ever move it to BOARDED. Added `applyBookingScopedEvent` — a booking-scoped
event patches the carried-over booking by matching `payload.bookingId`. New
`PASSENGER_BOARDED`/`PASSENGER_NO_SHOW` event types (excluded from `TripStatus`).
New `BoardedCelebration` on the trip surface.

### #18 "find another driver" landed on the search stage
The terminal branch calls `clearRideState()`, so by the time the sheet is on
screen there is no journey left to repeat. The notice now carries one (captured
inside `raise()`, so no call site can forget), and `rebook()` re-seeds the store
and goes to `?stage=request`.

### #20b guest booking
`guest-selection` has always taken a `next`; the "Book for someone else" CTA was
the one call site that omitted it, so it fell through to `goBack()`. Now goes
straight to the seat map.

## PARTIAL

### #5 dispatch alerting — alert DONE, screen redesign NOT
- `utils/dispatchAlert.ts`: repeating chime + haptic + Android vibration pattern
  while an offer is live, stops on answer/expiry/unmount, driver-toggleable
  (`offerAlertsEnabled`, new Settings row). The full-screen takeover already
  existed and is root-mounted — the missing half was that it was silent.
- Alert tone generated at `apps/driver/assets/sounds/new-ride.wav`.
- `expo-audio` added to `apps/driver/package.json` but NOT INSTALLED. The module
  is resolved at call time, so the alert works as haptics+vibration today and
  gains sound the moment someone runs `npx expo install expo-audio` in
  `apps/driver` (needs a new native build).
- Mid-ride offers: `midRideAvailableDriverIds` + `MIDRIDE_OFFER_ETA_MINUTES`
  setting, wired into `matcher.rankCandidates` as an ADDITIVE second pass.
- STILL TODO: the dispatch screen's own layout (`(trip)/dispatch/[id].tsx`).

### #6 / #8 driver redesign — tracking DONE, manage NOT
New components, all typechecked:
- `components/trip/useTripStops.ts` — trip → stops + passengers, tolerant of
  every shape (on-demand hail, route with virtual stops, group booking).
- `components/trip/StopTimeline.tsx` — the timeline + `CabinStrip`.
- `components/trip/StopTimelineSurface.tsx` — draggable map pane (18%/42%
  detents, spring with velocity, rubber-band), scrolling body, pinned action.
`(trip)/tracking/[id].tsx` is migrated (render replaced, all mutations/sockets
untouched). `(trip)/active/[id].tsx` (manage, 2754 lines) is NOT — it still
wears `TripSurfaceShell`.

### #20a seat sheet — components exist, manage screen not migrated.

## NOT STARTED
- #11 Apple-grade screen transitions.
- #12 "set a destination" dead op.
- #13 driver home camera under the balance card + heatmap end-to-end.
- #17 no-show → "unfinished ride" toast → blank manage screen. DIAGNOSTIC NOTE:
  the driver's toast system is `DriverTripStatusListener` → `DriverToast`; a
  banner with no `dest` is not tappable, so the culprit is more likely
  `DispatchBlockedBanner` (`code.startsWith('BUSY')` → action `ACTIVE_TRIP`).
  `getActiveTrip` and `busyTripFilter` both correctly exclude terminal trips, so
  start by logging what `dispatchStatus.reason` actually says after a no-show.
- #19 QR split + deeplinks end to end.

## Notes
- `npx` is broken here — use `node node_modules/typescript/lib/tsc.js`.
- `python` is not on PATH in the Bash tool; use `sed`/`node`.
- Escaping backticks through `bash -c node -e` mangles template literals — use
  the Write/Edit tools for anything containing them.
