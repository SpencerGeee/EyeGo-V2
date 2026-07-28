# State — 2026-07-28 (stress-test fix pass #2)

## Current Goal
Fix 10 stress-test defects across rider, driver and backend; commit + push.

## Plan Status
All 10 items implemented. `tsc --noEmit` green for apps/rider and apps/driver;
`node --check` green on every touched backend file. NOT device-tested — the
map-adapter changes are native-behaviour changes and need a fresh build.

| # | Issue | Fix |
|---|-------|-----|
| 1 | Where-to pickup/destination rows collapsed to icons | Card pinned to `useWindowDimensions()` width in `SearchStage.tsx` |
| 2 | Driver tracking map at world zoom | Camera now pushes its first stop imperatively once attached (`packages/maps`) |
| 3 | Suggested-trip SIGABRT | Camera no longer mounted during the map's first (possibly zero-size) layout |
| 4 | Map-picker Confirm greyed out | v11 region-event payload normalised; pin seeded on open; Confirm falls back to a dropped pin |
| 5 | Weak/blank place search | `utils/geocoding.ts` now merges Photon (autocomplete) + Nominatim, bias-ranked |
| 6 | Rider request never reached a free driver | Stale-trip sweep + Redis geo-set treated as a hint, not a membership list |
| 7 | Activity "requesting a trip" card clipped | `paddingTop: GLOW_BLEED` on the list |
| 8 | Cross-tenant snooping | `getTrip` is viewer-scoped; `searchTrips` lists only joinable public trips |
| 9 | Scheduled card clipped / missing in Activity | Live hero card added to the Scheduled tab, hero de-duplicated, top padding |
| 10 | Phantom "Resume Trip" | `getActiveTrip` excludes (and expires) abandoned SCHEDULED/FILLING trips |

## Evidence
- Crash log `ios crash logs/EyeGo-2026-07-28-164400.ips`: SIGABRT,
  `-[MLRNCamera _setInitialCamera]` → `-[CameraUpdateItem _moveCamera:…]` →
  MapLibre `__cxa_throw`.
- Read maplibre-react-native 11.3.6 native sources: `MLRNCameraComponentView.mm`
  always builds a non-nil `initialViewState`, so `_setInitialCamera`'s nil guard
  never fires; `MLRNMapView.layoutSubviews` runs `initialLayout` on the first
  layout pass even at zero size; `-[MLRNCamera setMap:]` has its camera-apply
  calls commented out upstream.
- `Map.tsx` in the same package: region events are a flat `ViewState`
  (`{center, zoom, bearing, pitch, bounds, userInteraction}`), not the legacy
  GeoJSON `{geometry, properties}` every screen was still reading.

## Open Issues
- Nothing verified on a real device this session; items 1–4 and 9 are visual and
  need a fresh EAS/sideload build (native map behaviour, not OTA-safe).
- `Trip.status` now takes a new `'EXPIRED'` value. It is a plain string column so
  no migration is needed, but any admin filter that enumerates statuses should be
  checked against it.
