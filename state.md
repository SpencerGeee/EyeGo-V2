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

ALL 13 ITEMS SHIPPED. Commits 5203f3c, 8d7cfd5, c585279, 6e774ea,
00ae343, 8d8f2be, 02452d6, 7d558c3, 8e7ccb2, 2879783.
Both apps typecheck clean at every commit. NOTHING DEVICE-TESTED.

TWO THINGS DELIBERATELY NOT CHANGED, both from item 13:
- The "two cards that go to the same page" could not be reproduced from the
  code. `deriveDriverStage` makes the idle body (LiveTripCard) and TripStages
  mutually exclusive for every mapped status, so they cannot both draw. Needs a
  screenshot, or the trip status it happens on, before touching either.
- The blank home map is `DriverSurfaceMap`, whose camera moved into
  `useMapCamera`. The leftover `mapPadding` / `cameraRef` in home.tsx are dead
  code but are NOT the cause. Suspect a style/token env issue; unverified.

MIGRATION REQUIRED before item 7 works: `prisma migrate dev`
(Booking.dropoffStopId + the VirtualStop AlightingStop relation).

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
