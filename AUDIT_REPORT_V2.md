# EyeGo Comprehensive Audit Report v2

## 🔴 SECURITY GAPS (22 found)

| # | Severity | Gap | Location | Impact |
|---|----------|-----|----------|--------|
| S1 | CRITICAL | Hardcoded fallback Mapbox token exposed in source | `rider/app/_layout.tsx:17` | Token can be extracted from JS bundle; rate-limited/revoked by Mapbox |
| S2 | HIGH | Overly permissive CORS in non-production | `eyego-api/src/app.js:61` | Wildcard origin allows any domain to make API calls |
| S3 | HIGH | Admin secret key sent as plaintext header without HTTPS | `rider/packages/api` | Credential sniffing on MITM attacks |
| S4 | HIGH | OTP dev_otp exposed in production API responses | `rider/app/(auth)/phone.tsx:40` | Anyone with network logs can bypass OTP verification |
| S5 | HIGH | No rate limiting on auth endpoints (phone, OTP) | `eyego-api/src/modules/auth/` | Brute-force OTP guessing, SMS bombing |
| S6 | MEDIUM | Guest checkout stores PII (name/phone) in Zustand persisted state | `rider/stores/ride.store.ts` | Sensitive data persisted in AsyncStorage without encryption |
| S7 | MEDIUM | JWT access token has no server-side revocation list check on all endpoints | `eyego-api/src/middleware/auth.js` | Only checks blacklist on passenger auth; driver auth may lack it |
| S8 | MEDIUM | No CSRF protection on admin routes | `eyego-api/src/middleware/adminAuth.js` | Only secret key check, no CSRF token |
| S9 | MEDIUM | WebView URL validation bypass risk for Paystack callbacks | `rider/app/ride/[id]/payment.tsx` | Non-whitelisted domains accepted if they have reference= param |
| S10 | MEDIUM | SecureStore used without biometric authentication | Both apps | Sensitive tokens accessible if device is unlocked |
| S11 | MEDIUM | No audit logging for admin CRUD actions | `eyego-api/src/modules/admin/` | No trail of who created/updated routes, suspended drivers |
| S12 | MEDIUM | FCM push token not validated server-side | `eyego-api/src/services/push.service.js` | Invalid tokens waste push service resources |
| S13 | MEDIUM | Refresh token rotation may leak old tokens | `eyego-api/src/modules/auth/` | Old refresh tokens remain valid after rotation |
| S14 | LOW | No certificate pinning for API communications | Both apps | Trust-all CAs allows MITM with forged certs |
| S15 | LOW | No SQL injection prevention beyond Prisma's built-in | `eyego-api/src/modules/` | Raw queries could be vulnerable if added later |
| S16 | LOW | Admin dashboard has no session timeout | `eyego-api/public/index.html` | Secret stored in localStorage indefinitely |
| S17 | LOW | Trip cancellation API allows cancelling other user's bookings | `eyego-api/src/modules/bookings/` | Missing ownership verification |
| S18 | LOW | No request size validation on file uploads | `eyego-api/src/app.js` | Upload limit set to '10mb' but no dimension validation |
| S19 | LOW | Environment schema rejects production startup if optional vars missing | `eyego-api/src/config/env.js` | FIREBASE vars are required but some deployments may not need push |
| S20 | MEDIUM | Admin dashboard XSS - status labels rendered via innerHTML | `eyego-api/public/index.html` | Status values inserted into DOM could execute scripts if malicious |
| S21 | MEDIUM | Driver wallet check before going online uses stale data | `driver/app/(tabs)/home.tsx` | Wallet balance from stale cache could allow negative-balance online |
| S22 | LOW | No rate limiting on admin routes (adminLimiter applied but max 30 per 15min is generous) | `eyego-api/src/modules/admin/admin.routes.js` | Admin brute-force attack on secret key |

## 🟡 FUNCTIONAL GAPS (22 found)

| # | Severity | Gap | Location | Impact |
|---|----------|-----|----------|--------|
| F1 | CRITICAL | Driver trips page shows empty for active segment when trips exist | `driver/app/(tabs)/trips.tsx` | Uses separate `driverApi.getActiveTrip()` which returns null if no active trip ID set |
| F2 | HIGH | No pagination on any trips list (loads all at once) | Both apps `trips.tsx` | Performance degradation with 500+ trips |
| F3 | HIGH | Offline queue flushes only at startup, no periodic retry | `rider/utils/offlineQueue.ts` | Queued actions stuck if flush fails on first attempt |
| F4 | HIGH | Socket reconnection uses linear backoff (3s fixed) | `driver/app/(tabs)/home.tsx` | Connection storms during network recovery |
| F5 | MEDIUM | No data refresh when app returns to foreground on rider side | `rider/app/(tabs)/home.tsx` | Stale ride data after app is backgrounded for hours |
| F6 | MEDIUM | Guest booking - no validation that guest name/phone are filled | `rider/app/ride/[id]/payment.tsx` | Can create booking with empty guest info |
| F7 | MEDIUM | Wallet balance not refreshed after successful payment | `rider/app/ride/[id]/payment.tsx` | Rider doesn't see updated wallet after wallet payment |
| F8 | MEDIUM | No loading state on profile edit/document screens | `driver/app/(profile)/` | Blank screen renders while data loads |
| F9 | MEDIUM | No retry button on failed image uploads | `rider/app/(auth)/register.tsx` | Upload failure silently fails, user can't retry without restarting flow |
| F10 | MEDIUM | Cancellation reason prompt on admin side doesn't validate | `eyego-api/public/index.html` | Empty string can be sent as reason |
| F11 | MEDIUM | Admin dashboard - drivers page shows 'none' despite data in overview | `eyego-api/public/index.html` | Fixed in earlier conversation but root cause was pagination wrapper |
| F12 | MEDIUM | Push notification deep links don't work for all notification types | `rider/app/_layout.tsx` | Some notification types lack route handlers |
| F13 | LOW | No reconnection backoff for WebSocket (linear, not exponential) | `driver/app/(tabs)/home.tsx` | Server reconnect storms |
| F14 | LOW | No pagination on bookings query (limit: 1 on completed count) | `rider/app/(tabs)/profile.tsx` | Inefficient query for count |
| F15 | LOW | Driver quests tab uses hardcoded empty state | `driver/app/(tabs)/quests.tsx` | No way to test quest flow |
| F16 | LOW | No trip re-assignment timeout display for dispatch | `driver/app/(trip)/dispatch/` | Driver doesn't know when dispatch expires |
| F17 | LOW | Admin lacks SOS event monitoring dashboard | `eyego-api/public/index.html` | No visibility into emergency events |
| F18 | LOW | No driver vehicle inspection scheduling in admin | `eyego-api/public/index.html` | Missing fleet management feature |
| F19 | LOW | No notification preferences UI properly connected to backend | `rider/app/profile/notification-preferences.tsx` | UI exists but may not call correct API |
| F20 | LOW | Driver can't see which passengers have boarded vs booked | `driver/app/(trip)/active/` | No boarding status per booking |
| F21 | MEDIUM | TripsScreen Active segment shows empty because `activeTrip` query filters incorrectly | `driver/app/(tabs)/trips.tsx:55-57` | Only shows trip if `driverApi.getActiveTrip()` returns non-null |
| F22 | LOW | Admin dashboard no loading skeletons for modals | `eyego-api/public/index.html` | Modal opens empty before async data loads |

## 🟠 UI/UX GAPS (20 found)

| # | Severity | Gap | Location | Impact |
|---|----------|-----|----------|--------|
| U1 | HIGH | No dark/light mode toggle in rider app (only driver has theme) | `rider/app/(tabs)/` | Rider stuck in dark mode, no user preference |
| U2 | HIGH | FlatList estimated item size may cause scroll jump | `rider/app/(tabs)/trips.tsx` | List jumps on first render |
| U3 | MEDIUM | No pull-to-refresh on notifications screen (uses refetch but no visible control) | `rider/app/(tabs)/notifications.tsx` | User can't manually refresh notifications |
| U4 | MEDIUM | No skeleton loading on driver profile screen | `driver/app/(tabs)/profile.tsx:167` | Shows ActivityIndicator instead of contextual skeleton |
| U5 | MEDIUM | Inconsistent border radius on cards across screens | Both apps | Some use xl (14), others 2xl (16) for similar elements |
| U6 | MEDIUM | No haptic feedback on critical interactions in driver app | `driver/app/(tabs)/home.tsx` | Missing tactile feedback for online toggle, trip start |
| U7 | MEDIUM | Keyboard avoidance not applied on settings screens | `driver/app/(profile)/` | Input fields hidden behind keyboard |
| U8 | MEDIUM | No toast/notification sounds for offline state changes | Both apps | Banner is silent, user may miss connectivity change |
| U9 | LOW | Long phone numbers overflow on profile cards | Both apps' profile screens | No ellipsis or wrapping for long numbers |
| U10 | LOW | No swipe-to-go-back on some modal screens | Both apps | User forced to use close button |
| U11 | LOW | Status bar color doesn't change with theme toggle | `driver/app/_layout.tsx` | Light theme still shows light status bar text |
| U12 | LOW | No scroll-to-top button on long lists | Both apps' trip/notifications lists | User must scroll manually to top |
| U13 | LOW | Inconsistent font usage - some places use RNText instead of custom Text component | `driver/app/_layout.tsx` | Styling inconsistencies |
| U14 | LOW | Bottom sheet handle not visible when closed on driver earnings | `driver/app/(tabs)/earnings.tsx` | Visual inconsistency when sheet is dismissable |
| U15 | LOW | Empty state for driver transactions when wallet is new shows nothing | `driver/app/(tabs)/earnings.tsx` | Better empty state needed |
| U16 | LOW | No shimmer loading on setting screens | `driver/app/(profile)/` | Blank loading state is jarring |
| U17 | LOW | No drag-to-reorder for saved places | `rider/app/profile/saved-places.tsx` | Expected UX for list management |
| U18 | LOW | Inconsistent animation durations between screens | Both apps | Some use 300ms, others use 500ms for similar transitions |
| U19 | MEDIUM | Admin dashboard modal scroll lock not applied consistently | `eyego-api/public/index.html` | Background scrolls behind open modals on some pages |
| U20 | LOW | No error toast for failed image uploads in profile edit | `driver/app/(profile)/edit.tsx` | Upload failure silently ignored |

---

## Priority Fix Plan

### PHASE 1 - Critical (Fix immediately)
- **F1**: Fix driver trips active segment - separate query returns null
- **S1**: Remove hardcoded Mapbox fallback token
- **S4**: Remove dev_otp from API response in production
- **F2**: Add pagination to trips in both apps

### PHASE 2 - High Priority
- **S2**: Add proper CORS origin validation
- **S5**: Add rate limiting to auth endpoints
- **S6**: Don't persist PII guest data to AsyncStorage
- **F3**: Add periodic offline queue retry
- **F4**: Implement exponential backoff for socket reconnection
- **F7**: Refresh wallet after payment

### PHASE 3 - Medium Priority
- **F5**: Add AppState listener for data refresh on foreground
- **F10**: Validate cancellation reason input
- **S10**: Add option for biometric auth
- **U1**: Add theme toggle to rider app
- **U3**: Add pull-to-refresh to notifications
- **U4**: Add skeleton loading to driver profile
- **U19**: Fix admin modal scroll locking
- **S7**: Add JWT blacklist check to driver auth routes

### PHASE 4 - Low Priority
- All remaining LOW severity items
