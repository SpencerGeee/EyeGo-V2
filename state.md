# State — Stress Sweep 2026-08-11b (items 1–32)

## Status: COMPLETE for every item received. Pushed.

Items **8–22 were truncated out of the user's message and never received**. The
user could not recall them ("I was stress testing on the go") and will re-capture
them in the next round. Item 23 was only half-visible in the transcript. Item 27
was a confirmation, not a defect — no work needed.

## Commits (7)
| SHA | Items |
|---|---|
| `6b91f19` | 2, 3, 6, 31 |
| `44720bf` | 4 — where-to rebuilt as driver-style Skia screen |
| `7d20378` | 1 (part) — matching screen had no background |
| `49852f4` | 28, 29, 30 |
| `d23616f` | 7, 25 — invite polyline, brand map, ETA, load speed |
| `d03a7e9` | 5, 24, 26 — driver manage sheet |
| `2b0698a` | 1 (part) — SelectStage back nav |

## Decisions locked with the user (do not re-ask)
- **#4**: full-screen route mirroring `apps/driver/app/(trip)/create.tsx`;
  suggestions = saved Home/Work + recents only.
- **#1 back nav**: header chevron + hardware back + edge-swipe step back ONE
  stage.
- **#28 fee**: `max(DOORSTEP_MIN_FEE, detourKm × DOORSTEP_PER_KM)`, refused past
  `DOORSTEP_MAX_DETOUR_KM`, Configure-stage toggle, all trips.
- **#28 at-pickup**: `PICKUP_ARRIVAL_RADIUS_M` = 150 m.
- **#24**: port rider TrackingStage system to driver (absorbed 5 and 26).

## Verification
- `apps/rider` and `apps/driver` `tsc --noEmit` → **exit 0**.
- `node --check` clean on every changed backend file.
- Inline JS of both public HTML pages parses.
- **NOTHING device-tested.** Crash/visual fixes need a new EAS build; backend
  fixes need a deploy.

## New env knobs (add to deployment config)
`PICKUP_ARRIVAL_RADIUS_M` (150), `DOORSTEP_MIN_FEE` (3.0),
`DOORSTEP_PER_KM` (4.0), `DOORSTEP_MAX_DETOUR_KM` (3.0). All have defaults.

## Traps re-learned this session
- `GradientGlowBorder` requires `fillColor`; the reach cap is **`maxGlowRadius`**.
  Clipped glow = padding + cap, never a lower `glowIntensity`.
- `ARRIVED_AT_PICKUP` is reachable ONLY from `DRIVER_EN_ROUTE`.
- `where-to.tsx` is a redirect stub; the real screen is `SearchStage.tsx`.
- `@eyego/map-styles` is NOT a dependency of `eyego-api` — read from disk.
- `npx` is broken here: `node node_modules/typescript/lib/tsc.js --noEmit` from
  inside `apps/<app>`.
