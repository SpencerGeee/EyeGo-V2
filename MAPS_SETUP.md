# Maps Setup (EyeGo Rider + Driver)

Both apps use **`react-native-maps`** (Google on Android / Apple on iOS) as
their map engine, in both Expo Go and custom/production builds.

Rider previously used `@maplibre/maplibre-react-native`, but v9 predates
Fabric support (MapLibre only added a New Architecture compat layer in v10,
with full support in v11 — a breaking API rewrite). Since `newArchEnabled` is
`true` (required by `react-native-reanimated` 4.x), mounting the v9 native
MapView crashed immediately under Fabric — this was the cause of the crash on
opening the "Where to?" screen. Rider was switched to the same
`react-native-maps`-based adapter the driver app already used successfully.

The map adapters (`utils/mapbox.ts` in each app) wrap every native `require` in
try/catch and fall back to a placeholder, so a missing/misconfigured map module
**never crashes the app** — at worst you see "Map unavailable".

**Driver app note:** `apps/driver/package.json` still lists
`@maplibre/maplibre-react-native` and `apps/driver/utils/mapbox.ts` still
imports it under the same `newArchEnabled: true` config as rider had. If any
driver screen ever mounts that native view, it will hit the identical crash.
Untouched here since it wasn't reported broken — apply the same fix if it is.

## Previewing
- **You cannot preview real maps in Expo Go** — neither Mapbox nor react-native-maps
  ships in it. Use a dev/preview build.
- **iPhone (sideload):** `eas build --profile preview --platform ios` → an installable
  IPA. Sideloadly re-signs it with your free Apple ID (7-day validity; enable iOS
  Developer Mode). Rider shows Mapbox; Driver shows **Apple Maps** (no key needed).
- **Android:** `eas build --profile preview --platform android`.

## Required environment variables (set in EAS secrets or `.env.local`)

| Variable | App | Needed for | If unset |
| --- | --- | --- | --- |
| `MAPBOX_DOWNLOADS_TOKEN` (secret, `sk.…`) | Rider | **Build** — fetches the Mapbox native SDK | **Android/iOS build FAILS** |
| `EXPO_PUBLIC_MAPBOX_TOKEN` (public, `pk.…`) | Rider | **Runtime** — loads map tiles | Blank map (no crash) |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Driver | **Android** tiles for react-native-maps | Blank tiles on Android (iOS Apple Maps still works) |

Notes:
- `MAPBOX_DOWNLOADS_TOKEN` is the **only** one that blocks the build. Get it from
  Mapbox → Account → Tokens (a secret scope `DOWNLOADS:READ` token).
- The driver app injects `android.config.googleMaps.apiKey` **only when the key is
  present**, so a keyless build still succeeds.
- Push notifications additionally need `google-services.json` — see `NOTIFICATIONS_SETUP.md`.
