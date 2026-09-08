# State — 2026-09-08 twenty-item pass

## Status
**All 20 items addressed.** Both apps `tsc --noEmit` clean; all 8 touched server
files `node --check` clean; `app.json` parses. **Nothing device-verified.**

Plan: `docs/plans/2026-09-08-twenty-item-pass.md`.

## Decisions taken (user-confirmed, 2026-09-08)
- Driver manage-trip + tracking redesign → **Stop Timeline**.
- QR → **two payloads, one scanner** (`pay` vs `book`) + universal links.
- Mid-ride dispatch offers → live ETA to final drop ≤ 5 min, as a PlatformSetting.
- New-ride alert → sound + haptic + full-screen popup, repeating, driver-toggleable.

## THE ONE THING THAT STILL NEEDS RUNNING
`expo-audio` is declared in `apps/driver/package.json` but **not installed**.
`utils/dispatchAlert.ts` resolves it at call time, so the new-ride alert works as
haptics + vibration today and gains its chime after:

    cd apps/driver && npx expo install expo-audio

then a new native build — it is a native module, not OTA-able.

## What each item was

### #1 driver Skia frozen — two independent causes
1. `useShaderSlot` is now PRIORITY-aware. The app's one `variant="animated"`
   background lives in the root layout, which has no navigation context, so it
   claimed the slot once at launch and sat at the BOTTOM of a recency stack.
   Every other mount is `variant="static"` — a deliberately FROZEN frame — so
   the first one to focus took the canvas and painted a still image with it. On
   the driver that was five TAB screens, which never unmount. Animated now
   outranks static; a PAUSED animated instance drops to static priority, which
   is exactly when a covering screen should take over.
2. `backgroundActivity`'s busy counter could only ever go up (tap-to-catch a
   flinging list fires momentum-begin with no momentum-end). One dropped
   decrement froze the shader for the rest of the session. 6 s watchdog added.
Also removed the redundant `<AppBackground/>` from 5 driver `(tabs)` screens
(the group is already `TRANSPARENT_CONTENT`), and `overFullBleedMap` now matches
segments rather than substrings.

### #2 book-a-ride map
`tripFlow.setPickupCoord` is called from NOWHERE — `pickupCoord` was permanently
null, so the pickup pin never rendered and `fitFor` framed on the destination
alone. `TripMap` derives it from `useRideStore.origin` now. Recenter re-frames
the whole journey when one exists, and the icon changes to match.

### #3 four-seat 409
Server defaulted `seatCount` to 1 at the destructure, so ABSENT and an explicit
1 were indistinguishable — any client path that lost the field asserted a party
of one against a quote signed for four. The quote is the authority; the body is
a cross-check that can only fail when explicitly different, and it fails as
`PARTY_SIZE_MISMATCH` rather than `FARE_EXPIRED` (which sent the client into a
re-quote that could only fail identically).

### #4 duplicate back control
The panel drew a second, INERT arrow (`pointerEvents="none"`) directly above
"We couldn't send that".

### #5 dispatch: alert + mid-ride + proportion
- `utils/dispatchAlert.ts` — repeating chime + haptic + Android vibration while
  an offer is live; stops on answer/expiry/unmount; driver-toggleable
  (`offerAlertsEnabled`, new Settings row). The full-screen takeover already
  existed and was root-mounted — the missing half was that it was silent.
- Mid-ride offers: `midRideAvailableDriverIds` + `MIDRIDE_OFFER_ETA_MINUTES`,
  wired into `matcher.rankCandidates` as an ADDITIVE second pass.
- Layout: `SHEET_MAX_HEIGHT` was a flat 560 pt — 72% of a 780 pt phone, 84% of a
  667 pt one, so the guarantee got weaker on the devices that needed it most.
  Now a fraction (58% sheet / 42% map), matching what `StopTimelineSurface`
  gives the map, capped at 560 for tablets.

### #6/#15b straight walking line
`/v1/geo/route`'s last-tier haversine ESTIMATE returns a well-formed two-point
LineString, indistinguishable from a real route — which is why the earlier
walking-profile fix appeared to do nothing. Server labels it (`geometryIsRoute`),
a walk retries on the driving profile before falling through, and the client
refuses to draw a non-route as a polyline.

### #6/#8 driver redesign — BOTH screens on the Stop Timeline
New components: `useTripStops` (trip → stops + passengers, tolerant of every
shape), `StopTimeline` + `CabinStrip`, `StopTimelineSurface` (draggable map pane
18%/42%, spring with velocity, rubber-band, scrolling body, pinned action).
`tracking/[id]` and `active/[id]` are both migrated (renders replaced; every
mutation, socket handler, query key, transition and guard untouched — the
boarding-PIN run and keypad are unchanged).

### #7 tracking freezes at "driver is here"
`DriverInfoCard` flips to `premium` at exactly ARRIVED_AT_PICKUP, mounting a
rotating ring, a sweeping sheen AND an iOS `glow` shadow over a live MapView —
with a ticking ETA inside it, so the blurred silhouette re-rasterises every
second. Bloom removed, ring kept.

### #9 driver palette
Was a saturated navy ramp. Now the rider's Onyx lightness ladder with a cool
cast that only appears as the surfaces rise.

### #10 receipt placeholders / "Your Driver"
The RIDE_COMPLETE push handler pushed a BOOKING id into `/ride/[id]/complete`,
whose `[id]` is a TRIP id. Fixed both ends; same class fixed on RIDE_CONFIRMED.

### #11 transitions
The navigator default was `fade` (rider) and `fade_from_bottom` (driver). A fade
has no direction so it cannot express depth; `fade_from_bottom`'s direction was
actively wrong (upward means modal). Default is now `detailPush` — iOS hands the
transition to UINavigationController (parallax, edge shadow, real interactive
pop), Android keeps the slide. `fade` survives only on the root-level peer
swaps, which are also the transparent-content screens a slide would break.

### #12 set a destination
Every part was built — routes, controller, rationing, picker handoff on focus,
matcher filter. What was missing was the ENTRY POINT: the card returned `null`
whenever `mode` was falsy, which is true on first paint, on every cold start,
and permanently if the GET fails. The CTA always renders now; only the allowance
pill waits for the server.

### #13 driver home camera + heatmap
- The camera had no `padding`, so the driver was centred in the full MapView
  while the bottom 56% is covered by the panel. `padding` is not a prop on this
  Camera — it exists only on the imperative `setCamera` — so a ref-driven effect
  re-frames on a rounded fix.
- `DemandOverlay` used a SCREEN-PIXEL radius, so a blob claimed different ground
  at every zoom; its edge is kilometres from its centre when zoomed out, which
  is the report. Now a real 600 m radius converted at two zoom stops and
  interpolated exponential base 2. The server was already correct.
- No longer gated on `isOnline` (that is the question you ask BEFORE going
  online), and an empty result says so instead of drawing nothing.

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
room snapshot cannot carry it), which made the field permanently STALE.
`applyBookingScopedEvent` patches it by matching `payload.bookingId`. New
`PASSENGER_BOARDED`/`PASSENGER_NO_SHOW` event types (excluded from `TripStatus`).
New `BoardedCelebration` on the trip surface.

### #17 no-show misdirection
Two defects. The blocked banner opened `driverStore.activeTripId` — a persisted
local value unrelated to the server-generated reason on screen — so after a
no-show it opened the trip that was just killed. It now parses the id out of the
server's own `BUSY(trip=…)` reason (`dispatchBlockTripId`). And nothing cleared
`activeTripId` when a trip ended by any route other than the screens that end it
on purpose; `releaseTripIfMine` does, guarded on the id.

### #18 "find another driver" landed on the search stage
The terminal branch calls `clearRideState()`, so by then there was no journey
left to repeat. The notice carries one now (captured inside `raise()`, so no
call site can forget) and `rebook()` re-seeds the store and goes to
`?stage=request`.

### #19 QR split + deeplinks
The driver rendered ONE code for both buttons and it pointed at `/ride/<id>` —
the trip DETAIL screen, whose primary action is "Book This Seat". Now two codes
behind a segmented control: `/pay/trip/<id>` and `/ride/<id>`. The rider's parser
gained `payTrip` (tested BEFORE `/pay/`, which is its prefix), and `/ride/<id>`
means booking instead of being forced to payment. Android intent filters
extended to `/track` and `/join`.

### #20a seat modal
It was `Alert.alert()` with six newline-joined lines and five stacked OS buttons.
New `components/trip/PassengerSheet.tsx`: identity (avatar, name, guest +
booker), three state chips (seat / money / aboard), reach-them actions, then the
decision, then the destructive one behind a rule in the error colour.

### #20b guest booking
`guest-selection` has always taken a `next`; the "Book for someone else" CTA was
the one call site that omitted it, so it fell through to `goBack()`.

## Notes for the next session
- `npx` is broken here — use `node node_modules/typescript/lib/tsc.js`.
- `python` is not on PATH in the Bash tool; use `sed`/`node`.
- Backticks mangle through `bash -c node -e` — use Write/Edit for anything
  containing template literals.
- The e2e harness (`scripts/e2e`) was NOT run this pass; it needs a live stack.
