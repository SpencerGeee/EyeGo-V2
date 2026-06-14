# EyeGo V2 Shared Packages — Enterprise-Grade Deep Audit Report

Generated: 2026-06-09

---

## packages/api/src/client.ts

```
FILE: packages/api/src/client.ts
LINE: ~72-90
SEVERITY: HIGH
TYPE: api-error
ISSUE: refreshPromise rejection leaks error to all piggyback callers. When the refresh fails, the `catch` block calls `onLogout()` and rejects with the *original* 401 error — not the refresh error. Any request that piggybacked on `refreshPromise` also awaits it; when it rejects they all enter the same `catch` and call `onLogout()` N times (once per piggybacked request), causing multiple redundant logout side-effects.
FIX: In the `catch` block, only reject once. Wrap `onLogout()` in a guard (e.g. a flag or debounce) to prevent multiple invocations from concurrent piggybacked requests that all land in catch simultaneously.
```

```
FILE: packages/api/src/client.ts
LINE: ~50
SEVERITY: MEDIUM
TYPE: api-error
ISSUE: No error handler on the request interceptor. If `getAccessToken()` throws (e.g. SecureStore throws on first cold-boot), the entire request chain crashes with an unhandled rejection rather than a meaningful error.
FIX: Add a second argument to `interceptors.request.use()` to pass through request errors: `(config) => {...}, (err) => Promise.reject(err)`.
```

```
FILE: packages/api/src/client.ts
LINE: ~30
SEVERITY: LOW
TYPE: config
ISSUE: Hardcoded API port fallback `'3000'` and hardcoded `/auth/refresh` default refresh URL are magic strings, not named constants.
FIX: Extract to named constants `DEFAULT_API_PORT` and `DEFAULT_REFRESH_PATH` at top of file.
```

---

## packages/api/src/socket.ts

```
FILE: packages/api/src/socket.ts
LINE: ~180-220
SEVERITY: HIGH
TYPE: socket-lifecycle
ISSUE: `disconnectDriverSocket()` calls `stopLeakMonitoring()` when `driverSocketRefs` reaches 0, but the leak monitoring interval (`_leakCheckInterval`) is SHARED with the passenger socket. If both sockets are connected simultaneously and the driver socket disconnects first, it stops leak monitoring for the passenger socket too.
FIX: Give the driver socket its own separate `_driverLeakCheckInterval` variable and `startDriverLeakMonitoring` / `stopDriverLeakMonitoring` pair, mirroring the passenger socket pattern exactly.
```

```
FILE: packages/api/src/socket.ts
LINE: ~160-178
SEVERITY: HIGH
TYPE: socket-lifecycle
ISSUE: `getDriverSocket()` does NOT call `startLeakMonitoring()` (or any driver-specific variant) after creating the driver socket instance. The passenger `getSocket()` calls `startLeakMonitoring()` on creation; the driver path is entirely unmonitored for listener accumulation.
FIX: Add `startDriverLeakMonitoring()` call inside `getDriverSocket()` after attaching `connect_error` listener, parallel to the passenger socket setup.
```

```
FILE: packages/api/src/socket.ts
LINE: ~95-115
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `DriverEtaPayload.geometry` is typed `any`. This field is passed to consumers and used for route rendering; its actual shape (GeoJSON LineString or similar) is known but not enforced, allowing silent misuse.
FIX: Define a `GeoJSONLineString` interface (or import from a GeoJSON types package) and type `geometry` as `GeoJSONLineString | null | undefined`.
```

```
FILE: packages/api/src/socket.ts
LINE: ~230-250
SEVERITY: MEDIUM
TYPE: socket-lifecycle
ISSUE: `socketEvents.onConnect`, `onDisconnect`, `onTripEta`, `onTripStatus`, `onSeatUpdate`, and all `driverSocketEvents` listeners are registered directly via `getSocket().on()` without any deduplication wrapper (unlike `onDriverLocation` which uses the `driverCallbacks` Map). If a component remounts without properly calling the returned cleanup function, duplicate listeners accumulate silently.
FIX: Apply the same `Map`-based wrapper pattern used for `onDriverLocation` to all other event registrations, or at minimum add a `once`-vs-`on` guard and document the contract clearly in JSDoc.
```

```
FILE: packages/api/src/socket.ts
LINE: ~45
SEVERITY: LOW
TYPE: socket-lifecycle
ISSUE: `refreshSocketAuth()` reconnects unconditionally — it calls `socket.disconnect()` then `socket.connect()` regardless of whether there are active event listeners. Any in-flight socket events are lost during the reconnect window and listeners are NOT re-attached automatically (socket.io client does re-attach on reconnect for persistent `.on()` handlers, but this is implicit and undocumented).
FIX: Add a comment documenting the reconnect contract. Consider emitting a local `auth:refreshed` event before disconnecting so consumers can prepare (e.g. stop polling UI).
```

---

## packages/types/src/trip.types.ts

```
FILE: packages/types/src/trip.types.ts
LINE: ~1
SEVERITY: HIGH
TYPE: type-gap
ISSUE: `TripTier` is `'ECONOMY' | 'COMFORT' | 'PREMIUM'` in types, but `TierBadge`, `TierSelector`, `RideCard`, and `TierSelectorProps` all only handle `'ECONOMY' | 'COMFORT'`. Passing a `PREMIUM` tier to any of these components results in TIER_CONFIG lookup returning `undefined`, causing a crash (or the `?? TIER_CONFIG.ECONOMY` fallback silently misrepresenting the tier).
FIX: Either add `PREMIUM` to `TIER_CONFIG` in `TierBadge` and `TierSelector`, or narrow `TripTier` in the shared types to exclude `PREMIUM` until it is fully supported.
```

```
FILE: packages/types/src/trip.types.ts
LINE: ~35
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `Trip.driver` is typed as non-optional (`driver: TripDriver`), but the driver field from the API can be null/undefined for unassigned trips (e.g. `SCHEDULED` status before a driver is matched). Accessing `trip.driver.name` without an optional check will throw.
FIX: Change to `driver?: TripDriver | null` and add `driver.id`, `driver.name` etc. as optional in `TripDriver`.
```

```
FILE: packages/types/src/trip.types.ts
LINE: ~20
SEVERITY: LOW
TYPE: type-gap
ISSUE: `Trip` is missing `driverId?: string` and `commissionRate?: number` fields that are returned by the API and accessed in the driver app via `(data as any)` casts.
FIX: Add `driverId?: string` and `commissionRate?: number` to the `Trip` interface.
```

---

## packages/types/src/booking.types.ts

```
FILE: packages/types/src/booking.types.ts
LINE: ~10
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `BookingStatus` includes `'SEAT_HELD'` but `StatusBadge`'s `BookingStatus` type and `STATUS_CONFIG` map do not include it. Passing a `SEAT_HELD` booking status to `StatusBadge` falls through to the `?? STATUS_CONFIG.PENDING` fallback, silently showing "Pending" instead of a proper label.
FIX: Add `SEAT_HELD: { label: 'Held', color: colors.secondary }` to `StatusBadge`'s `STATUS_CONFIG` and update its local `BookingStatus` type to include `'SEAT_HELD'`.
```

---

## packages/types/src/api.types.ts

```
FILE: packages/types/src/api.types.ts
LINE: ~1
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `PaginatedResponse<T>` uses a `pagination` object with `{ total, page, limit, totalPages }`, but several API endpoints return a flat structure `{ data, total, page, totalPages }` without the nesting. This mismatch causes `response.data.pagination` to be `undefined` at runtime in callers.
FIX: Audit actual API response shapes and either make `pagination` optional or add a union type / overloaded variant to accommodate both shapes.
```

```
FILE: packages/types/src/api.types.ts
LINE: ~25
SEVERITY: LOW
TYPE: type-gap
ISSUE: `DriverLocationEvent.heading` and `.speed` are typed `number`, but the socket normalization wrapper in `socket.ts` defaults them to `0` when missing. Consumers that render speed/heading UI will show `0` instead of `null`/`undefined`, making it impossible to distinguish "stopped" from "no data".
FIX: Type `heading?: number | null` and `speed?: number | null` in `DriverLocationEvent` and update the socket wrapper to pass `undefined` rather than `0` when missing.
```

---

## packages/utils/src/index.ts

```
FILE: packages/utils/src/index.ts
LINE: ~5
SEVERITY: HIGH
TYPE: util-crash
ISSUE: `formatCurrency(amount, currency)` — `amount` is typed `number` but no runtime guard exists. If `amount` is `NaN`, `undefined`, or `null` (possible from unvalidated API responses), calling `.toFixed(2)` returns `"NaN"`, producing display text like `"GH₵ NaN"`.
FIX: Add guard: `if (typeof amount !== 'number' || isNaN(amount)) return `${symbol} 0.00`;`
```

```
FILE: packages/utils/src/index.ts
LINE: ~17
SEVERITY: HIGH
TYPE: util-crash
ISSUE: `formatTripDate(isoString)` — no validation of the input string. If `isoString` is `null`, `undefined`, or an empty string, `new Date(isoString)` produces `Invalid Date` and `toLocaleDateString` returns `"Invalid Date"` rather than a graceful fallback.
FIX: Add guard: `if (!isoString) return '—'; const date = new Date(isoString); if (isNaN(date.getTime())) return '—';`
```

```
FILE: packages/utils/src/index.ts
LINE: ~58
SEVERITY: MEDIUM
TYPE: util-crash
ISSUE: `relativeTime(isoString)` — if `isoString` is an invalid date or in the future, `diff` is negative. The function falls through all `if (diff < N)` checks and calls `new Date(isoString).toLocaleDateString(...)`, which can return `"Invalid Date"` or a future date label with no "in X min" forward-time handling.
FIX: (a) Add invalid-date guard at the top. (b) Handle negative `diff` (future timestamps) with a branch like `if (diff < 0) return 'In ' + formatDuration(Math.abs(diff) / 60)` or `'Upcoming'`.
```

```
FILE: packages/utils/src/index.ts
LINE: ~80
SEVERITY: MEDIUM
TYPE: util-crash
ISSUE: `formatPhone(phone)` — if `phone` is `null` or `undefined`, calling `.replace(/\D/g, '')` throws `TypeError: Cannot read properties of null`.
FIX: Add guard: `if (!phone) return '';`
```

```
FILE: packages/utils/src/index.ts
LINE: ~42
SEVERITY: LOW
TYPE: util-crash
ISSUE: `formatDuration(minutes)` — if `minutes` is negative (e.g. passed a negative ETA delta), it returns a string like `-1h -30m` or `-5m`, which is confusing in UI.
FIX: Add `if (minutes <= 0) return '0m';` at the top.
```

```
FILE: packages/utils/src/index.ts
LINE: ~48
SEVERITY: LOW
TYPE: util-crash
ISSUE: `formatDistance(km)` — if `km` is negative or `NaN`, returns `"-1.0 km"` or `"NaN km"`.
FIX: Add `if (!km || km <= 0) return '0 m';` guard.
```

---

## packages/ui/src/Text.tsx

```
FILE: packages/ui/src/Text.tsx
LINE: ~5
SEVERITY: CRITICAL
TYPE: missing-export
ISSUE: `Text.tsx` imports `useColors` directly from `'../../../apps/rider/utils/useColors'` — a hard relative path that crosses package boundaries into the rider app. This makes `@eyego/ui` non-portable: the driver app cannot use `Text` without having an identical file at that path, and the import will fail entirely in any context outside the monorepo's exact directory structure (e.g. unit tests, Storybook, the driver app).
FIX: Move `useColors` (and its `Colors` type) to `@eyego/config` or `@eyego/utils`, export it from there, and update the import in `Text.tsx`.
```

```
FILE: packages/ui/src/Text.tsx
LINE: ~45
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `variantStyles` is typed `Record<TextVariant, TextStyle>` and indexed with `variant` directly. If a caller passes a `variant` string that is not in the union (possible in JS contexts or via `as any`), `variantStyles[variant]` is `undefined`, causing React Native to silently apply no style or crash on some RN versions.
FIX: Add a runtime fallback: `variantStyles[variant] ?? variantStyles['bodyMedium']`.
```

---

## packages/ui/src/AnimatedFareText.tsx

```
FILE: packages/ui/src/AnimatedFareText.tsx
LINE: ~60
SEVERITY: MEDIUM
TYPE: ui-crash
ISSUE: `displayValue.toFixed(2)` — if `value` prop is `NaN` (passed from an unvalidated API fare field), `displayValue` is initialized to `NaN`, `toFixed(2)` returns `"NaN"`, and the display shows `"GH₵ NaN"`. No NaN guard exists.
FIX: Normalize value at the top of the component: `const safeValue = (typeof value === 'number' && !isNaN(value)) ? value : 0;` and use `safeValue` throughout.
```

```
FILE: packages/ui/src/AnimatedFareText.tsx
LINE: ~30-55
SEVERITY: LOW
TYPE: ui-crash
ISSUE: The setInterval-based animation uses `Animated.Value` (legacy API) — created with `useRef(new Animated.Value(value)).current` — but `animatedValue` is never actually used in the render output. The rendered text comes from `displayValue` state updated in the interval. The `animatedValue` ref is dead code that wastes memory.
FIX: Remove the unused `animatedValue` ref entirely, or switch fully to the Reanimated `useSharedValue` pattern used by other components.
```

---

## packages/ui/src/Input.tsx

```
FILE: packages/ui/src/Input.tsx
LINE: ~35
SEVERITY: MEDIUM
TYPE: ui-crash
ISSUE: `const AnimatedText = Animated.createAnimatedComponent(require('react-native').Text)` — using `require()` at module scope bypasses TypeScript typing and will throw in environments where `require` is not available (Metro bundler tree-shaking edge cases, or Jest with `transformIgnorePatterns` misconfiguration).
FIX: Use a proper ES import: `import { Text as RNText } from 'react-native';` and `const AnimatedText = Animated.createAnimatedComponent(RNText);`
```

```
FILE: packages/ui/src/Input.tsx
LINE: ~42
SEVERITY: LOW
TYPE: type-gap
ISSUE: `labelAnim` initial value is `value ? 1 : 0`. If `value` is `undefined` (Input is uncontrolled), label starts at 0 (floating). When a parent later passes a `value` prop (e.g. after hydrating from storage), the label never jumps to position 1 because `labelAnim` is only updated by `handleFocus`/`handleBlur`. This causes the label to overlap the pre-filled text.
FIX: Add a `useEffect` that watches `value` and sets `labelAnim.value = value ? 1 : 0` whenever `value` changes from outside the component (when not focused).
```

---

## packages/ui/src/RideCard.tsx

```
FILE: packages/ui/src/RideCard.tsx
LINE: ~25
SEVERITY: MEDIUM
TYPE: ui-crash
ISSUE: `const available = total - confirmed - pending` can be negative if the API returns `confirmedSeats + pendingSeats > maxCapacity` (e.g. a data race on the backend). This negative number is displayed as-is in the UI (e.g. `-2 seats left`).
FIX: Clamp: `const available = Math.max(0, total - confirmed - pending);`
```

```
FILE: packages/ui/src/RideCard.tsx
LINE: ~15
SEVERITY: LOW
TYPE: type-gap
ISSUE: `RideCardTrip` is a local interface duplicating fields from the shared `Trip` type in `@eyego/types`. If `Trip` fields are renamed or types are changed, `RideCardTrip` silently diverges.
FIX: Replace `RideCardTrip` with `Pick<Trip, 'id' | 'tier' | 'scheduledAt' | 'farePerSeat' | ...>` imported from `@eyego/types`, or extend `Trip` with `Partial`.
```

---

## packages/ui/src/GlassCard.tsx

```
FILE: packages/ui/src/GlassCard.tsx
LINE: ~42
SEVERITY: LOW
TYPE: config
ISSUE: `borderRadius: 20` is hardcoded in `styles.container` instead of using `radii['2xl']` (which is also 24) or `radii.xl` (20 — exact match exists). Inconsistency with the token system.
FIX: Replace `borderRadius: 20` with `borderRadius: radii.xl` from `@eyego/config`.
```

---

## packages/ui/src/StatusBadge.tsx

```
FILE: packages/ui/src/StatusBadge.tsx
LINE: ~12
SEVERITY: MEDIUM
TYPE: config
ISSUE: `PENDING` status color `'#FFB800'` and `BOARDED` status color `'#30D158'` are hardcoded hex values not present in the design token system (`@eyego/config` colors). These will not adapt if the design system is updated and cannot be themed.
FIX: Add `warning: '#FFB800'` and `success: '#30D158'` (or `online`) to `colors` in `tokens.ts`, then reference them via `colors.warning` and `colors.success`.
```

```
FILE: packages/ui/src/StatusBadge.tsx
LINE: ~8
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: Local `BookingStatus` type does not include `'SEAT_HELD'` (which exists in `@eyego/types` `BookingStatus`). The `?? STATUS_CONFIG.PENDING` fallback means a `SEAT_HELD` booking silently displays as "Pending".
FIX: Import `BookingStatus` from `@eyego/types` instead of redefining it locally, and add `SEAT_HELD` to `STATUS_CONFIG`.
```

---

## packages/ui/src/SeatBadge.tsx

```
FILE: packages/ui/src/SeatBadge.tsx
LINE: ~11
SEVERITY: MEDIUM
TYPE: config
ISSUE: `pending: '#FFB800'` is hardcoded. Same issue as `StatusBadge` — not a design token.
FIX: Add `colors.warning` token and reference it here.
```

---

## packages/ui/src/TierBadge.tsx

```
FILE: packages/ui/src/TierBadge.tsx
LINE: ~8
SEVERITY: MEDIUM
TYPE: type-gap
ISSUE: `TierBadge` accepts `tier: 'ECONOMY' | 'COMFORT'` but the shared `TripTier` type also includes `'PREMIUM'`. The local `Tier` type is narrower than the shared type, creating a type mismatch when passing a `TripTier` value directly. TypeScript will catch this in strict mode, but the `?? TIER_CONFIG.ECONOMY` fallback silently misrepresents PREMIUM trips as Economy in JS/non-strict builds.
FIX: Either handle `PREMIUM` in `TIER_CONFIG`, or import `TripTier` from `@eyego/types` and use it as the prop type to make the mismatch a compile-time error.
```

---

## packages/ui/src/DriverInfoCard.tsx

```
FILE: packages/ui/src/DriverInfoCard.tsx
LINE: ~8
SEVERITY: LOW
TYPE: type-gap
ISSUE: Local `TripDriver` and `Vehicle` interfaces duplicate fields from `@eyego/types`. Same divergence risk as `RideCard`.
FIX: Import `TripDriver` and `Vehicle` from `@eyego/types` and use `Partial<TripDriver>` to preserve the optional-field semantics needed by this component.
```

---

## packages/ui/src/EmptyState.tsx

```
FILE: packages/ui/src/EmptyState.tsx
LINE: ~18
SEVERITY: LOW
TYPE: ui-crash
ISSUE: `LottieView = require('lottie-react-native').default` is called on every render inside the component body (not in a `useEffect` or module-level lazy init). While the `try/catch` prevents crashes, calling `require()` on every render is inefficient and can cause subtle issues with Fast Refresh.
FIX: Move the lazy require to module level with a `let LottieView: any = null; try { LottieView = require('lottie-react-native').default; } catch {}` pattern outside the component.
```

---

## packages/config/src/tokens.ts

```
FILE: packages/config/src/tokens.ts
LINE: ~6
SEVERITY: MEDIUM
TYPE: config
ISSUE: No light-mode color palette exists. `colors` and `driverColors` are exclusively dark-theme tokens. Any future light-mode support (or system-default theming) would require a full parallel token set. There is no `semanticColors` or `themeColors` abstraction layer.
FIX: Introduce a `lightColors` export (even as a stub) and a `ThemeColors` interface that both `colors` and `lightColors` implement, to lock in the contract for future theming.
```

```
FILE: packages/config/src/tokens.ts
LINE: ~150
SEVERITY: LOW
TYPE: config
ISSUE: `animation.timing` is a function `(duration = 300) => ({...})` but is declared inside `as const`. The `as const` assertion on the outer object does not deeply freeze function return values, meaning its return type is inferred as `{ type: 'timing'; duration: number }` but is NOT `const`-narrowed. This causes subtle typing differences vs. the `spring` variants.
FIX: Either keep `timing` as a standalone exported function outside the `animation` const object, or accept the typing limitation with a JSDoc note.
```

---

## packages/config/src/index.ts

```
FILE: packages/config/src/index.ts
LINE: ~1
SEVERITY: MEDIUM
TYPE: missing-export
ISSUE: `index.ts` only re-exports `./tokens` and `./fonts`. It does NOT explicitly export individual named exports, relying on `export * from`. If `tokens.ts` or `fonts.ts` ever have name collisions, the wildcard re-export will silently shadow one. Additionally, `driverColors`, `animation`, `shadows`, and `driverColors` are exported but not documented — consumers may not know they exist.
FIX: Switch to explicit named re-exports: `export { colors, driverColors, spacing, radii, shadows, animation } from './tokens'; export { fonts, fontSizes, letterSpacings } from './fonts';` for clarity and collision safety.
```

---

## packages/api/src/index.ts

```
FILE: packages/api/src/index.ts
LINE: ~30
SEVERITY: MEDIUM
TYPE: missing-export
ISSUE: Socket payload types (`ChatMessagePayload`, `PrivateChatMessagePayload`, `TypingPayload`, `ReadReceiptPayload`, `ChatHistoryPayload`, `SafetyCheckPayload`, `DriverEtaPayload`, `TripStatusPayload`) are defined in `socket.ts` but NOT re-exported from `index.ts`. Consumers cannot import them from `@eyego/api` and must use deep imports to `@eyego/api/src/socket`, which bypasses the package boundary.
FIX: Add `export type { ChatMessagePayload, PrivateChatMessagePayload, TypingPayload, ReadReceiptPayload, ChatHistoryPayload, SafetyCheckPayload, DriverEtaPayload, TripStatusPayload } from './socket';` to `index.ts`.
```

```
FILE: packages/api/src/index.ts
LINE: ~5
SEVERITY: LOW
TYPE: missing-export
ISSUE: `SocialLoginRequest` interface defined in `auth.api.ts` is not re-exported from `index.ts`, preventing typed usage of `authApi.socialLogin()` without a deep import.
FIX: Add `export type { SocialLoginRequest } from './auth.api';`
```

---

## Summary Table

| # | File | Line | Severity | Type | Short Description |
|---|------|------|----------|------|-------------------|
| 1 | api/client.ts | ~72 | HIGH | api-error | onLogout() called N times from N piggybacked 401s on refresh failure |
| 2 | api/client.ts | ~50 | MEDIUM | api-error | No error handler on request interceptor |
| 3 | api/socket.ts | ~180 | HIGH | socket-lifecycle | Shared `_leakCheckInterval` stopped by driverSocket disconnect, killing passenger monitoring |
| 4 | api/socket.ts | ~160 | HIGH | socket-lifecycle | `getDriverSocket()` never calls `startLeakMonitoring()` |
| 5 | api/socket.ts | ~95 | MEDIUM | type-gap | `DriverEtaPayload.geometry` typed `any` |
| 6 | api/socket.ts | ~230 | MEDIUM | socket-lifecycle | Most socket event registrations have no deduplication wrapper |
| 7 | api/socket.ts | ~45 | LOW | socket-lifecycle | `refreshSocketAuth()` drops in-flight events with no consumer warning |
| 8 | api/index.ts | ~30 | MEDIUM | missing-export | Socket payload types not re-exported from package index |
| 9 | api/index.ts | ~5 | LOW | missing-export | `SocialLoginRequest` not re-exported |
| 10 | types/trip.types.ts | ~1 | HIGH | type-gap | `PREMIUM` tier in `TripTier` not handled by `TierBadge`/`TierSelector` |
| 11 | types/trip.types.ts | ~35 | MEDIUM | type-gap | `Trip.driver` non-optional but can be null/undefined from API |
| 12 | types/trip.types.ts | ~20 | LOW | type-gap | `Trip` missing `driverId` and `commissionRate` fields |
| 13 | types/booking.types.ts | ~10 | MEDIUM | type-gap | `SEAT_HELD` status not handled in `StatusBadge` |
| 14 | types/api.types.ts | ~1 | MEDIUM | type-gap | `PaginatedResponse.pagination` nesting mismatches some API endpoints |
| 15 | types/api.types.ts | ~25 | LOW | type-gap | `heading`/`speed` default to `0` not `null`, masking "no data" state |
| 16 | utils/index.ts | ~5 | HIGH | util-crash | `formatCurrency(NaN)` renders "GH₵ NaN" |
| 17 | utils/index.ts | ~17 | HIGH | util-crash | `formatTripDate(null/undefined/'')` renders "Invalid Date" |
| 18 | utils/index.ts | ~58 | MEDIUM | util-crash | `relativeTime` has no future-date or invalid-date handling |
| 19 | utils/index.ts | ~80 | MEDIUM | util-crash | `formatPhone(null)` throws TypeError |
| 20 | utils/index.ts | ~42 | LOW | util-crash | `formatDuration(negative)` renders negative string |
| 21 | utils/index.ts | ~48 | LOW | util-crash | `formatDistance(NaN/negative)` renders garbage |
| 22 | ui/Text.tsx | ~5 | CRITICAL | missing-export | Hard cross-package import `'../../../apps/rider/utils/useColors'` breaks driver app and tests |
| 23 | ui/Text.tsx | ~45 | MEDIUM | type-gap | No fallback if unknown `variant` string is passed |
| 24 | ui/AnimatedFareText.tsx | ~60 | MEDIUM | ui-crash | `value=NaN` renders "GH₵ NaN" |
| 25 | ui/AnimatedFareText.tsx | ~30 | LOW | ui-crash | Unused `animatedValue` Animated.Value ref (dead code) |
| 26 | ui/Input.tsx | ~35 | MEDIUM | ui-crash | `require('react-native').Text` at module scope bypasses TS typing |
| 27 | ui/Input.tsx | ~42 | LOW | type-gap | `labelAnim` not updated when `value` changes externally (pre-filled text overlap) |
| 28 | ui/RideCard.tsx | ~25 | MEDIUM | ui-crash | `available` seats can be negative — displayed as-is |
| 29 | ui/RideCard.tsx | ~15 | LOW | type-gap | Local `RideCardTrip` duplicates `@eyego/types Trip`, risk of divergence |
| 30 | ui/GlassCard.tsx | ~42 | LOW | config | `borderRadius: 20` hardcoded instead of `radii.xl` token |
| 31 | ui/StatusBadge.tsx | ~12 | MEDIUM | config | `#FFB800` and `#30D158` hardcoded, not design tokens |
| 32 | ui/StatusBadge.tsx | ~8 | MEDIUM | type-gap | Local `BookingStatus` missing `SEAT_HELD`; silently shows "Pending" |
| 33 | ui/SeatBadge.tsx | ~11 | MEDIUM | config | `#FFB800` hardcoded, not a design token |
| 34 | ui/TierBadge.tsx | ~8 | MEDIUM | type-gap | Local `Tier` narrower than `TripTier`; `PREMIUM` silently falls back to Economy |
| 35 | ui/DriverInfoCard.tsx | ~8 | LOW | type-gap | Local `TripDriver`/`Vehicle` duplicates shared types |
| 36 | ui/EmptyState.tsx | ~18 | LOW | ui-crash | `require('lottie-react-native')` called on every render |
| 37 | config/tokens.ts | ~6 | MEDIUM | config | No light-mode token palette; no `ThemeColors` interface for future theming |
| 38 | config/tokens.ts | ~150 | LOW | config | `animation.timing` function inside `as const` object has inconsistent type narrowing |
| 39 | config/index.ts | ~1 | MEDIUM | missing-export | Wildcard re-export risks silent name collision; undiscoverable named exports |
