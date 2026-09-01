# State — 2026-09-01

## Current Goal
21-item sweep across rider, driver and backend. All 21 addressed; nothing device-tested.

## Decisions
- `MorphTarget` defaults to `pointerEvents="box-none"`. A full-screen morph target was a
  screen-sized touch target over the map — the frozen request map and the unresponsive
  ride-picker map were both this.
- The morph clone's layout box is a CONSTANT SQUARE (`max(winW,winH)`), never the target rect.
  Zero React commits between takeoff and landing; `targetReady` corrections are pure
  shared-value writes. Square so circular morphs stay circular.
- `useMapCamera({ autoResumeMs })`. `null` = the user keeps the camera. Pre-trip maps pass null.
- `OverlayPortal` (react-native-screens `FullWindowOverlay`) wraps every root-mounted floating
  surface in both apps. A root sibling of the navigator is UNDER every iOS native modal.
- Party size is an input to the on-demand fare: free up to `RIDE_INCLUDED_SEATS` (4), then
  `RIDE_EXTRA_SEAT_RATE` (18%) of the metered ride per extra seat. Signed into the quote.
- Cancelling costs STANDING, not money: `RIDE_CANCEL_FEE_PESEWAS` default 0, and a trip in a
  pre-departure status can never incur a fee whatever the clock says.
- A rating is cast once — `driverRating.create`, 409 `ALREADY_RATED` on a second.

## Plan Status
All 21 items implemented. `npm test` 35/35 green; rider + driver `tsc --noEmit` clean;
all edited backend files pass `node --check`.

## Evidence
- `scripts/invariants.test.mjs` Pressable rule tightened — its two exemptions were hiding
  four live breakages (driver Pass button, Dispatch-blocked CTA, RideEndedSheet, trip.tsx)
  plus NoticeHost's action button.
- `apps/*/app.json` already carry `CADisableMinimumFrameDuration`. It is an Info.plist key:
  it cannot take effect through OTA, only a fresh native build.

## Open Issues
- Nothing device-tested; item 13 (120 Hz) needs a new EAS build to be observable at all.
- No prisma migration required by this pass (no schema change).
