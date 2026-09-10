# State — 2026-09-10

## Current Goal
Ship the 13-item driver/rider pass from the 2026-09-10 device test.

## Decisions (locked via /grill-me, 2026-09-10)

**7 — Alight early.** Rider picks from 3-6 *suggested stops that lie on the route
polyline*, never a free pin — zero detour by construction, no tolerance knob.
Stops are auto-derived at route creation (sample polyline, reverse-geocode, drop
any within ~2km of origin/dest) and PERSISTED as real `VirtualStop` rows, so
booking / `enRouteRatio` / driver stop list / admin all keep working unchanged.
Curated stops on fixed routes still win. Fare = (board→alight) ÷ route km,
mirroring `calculateEnRouteFare`, which already does the late-boarding half.

**10 — Included seats 4 → 3.** Runtime setting only (`RIDE_INCLUDED_SEATS`).
Rider on-demand already prices `partySize` correctly; 4 seats showing no change
was correct behaviour under the old value, not a bug.

**11 — Good standing gates at 1000 LIFETIME completed trips.** Below it: band
NEW, no badge, 0 bps. Lifetime not windowed — a windowed count switches the
discount off during a quiet month and reads as a bug.

**12 — Drop-off hidden until IN_PROGRESS (Start Trip).** Offer and en-route show
pickup + a neutral direction hint only ("heading W, ~18km").

**13 — Dispatch offer is a root-level full-screen takeover.** Above tabs, mounted
wherever the driver is, back/swipe are no-ops, leaves only on Accept / Pass /
expiry. Re-presented on foreground while the offer is still live.

**8 — Morph: slower with life.** ζ≈0.82 (from 1.00), flight ~510ms (from ~290ms),
clone held until the geometry lands. Root cause of "it's just a fade": clone
crossfades out at 200ms while the spring is still travelling.

**4 — Seat page.** Nose-up in portrait (rotate the reference frame 90°, no
scrolling, numbers upright). Faked perspective on flat Skia/SVG art — canvas
animated rotateX/rotateZ/scale from a low 3/4 view to top-down over ~900ms,
once per visit, no new dependency. Body template picked from `Vehicle.seaterCount`:
4-5 saloon, 7-9 van, 12-15 sprinter.

## Plan Status

DONE + COMMITTED
- **1** driver home constriction — `sheetContent` re-declared the gutter that
  `MapSheetHost` already applies: 32+32 = 64pt per side, a third of a 390pt
  screen. Removed. (Same trap exists nowhere else in a sheet body — the other
  `spacing['2xl']` hits are full screens that own their gutter. Checked.)
- **8** morph (commit 8d7cfd5) — see Decisions. Rider typecheck exit 0.
- **10** `RIDE_INCLUDED_SEATS` 4→3 (commit 5203f3c). Curve verified.
- **11** loyalty gate at 1000 lifetime (commit 5203f3c). Thresholds verified.

DIAGNOSED, NOT YET FIXED
- **12** dispatch. Server is fine: 45s TTL + a real `DISPATCH_OFFER_TIMEOUT`
  task + `expiresAtServerMs` on the socket payload. Two client-side causes:
  the in-place open path (home board → `openOffer`) builds its offer from the
  REST re-read, which hard-codes `expiresAtServerMs: null`, so the countdown
  never arms; and the offer payload carries no `geometry` at all, so
  `routeGeoJson` is null and the map falls back to a straight line. Needs:
  geometry on the offer, a non-null deadline on the in-place path, drop-off
  hidden until IN_PROGRESS, type scale down, one-glance layout.
- **13** driver home. `initialCenter` / `initialZoom` / `mapPadding` /
  `cameraRef` are all dead since the `DriverSurfaceMap` refactor — harmless but
  they are NOT the blank map; the camera moved into `useMapCamera`. The
  duplicate-card report is the `idle` body's `LiveTripCard` coexisting with a
  `TripStages` body; confirm `deriveDriverStage` before touching either.
- **5** driver mark-as-boarded freeze. `PassengerSheet` is `<Modal visible>`
  and the PIN keypad is a second `<Modal>`. Dismiss-then-present in overlapping
  ticks deadlocks on iOS. WEAKENED: `boardWithPin` awaits a network round trip
  before `setPinPrompt`, so the two modals should not overlap — do NOT commit to
  this theory without checking the `boardingRun` swipe path, which is the other
  way in and has no await.
- **9** rider pickup confirm → home. `useTripFlow` is module-scope zustand and
  is NOT persisted-but-also-not-reset, so stage should survive the round trip.
  `place-picker.handleConfirm` calls bare `goBack()` with no fallback href.
  Next step: check whether `trip.tsx` resets stage on mount and whether
  `where-to.tsx` replaces rather than pushes.

NOT STARTED
- **2** manage-trip camera, **3** tracking sheet pull-down, **4** seat page,
  **6** rider freeze on DRIVER_EN_ROUTE/ARRIVED, **7** alight-early feature.

## Evidence
- `standing.service.js:81` — `sampleSize < 3` is the current good-standing gate.
- `env.js:263` — `RIDE_INCLUDED_SEATS` default 4, `RIDE_EXTRA_SEAT_RATE` 0.18.
- `motion.ts:107` — `springs.morph` stiffness 195 damping 28 → ζ≈1.00, ~290ms.
- `MorphProvider.tsx:164` — `CROSSFADE_MS = 200`, shorter than the flight.
- Driver home `sheetContent` sets `paddingHorizontal: spacing['2xl']` inside
  `MapSheetHost` (`:151`) which already applies it → double gutter (items 1/13).
- `dispatch-cascade.service.js:85` — 45s TTL and a real `DISPATCH_OFFER_TIMEOUT`
  task exist; the offer payload carries NO `geometry` (straight line), and the
  in-place open path sets `expiresAtServerMs: null` (countdown never starts).
- `Booking.enRouteRatio` + `VirtualStop` + `calculateEnRouteFare` already price
  boarding late — item 7 is the mirror, not a new feature.

## Open Issues
- Nothing device-tested this session; needs a fresh build for native changes.
