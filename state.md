# state.md

## Current Goal
14-item sweep (2026-08-31): dispatch/toast/map polish, wallet-at-accept, rider redesigns, E2E harness.

## Plan Status
All 14 items implemented. Both apps `tsc --noEmit` green; backend `node --check` green;
`yarn test:invariants` 2/2. **Nothing device-tested — every item below needs a real handset.**

| # | Item | Where |
|---|---|---|
| 1 | Dispatch map polyline was a bowed arc | `DispatchLiveMap.useRoadLeg` fetches both legs via `/geo/route` |
| 2 | "Insufficient funds" at boarding | `cashFloatPesewas` on the offer + `assertCanAffordTrip` in `claimTrip` + card warning |
| 3 | Rider told nothing on driver no-show | new `rideEnded.store` + `RideEndedSheet`, mounted on rider home |
| 4 | Services glow borders overlapping | gaps `sm`→`base`, `glowRoom` padding, `maxGlowRadius` caps |
| 5 | Dispatch page overlap | sheet measured via `onLayout`; map padding + FAB read the measurement |
| 6 | "Looking for a driver" was static | `RequestStage` is map-first; `TripMap` draws an animated ROAD line to the asked driver |
| 7 | Driver toast + stale-trip nav | `DriverToast` rebuilt opaque w/ real CTA; `dest` moved onto toast state; terminal guard |
| 8 | Map-picker placeholder spaced out | `lineHeight` removed from the `TextInput` (both apps) |
| 9 | Seat hint missing on driver-created trips | `BOARDING_STATUSES`, and the hint moved to its own line |
| 10 | Straight polyline + false "at pickup" | `effectivePickup` reads `Route.originLat`; `AT_PICKUP_METERS` 150→75; `ensureRouteForTrip` pays for `toPickup` |
| 11 | Driver app lag | blooms + high-intensity blur removed from live-map screens; shader paused over full-bleed maps |
| 12 | E2E harness | 5 new suites + `run-all.mjs` + README |
| 13 | Map is pinchable, nothing said so | `MapGestureHint` on `ConfigureStage`, once per rider ever |
| 14 | Home dispatch map inert | `DispatchBoardMap` pins + body are tappable → same `open()` → morph |

## Decisions
- Dispatch offer geometry is fetched CLIENT-side (`/geo/route`), not added to the cascade payload:
  one driver views an offer at a time, and it cannot destabilise dispatch.
- The wallet check is a HARD refusal at `claimTrip` (402 + `details`), and only a WARNING on the
  card — the server is the authority, and greying the swipe out on a stale balance costs rides.
- Glow rings kept, glow BLOOMS dropped on live-map screens: the ring is one gradient, the bloom is
  2–4 iOS-shadowed views that re-rasterise whenever their content ticks.

## Open Issues
- `ensureRouteForTrip` now pays for the pre-departure `toPickup` leg. On a group trip whose driver
  is far away, both parties now see driver→pickup rather than the pickup→dropoff preview. Believed
  better (it is live and carries the ETA), but it is a behaviour change on the rider's fill-up page.
- `geo-routing.mjs` will fail loudly if `MAPBOX_SECRET_TOKEN` is unset — that is the point, but it
  means a first run on a fresh env reports a real config gap as a suite failure.
- The 5 new E2E suites have never been run: no local stack was up in this session.
