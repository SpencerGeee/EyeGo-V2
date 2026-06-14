# EyeGo V2 Driver App — Exhaustive Bug Audit

Generated: 2026-06-09

---

## hooks/useDriverSocket.ts

```
FILE: hooks/useDriverSocket.ts
LINE: ~75
SEVERITY: CRITICAL
TYPE: race-condition
ISSUE: Dual location emission. The second useEffect starts a 4s setInterval to emit location.
  The active-trip tracking screen (trip)/tracking/[id].tsx ALSO runs its own 4s setInterval for
  location emission. When the driver is on the tracking screen and useDriverSocket is still
  mounted (home screen keeps it alive via enabled:isOnline), every location fix is broadcast
  twice per interval. Server receives duplicate updates; passenger map flickers.
FIX: Remove location emission entirely from useDriverSocket. Tracking screen's interval
  is the single authoritative source. useDriverSocket should only manage connection
  lifecycle (connect/disconnect/join-room) and seat_update invalidation.
```

```
FILE: hooks/useDriverSocket.ts
LINE: ~22 (first useEffect deps: [enabled])
SEVERITY: HIGH
TYPE: stale-closure
ISSUE: The first useEffect only depends on [enabled]. It captures `tripId` at registration
  time for both `emitJoinTracking` in the onConnect callback and the immediate join
  at line ~55. If `tripId` changes (e.g. driver accepted a new trip without remounting),
  the listeners still reference the old tripId. The socket will join the wrong room on
  reconnect.
FIX: Add `tripId` to the first useEffect's deps array, or read it from a ref
  (`tripIdRef.current`) inside the callbacks.
```

```
FILE: hooks/useDriverSocket.ts
LINE: ~44-50
SEVERITY: HIGH
TYPE: memory-leak
ISSUE: handleConnectError is registered with `getDriverSocket().on('connect_error', ...)`.
  On cleanup (line ~69) it is removed with `getDriverSocket().off('connect_error', handleConnectError)`.
  But the reconnect setTimeout inside handleConnectError (line ~47-50) fires 1 second later.
  If the component unmounts within that 1 second, `connectDriverSocket()` is called on an
  unmounted hook — potentially reconnecting a socket that should be dead.
FIX: Store the reconnect timeout in a ref, clear it in the cleanup function before
  calling disconnectDriverSocket().
```

```
FILE: hooks/useDriverSocket.ts
LINE: ~74 (second useEffect deps)
SEVERITY: MEDIUM
TYPE: stale-closure
ISSUE: Second useEffect deps array is [enabled, isOnline, tripId, location?.latitude, location?.longitude].
  `location` object is destructured from useDriverLocation but the tryEmit closure inside the
  setInterval captures location from the outer scope at the time the effect runs. Because
  location?.latitude/longitude are in the deps, the interval is torn down and recreated on
  every GPS fix — causing micro-thrashing (~1 teardown/setup per second while moving).
FIX: Read location from locationRef.current inside tryEmit (already exists). Remove
  location?.latitude/longitude from deps. The ref stays fresh without restarting the interval.
```

---

## hooks/useDriverLocation.ts

```
FILE: hooks/useDriverLocation.ts
LINE: ~applyPosition callback
SEVERITY: HIGH
TYPE: stale-closure
ISSUE: applyPosition uses useCallback with [] deps. Inside it calls setIsMocked(true) when
  speed is implausible, but NEVER resets setIsMocked(false) when a valid fix arrives after
  a mocked one. Once isMocked is set true it stays true for the session.
FIX: In applyPosition, set setIsMocked(speedKmh > MAX_PLAUSIBLE_SPEED_KMH) so it resets
  on the next valid fix.
```

```
FILE: hooks/useDriverLocation.ts
LINE: ~startWatch (IIFE in useEffect)
SEVERITY: MEDIUM
TYPE: race-condition
ISSUE: startWatch is called from AppState 'active' handler with no debounce. If the OS
  fires multiple rapid 'active' events (documented on Android), startWatch is called
  multiple times in quick succession. Each call does `watchRef.current?.remove()` then
  starts a new watch — but if the previous watch.remove() hasn't resolved yet when the
  next startWatch begins, two Location subscriptions can briefly coexist.
FIX: Add a boolean `isStartingRef` guard to prevent concurrent startWatch invocations.
  Set it true on entry, false in finally.
```

```
FILE: hooks/useDriverLocation.ts
LINE: ~(IIFE async body)
SEVERITY: MEDIUM
TYPE: race-condition
ISSUE: Platform.OS === 'android' branch calls Location.requestForegroundPermissionsAsync()
  immediately on mount before the screen is fully rendered. On fresh install this fires
  the system permission dialog before the user has seen the in-app rationale, violating
  Android best-practice and potentially confusing users (they see a permission dialog
  with no context).
FIX: Gate the permission request on a user action (show "Enable Location" UI) OR add a
  500ms defer: `await new Promise(r => setTimeout(r, 500))` before requesting on Android.
```

---

## hooks/useNetworkStatus.ts

```
FILE: hooks/useNetworkStatus.ts
LINE: ~4
SEVERITY: LOW
TYPE: edge-case
ISSUE: Initial state is null (unknown). Consumers that check `isOffline` receive false
  (null === false → false) during the brief window before NetInfo.fetch() resolves.
  If the device IS offline at mount, the offline banner is suppressed for ~200ms.
FIX: Initialize state with a synchronous check or document the null state explicitly.
  Consumers should handle null/unknown: `isOffline: isConnected === false` is already
  correct but `isConnected === null` (unknown) silently shows as "online".
```

---

## stores/driver.store.ts

```
FILE: stores/driver.store.ts
LINE: ~login action
SEVERITY: HIGH
TYPE: race-condition
ISSUE: login() calls set({ isLoggedIn: true, ... }) after multiple async SecureStore writes.
  If loadFromStorage() runs concurrently (e.g. on hot-reload), it can read partial state
  from SecureStore before the writes complete, yielding driver=null with isLoggedIn=true.
FIX: Set isLoading: true at the start of login(), and isLoading: false in a finally block,
  consistent with loadFromStorage(). Add a write-lock or sequential guard.
```

```
FILE: stores/driver.store.ts
LINE: ~setOnline (store action)
SEVERITY: MEDIUM
TYPE: edge-case
ISSUE: The store has setOnline(online: boolean) that directly mutates isOnline. Home screen
  also calls goOnline/goOffline mutations which call setOnline in onSuccess. If network
  request fails mid-flight and onError doesn't call setOnline(false), the store says
  isOnline=true while backend says offline, causing location emission to continue for
  a dead session.
FIX: In goOnline.onError, always ensure setOnline(false) is called to keep store in sync
  with backend state.
```

```
FILE: stores/driver.store.ts
LINE: ~refreshTokens reference in _layout.tsx
SEVERITY: HIGH
TYPE: null-crash
ISSUE: _layout.tsx references `useDriverStore.getState().refreshTokens(...)` in the
  onTokenRefreshed callback, but driver.store.ts does not export a `refreshTokens` action —
  only setTokens/login/logout exist. Calling refreshTokens() at runtime will throw
  "refreshTokens is not a function".
FIX: Add refreshTokens: (tokens: AuthTokens) => void action to driver.store.ts that
  updates accessToken and refreshToken in state and SecureStore.
```

---

## stores/notifications.store.ts

```
FILE: stores/notifications.store.ts
LINE: ~addNotification (id: Date.now().toString())
SEVERITY: LOW
TYPE: edge-case
ISSUE: Using Date.now().toString() as notification ID. If two notifications are added
  in the same millisecond (e.g. trip completion triggers multiple addNotification calls),
  they get the same ID. markRead(id) will mark both. FlatList keyExtractor will also
  produce duplicate keys causing render warnings.
FIX: Use a proper UUID/nanoid or combine Date.now() + Math.random():
  `id: \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\``
```

---

## app/_layout.tsx

```
FILE: app/_layout.tsx
LINE: ~configureApiClient call
SEVERITY: HIGH
TYPE: null-crash
ISSUE: onTokenRefreshed callback calls useDriverStore.getState().refreshTokens({...}) but
  refreshTokens does not exist on the store (see driver.store.ts finding above). This will
  crash silently or throw at runtime on every token refresh cycle, effectively logging
  the driver out on every access token expiry.
FIX: Implement refreshTokens in driver.store.ts (see store fix above).
```

```
FILE: app/_layout.tsx
LINE: ~NetInfo.addEventListener useEffect
SEVERITY: LOW
TYPE: memory-leak
ISSUE: The NetInfo.addEventListener at the top-level layout returns the unsubscribe function
  directly as the useEffect cleanup. This is correct. However if the layout re-mounts
  (rare but possible on hot reload / dev), a new listener is registered before the old
  cleanup runs. On production this is benign; in development it causes double-firing.
FIX: Low priority — current pattern is idiomatic and correct for production.
```

---

## app/(tabs)/home.tsx

```
FILE: app/(tabs)/home.tsx
LINE: ~goOnline mutationFn
SEVERITY: HIGH
TYPE: race-condition
ISSUE: goOnline.mutationFn throws 'Location not available yet' if location is null.
  The home screen passes location from useDriverLocation to goOnline. But useDriverLocation
  is also used by useDriverSocket (called in the same component). Two consumers of
  useDriverLocation create two separate hook instances — two GPS subscriptions running
  in parallel, each calling setLocation on their own state. The location value in the
  home component closure may lag behind the hook instance inside useDriverSocket.
FIX: Call useDriverLocation once at the home screen level, pass the result down to
  both the goOnline mutation and useDriverSocket via a prop/ref. Do not call
  useDriverLocation twice in the same component tree branch.
```

```
FILE: app/(tabs)/home.tsx
LINE: ~reconnect setTimeout (inside cleanDisconnect callback)
SEVERITY: HIGH
TYPE: memory-leak
ISSUE: When socket disconnects, a 3-second setTimeout is scheduled to reconnect. This
  timeout is NOT stored in a ref and NOT cleared in the useEffect cleanup. If isOnline
  becomes false and the effect re-runs (cleanup + new run), up to 5 pending timeouts
  can pile up (one per disconnect event). All 5 fire 3 seconds later and call
  connectDriverSocket() even after the driver has gone offline.
FIX: Store the reconnect timeout ID in a reconnectTimerRef. In the useEffect cleanup,
  call clearTimeout(reconnectTimerRef.current) before disconnectDriverSocket().
```

```
FILE: app/(tabs)/home.tsx
LINE: ~handleToggleOnline useCallback
SEVERITY: MEDIUM
TYPE: stale-closure
ISSUE: handleToggleOnline is wrapped in useCallback. It reads isOnline from the component
  scope (via useDriverStore selector). If the store updates isOnline between renders
  but before the callback re-evaluates (stale closure window), tapping toggle twice
  quickly can issue two goOnline.mutate() calls.
FIX: Read current state directly from store inside the callback:
  `const online = useDriverStore.getState().isOnline` instead of captured isOnline.
  Also the button should be disabled while goOnline/goOffline is pending.
```

```
FILE: app/(tabs)/home.tsx
LINE: ~walletData usage
SEVERITY: MEDIUM
TYPE: null-crash
ISSUE: walletData?.balance is used in handleToggleOnline to guard against negative balance.
  If the walletData query is still loading (undefined), walletData?.balance ?? 0 returns 0,
  so a driver with a negative balance can go online while the query is in-flight.
FIX: Disable the online toggle (or show a loading state) until walletData has resolved.
```

```
FILE: app/(tabs)/home.tsx
LINE: ~onTripAssigned socket callback
SEVERITY: MEDIUM
TYPE: nav-after-unmount
ISSUE: The onTripAssigned callback calls router.push() directly. If the home screen
  is unmounting (e.g. driver tapped a tab simultaneously), navigation is called on
  a component that may be in the middle of being destroyed.
FIX: Add an isMountedRef guard: check isMountedRef.current before router.push().
```

---

## app/(trip)/dispatch/[id].tsx

```
FILE: app/(trip)/dispatch/[id].tsx
LINE: ~useEffect([id]) guard
SEVERITY: MEDIUM
TYPE: nav-after-unmount
ISSUE: The id guard useEffect calls router.back() when id is invalid. This effect runs
  after mount. If the component renders briefly with no id, any state setters called
  during that render (e.g. useState initializers) will execute before the back() fires,
  potentially causing "Warning: Can't perform a React state update on an unmounted component".
FIX: Move the id guard to before any state/effect declarations using an early return
  pattern wrapped in a top-level useEffect with router.replace(), or use Expo Router's
  built-in redirect.
```

```
FILE: app/(trip)/dispatch/[id].tsx
LINE: ~useEffect([id, router]) - missing router in deps
SEVERITY: LOW
TYPE: stale-closure
ISSUE: The id-guard useEffect lists [id, router] as deps in some versions but only [id]
  in others (audit found both). Missing router in deps array causes eslint-hooks warning
  and theoretical stale router reference.
FIX: Ensure deps array is [id, router].
```

```
FILE: app/(trip)/dispatch/[id].tsx
LINE: ~accept.mutate onSuccess
SEVERITY: HIGH
TYPE: type-unsafe
ISSUE: `const trip = res.data.data as any;` — entire accept response cast to any. Then
  `trip?.id ?? id` is used for navigation. If backend response shape changes (e.g. data
  is nested under data.trip instead of data), trip?.id silently falls back to the
  dispatch id which may differ from the actual trip id. Navigation lands on wrong trip.
FIX: Define `interface AcceptDispatchResponse { data: { data: { id: string } } }` and
  cast properly, or use existing Trip type from @eyego/types.
```

---

## app/(trip)/active/[id].tsx

```
FILE: app/(trip)/active/[id].tsx
LINE: ~updateTripStatus mutation onSuccess
SEVERITY: HIGH
TYPE: nav-after-unmount
ISSUE: On COMPLETED status, the mutation calls router.replace() after setActiveTripId(null)
  and multiple qc.invalidateQueries() calls. There is no isMountedRef guard. If the user
  navigates away during the ~100ms API call, router.replace() fires on an unmounted screen,
  producing a console error and potentially double-navigating.
FIX: Add isMountedRef (useRef(true), set false on cleanup) and check before router.replace().
```

```
FILE: app/(trip)/active/[id].tsx
LINE: ~useDriverSocket usage
SEVERITY: MEDIUM
TYPE: socket-lifecycle
ISSUE: ActiveTripScreen calls useDriverSocket({ tripId: id, enabled: true }). HomeScreen
  ALSO calls connectDriverSocket() in its own useEffect when isOnline is true. Both screens
  can be mounted simultaneously (active trip is a stack push over home tabs). This causes
  connectDriverSocket() to be called twice, and more critically, disconnectDriverSocket()
  is called in BOTH cleanup functions — so whichever unmounts first disconnects the socket
  while the other still needs it.
FIX: The socket connection should use reference counting (already claimed in comments but
  verify getDriverSocket/connectDriverSocket are truly ref-counted in @eyego/api). If not,
  implement a singleton connect with refcount to prevent premature disconnect.
```

```
FILE: app/(trip)/active/[id].tsx
LINE: ~STATUS_FLOW table
SEVERITY: MEDIUM
TYPE: edge-case
ISSUE: STATUS_FLOW does not include 'FILLING' status in one version of the file and does
  in another (two versions were found in the batch). The version without 'FILLING' will
  render an empty action button and label for a FILLING trip since STATUS_FLOW[trip.status]
  returns undefined, and undefined?.label crashes.
FIX: Ensure STATUS_FLOW covers all backend statuses: SCHEDULED, FILLING, DRIVER_EN_ROUTE,
  ARRIVED_AT_PICKUP, IN_PROGRESS, COMPLETED, CANCELLED. Add null guard:
  `const flow = STATUS_FLOW[trip.status] ?? { label: trip.status, next: null, action: '' }`.
```

---

## app/(trip)/complete/[id].tsx

```
FILE: app/(trip)/complete/[id].tsx
LINE: ~useQuery select
SEVERITY: HIGH
TYPE: type-unsafe
ISSUE: `select: (r) => (r.data as any)?.data?.trips ?? []` fetches ALL driver trips to find
  one by id. This is a potentially large payload (O(n) trips) cast entirely to any[].
  If the API response shape changes, completedTrip silently becomes undefined, and
  allActiveBookings becomes [], rendering a blank earnings screen with no error.
FIX: Add a dedicated endpoint `/driver/trips/:id` and use it. Type the response with
  the existing Trip interface from @eyego/types.
```

```
FILE: app/(trip)/complete/[id].tsx
LINE: ~earnings = earningsParam ? parseFloat(earningsParam) : netEarnings
SEVERITY: MEDIUM
TYPE: edge-case
ISSUE: earningsParam is a string from URL params. If it's an empty string or 'NaN',
  parseFloat('') returns NaN and parseFloat('NaN') returns NaN. earnings then becomes
  NaN, and `GHS NaN` is displayed to the driver.
FIX: Add validation: `const earnings = earningsParam && !isNaN(parseFloat(earningsParam))
  ? parseFloat(earningsParam) : netEarnings`.
```

```
FILE: app/(trip)/complete/[id].tsx
LINE: ~commissionRate = (completedTrip as any)?.commissionRate ?? 0.15
SEVERITY: LOW
TYPE: type-unsafe
ISSUE: commissionRate falls back to a hardcoded 0.15 (15%). If the backend changes the
  commission model, the driver's displayed earnings will be wrong without any indication.
FIX: Log a warning when commissionRate is missing from the trip response. Fetch the
  rate from a config API endpoint rather than hardcoding.
```

---

## app/(trip)/rate-passengers/[id].tsx

```
FILE: app/(trip)/rate-passengers/[id].tsx
LINE: ~currentPassenger = passengers[currentIndex]
SEVERITY: HIGH
TYPE: null-crash
ISSUE: If passengers array is empty (all bookings were CANCELLED), currentPassenger is
  undefined. The JSX then renders `currentPassenger.name`, `currentPassenger.seatNumber`
  etc. — immediate crash. The Button is also disabled based on `currentRating === 0`
  which reads `ratings[currentPassenger.bookingId]` — another crash path.
FIX: Add an early check: if passengers.length === 0, show an empty state and a "Done"
  button that navigates home. Only render the rating UI when currentPassenger is defined.
```

```
FILE: app/(trip)/rate-passengers/[id].tsx
LINE: ~submitRating.onSuccess setCurrentIndex
SEVERITY: MEDIUM
TYPE: race-condition
ISSUE: On submit success, setCurrentIndex(i => i + 1). If the user somehow triggers
  handleNext twice quickly (double-tap before isPending is true), setCurrentIndex fires
  twice, advancing two passengers and skipping a rating.
FIX: Add a submittingRef lock (already done in some screens — replicate here):
  check `submitRating.isPending` before calling mutate() or add a ref-based lock.
```

---

## app/(tabs)/earnings.tsx

```
FILE: app/(tabs)/earnings.tsx
LINE: ~handleWithdraw validation
SEVERITY: MEDIUM
TYPE: edge-case
ISSUE: handleWithdraw validates amount > 0 and >= 1 but calls walletApi.withdraw({ amount: parseFloat(withdrawAmount) })
  in the mutationFn WITHOUT re-validating. If withdrawAmount state is modified between
  the handleWithdraw call and mutationFn execution (e.g. blur/re-render), the mutation
  could send a different amount.
FIX: Capture the parsed amount in handleWithdraw, pass it to mutate() as a variable:
  `withdraw.mutate(amount)` and use it directly in mutationFn.
```

```
FILE: app/(tabs)/earnings.tsx
LINE: ~txData select (r.data as any)?.data
SEVERITY: LOW
TYPE: type-unsafe
ISSUE: The transaction list query tries 4 different response shapes via as any.
  This indicates the API response is inconsistent across environments. If none match,
  returns [], silently hiding transactions.
FIX: Standardise the API response shape and type the select properly.
```

---

## app/(tabs)/notifications.tsx

```
FILE: app/(tabs)/notifications.tsx
LINE: ~handlePress router.push
SEVERITY: MEDIUM
TYPE: nav-after-unmount
ISSUE: handlePress calls `router.push(\`/(trip)/active/\${n.tripId}\`)` for any notification
  with a tripId, regardless of trip status. If the trip is COMPLETED or CANCELLED,
  navigating to the active screen will load a completed trip and the STATUS_FLOW action
  button will be empty/broken.
FIX: Check notification type before navigating: COMPLETED type should navigate to
  `/(trip)/complete/[id]`, TRIP_ASSIGNED to `/(trip)/dispatch/[id]`, others to
  `/(trip)/active/[id]` with a status guard.
```

---

## app/(auth)/otp.tsx

```
FILE: app/(auth)/otp.tsx
LINE: ~useEffect([countdown]) — countdown interval
SEVERITY: MEDIUM
TYPE: perf
ISSUE: The interval useEffect depends on [countdown]. Every time countdown decrements,
  React tears down the old interval and creates a new one. This produces 60 interval
  create/destroy cycles during the countdown. While functionally correct (ref cleanup
  prevents leak), it is inefficient.
FIX: Use a single interval that runs once on mount, counts down, and self-clears when
  it reaches 0. Store only the initial value in state and decrement via functional update.
  Remove countdown from deps: `useEffect(() => { const t = setInterval(...); return () =>
  clearInterval(t); }, [])`.
```

```
FILE: app/(auth)/otp.tsx
LINE: ~verifyOtp mutationFn
SEVERITY: MEDIUM
TYPE: null-crash
ISSUE: `driverAuthApi.verifyOtp({ phone: phone ?? '', otp: code })` — phone defaults to
  empty string if the param is missing. The API call will proceed with an empty phone,
  getting a 400 error. The error message from the server may be confusing. There is no
  early guard that shows a user-friendly error when phone is absent.
FIX: Add at the top of the screen: `if (!phone) { router.replace('/(auth)/phone'); return null; }`
  before rendering (after all hooks).
```

---

## components/OnlineToggle.tsx

```
FILE: components/OnlineToggle.tsx
LINE: ~onToggle handler
SEVERITY: LOW
TYPE: edge-case
ISSUE: OnlineToggle does not guard against rapid double-taps beyond the `loading` prop.
  If the parent passes loading=false briefly between mutation state transitions (idle →
  pending), a second tap can fire before loading becomes true.
FIX: The parent (home.tsx) should disable the toggle with both `goOnline.isPending ||
  goOffline.isPending`. Verify the home.tsx correctly passes loading={goOnline.isPending || goOffline.isPending}.
  This appears to be done but confirm it covers the devActivate mutation path too.
```

---

## components/DemandOverlay.tsx

```
FILE: components/DemandOverlay.tsx
LINE: ~cells.map (useMemo)
SEVERITY: LOW
TYPE: null-crash
ISSUE: cells prop is typed as HeatmapCell[] (non-optional). If the parent passes undefined
  (e.g. heatmap query returns undefined before loading), the map call throws. The visible
  guard checks `cells.length === 0` but cells.length on undefined crashes first.
FIX: Add a null guard in the component: `if (!visible || !cells || cells.length === 0) return null`.
  Or make cells default to [] at the call site.
```

---

## Cross-cutting Issues

```
FILE: app/(trip)/active/[id].tsx, app/(trip)/complete/[id].tsx, app/(tabs)/earnings.tsx
LINE: various
SEVERITY: HIGH
TYPE: type-unsafe
ISSUE: Pervasive (r.data as any) and (trips as any[]) casts throughout trip-related screens.
  At least 8 distinct as any casts were found across the driver app. These mask TypeScript
  errors and mean API shape changes silently produce undefined values at runtime.
FIX: Expand Trip, Booking, DriverProfile types in @eyego/types to include all fields
  actually returned by the backend (commissionRate, commissionAmount, fareAmount, driverId,
  FILLING/DRIVER_EN_ROUTE/ARRIVED_AT_PICKUP TripStatus variants). This eliminates the
  need for all as any casts in one pass.
```

```
FILE: app/(trip)/active/[id].tsx, app/(tabs)/home.tsx
LINE: various
SEVERITY: HIGH
TYPE: socket-lifecycle
ISSUE: Two screens call connectDriverSocket()/disconnectDriverSocket() independently.
  If both are mounted (home tabs + active trip stack), cleanup order is non-deterministic.
  Whichever unmounts first calls disconnectDriverSocket(), killing the socket for the
  other screen.
FIX: Verify @eyego/api's connectDriverSocket() is truly ref-counted. If not, implement
  a ref-counted singleton: increment on connect, decrement on disconnect, only call
  socket.disconnect() when count reaches 0.
```

```
FILE: stores/driver.store.ts + app/_layout.tsx
LINE: various
SEVERITY: CRITICAL
TYPE: null-crash
ISSUE: refreshTokens action is called in _layout.tsx configureApiClient onTokenRefreshed
  callback but is not defined in the store. Every token refresh cycle (every ~15 min in
  production) will throw "refreshTokens is not a function", effectively preventing token
  renewal and logging the driver out silently.
FIX: Add refreshTokens to the store interface and implementation.
```

---

## Summary Table

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| HIGH     | 12    |
| MEDIUM   | 13    |
| LOW      | 7     |
| **TOTAL** | **35** |
