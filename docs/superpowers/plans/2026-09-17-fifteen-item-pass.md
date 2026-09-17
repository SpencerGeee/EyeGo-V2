# 2026-09-17 — fifteen-item device pass

Root causes found by reading, before any edit. Grouped by the structure that fixes them.

## A. Morph primitive (items 1, 2)
- `GradientGlowBorder` renders NOTHING until its own `onLayout` (`diag > 0`), so every morph clone
  mounts ringless and the ring pops in 1–2 frames later; the halo (iOS shadow siblings) is clipped by
  the overlay's `overflow: 'hidden'`. On the reverse the real pill is un-hidden at landing and its halo
  appears in one frame — "weird animation before the glow registers".
- `MorphSource.hide()` is only undone by `morphBack`; services cards that morph forward and never
  morph back stay `opacity: 0` forever.
- Reverse into a `popAfterFlight` surface blanked the whole destination in one frame.
- First flight to a new id aims at the full window (`lastKnownTarget` empty); every entry into the
  search card should share one landing key.

Fix: clone size hint context → ring draws from frame one; overlay `overflow: visible`; source is
hidden only while a clone is in the air (re-hidden by `morphBack`); departing surface fades on the
flight's own spring; `landingKey` option.

## B. Dispatch offer (items 3, 4, 5, 6-driver)
- `trip.store` OFFER handler drops `geometry` (+ direction hint) the server publishes → straight line.
- Three offer renderers (root takeover with sound/countdown; home `DispatchOfferStage`; pushed
  `(trip)/dispatch/[id]` with no deadline). The pushed one is the "dead page".
- Home board renders a MapView card + rows saying "Destination on the map".

Fix: ONE renderer — the root `DispatchOfferSheet` renders the held offer OR the tapped board row;
rows carry `searchExpiresAtServerMs` from the server so there is ALWAYS a deadline; card border drains
with the clock; `dispatch/[id]` becomes a shim (hydrate → open → home); board = rows only, headed
"NEW REQUEST · heading W · ~4 km".

## C. Rider ghost request (item 6-rider)
- `TripStatusListener.onTripStatus` terminal branch has no tripId guard; `watch(newId)` keeps the
  previous trip's snapshot until the first frame. Guard both.

## D. Driver trip surface (items 9–13)
- `deriveDriverStage` is called WITHOUT the active trip status, so the driving stages never render;
  accept pushes `(trip)/active/[id]` (2608 lines, `StopTimelineSurface` = 42 % map pane).
- `useMapCamera` re-commands `setCamera(duration 0)` per frame from the JS thread; puck marker steps
  every 400 ms.
Fix: stages on home from `activeTrip.status`; DriverTripMap uses native `trackUserLocation="course"`
+ native puck + `contentInset` from the sheet; accept → home; manage page = roster/PIN, no map;
tracking route → home; swipe keyed by status.

## E. Seat page (items 7, 8)
- Fare shown = trip list price; booking priced pro-rata for an early drop-off only on confirm (11 → 3.61).
Fix: `POST /bookings/preview` (same pricing path, no row); Booking gets free drop-off coords
(migration); seat page draws the route and snaps a pin to it (≤150 m).

## F. Trip-end stack (item 14a)
- payment `replace`s itself with `/trip`, leaving ride/seat beneath; complete `replace`s to tabs.
Fix: `goFresh(href)` = dismiss to root then push; used by payment → trip; complete → `goOut`.

## G. Biometrics (item 14b)
- `expo-local-authentication` in both apps; `useBiometricGate` in packages/ui; rider wallet + driver earnings.

## Verification
tsc both apps · maps tests · conditional-hooks.mjs · button-wiring · e2e harness if the stack is up.
