# State — 2026-09-09 driver premium pass

## Current Goal
Fix 17 reported items + rebuild the driver shell map-first. Plan + all decisions:
`docs/superpowers/plans/2026-09-09-driver-premium-pass.md` — **read that first, it is authoritative.**

## Status
Grilling COMPLETE (15 decisions, D1–D15, all user-confirmed). Plan written.

### DONE (driver `tsc` green, exit 0, after each)
- **P1 items 1 + 10** — `(tabs)/_layout.tsx` gained `sceneStyle:{backgroundColor:'transparent'}`.
  `shaderSlot.ts`: added `SHADER_PRIORITY_BASE=-1`; root background is now the FLOOR, not the
  ceiling; `claim()` re-ranks in place instead of re-pushing (the re-push silently re-dated the
  root and let it win recency ties it was meant to lose); `useShaderSlot(priority, enabled)` —
  `AppBackground` passes `!paused` so a covered root stands down entirely.
  NOTE: `home.tsx` mounts NO AppBackground — its full-bleed map was hiding the white.
- **P2 item 2** — three real defects, all fixed: `beatPresenceOverHttp` opened with
  `if (!fix) return;` so "Check now" was a guaranteed no-op in the exact state it is offered for;
  it now returns `PresenceBeatResult{ok,failure,dispatchable}`. `setDispatchStatus` no longer
  short-circuits, so `checkedAt` moves and the banner can render "Checked just now".
  `DispatchBlockedBanner` gained `checkedAt` + `onDismiss` (X); home holds `dismissedBlock`
  keyed on reason with a 10-min TTL (`BLOCK_DISMISS_TTL_MS`).
- **P5 items 5 + 7 + 9** —
  * `noteDecline(state, driverId, {deliberate})` splits the two acts. `state.declined` = permanent
    (a Pass), `state.declinedAt` = cooldown (a timeout). This is why the user reported BOTH
    "it never gets to you again" and "it shouldn't be shown to them again" — one function, two acts.
  * `declineOffer` → `deliberate:true`. `resumeAfterFailedClaim` → `false` (a LOST ACCEPT RACE
    must not be punished). TASK_OFFER_TIMEOUT handler now calls `noteDecline(...false)` — it
    previously recorded NOTHING, so `offerNext` re-offered to the same nearest driver with a
    fresh 45s deadline. That is item 5's server half.
  * `finish()` now revokes to every candidate for any non-'accepted' reason; `expireTrip` calls
    `cascade.cancelCascade` (lazy require). Terminal transitions never PUSHED a revoke, so the
    board kept a ghost row until the next poll → items 7 and 9.
  * Client: `PendingDispatch.offerExpiredForMe` (client-only flag); store treats `DECLINED` as
    `gone`; offer screen no longer invents `firstSeen + 45s` for an offer that ENDED (item 5's
    "fresh counter").

- **P6 item 3** — `DispatchLiveMap` gained `revealDropoff` (default **false**, so a new caller
  cannot leak the destination by forgetting a prop). Gated in FOUR places, because hiding only
  the pin still shows the destination: the `points` list that feeds fitBounds, the dropoff
  `MarkerView`, the `ride` arc/road geometry, AND the `routeGeoJson` layer (the server's own
  whole-ride line). `useRoadLeg` for the ride leg is not even fetched while gated.
  `DispatchOfferCard` fallback copy changed from "Destination on the map" (now false) to
  "Destination shared when you start the ride". Dropoff area name stays as TEXT per D5.
  Only call site is `dispatch/[id].tsx`; the tracking screen uses a different map
  (`DriverTripMap`), so post-start reveal needs no change there.

### REMAINING
P3 morph (D1 scoped to cold path only by D10), P4 transitions (D7),
P7 map-first shell (D8–D11, D13 — the big one: lift rider `TripSheetHost`/`sheetSlot` into
`packages/ui`, then driver home/dispatch/tracking become 6 stages of one never-unmounting map),
P8 item 11 (see Open Issues — needs runtime, not static).

## Proven root causes (verified in code, do not re-derive)
- **item 1** white bg — driver `apps/driver/app/(tabs)/_layout.tsx` `screenOptions` is missing
  `sceneStyle: { backgroundColor: 'transparent' }`. Rider has it at its line 206. quests/earnings/
  trips/notifications mount no `AppBackground`, so the opaque tab scene shows. `home.tsx` only looks
  fine because it mounts its own.
- **item 10** blue-black create-trip — `packages/ui/src/effects/shaderSlot.ts` `currentOwner()` awards
  the single Canvas to the highest priority. Root layout claims `ANIMATED`(1) and **never
  relinquishes**, because it sits outside the navigator so `useScreenFocus()` is permanently true.
  A pushed screen's `STATIC`(0) claim can therefore never win → it paints only its flat
  `backgroundDeep` fallback. Root is `paused` under a detail (`_layout.tsx:654`) but still *owns*
  the slot. **Fix: a paused background must relinquish, not just stop drawing.**
- **item 2** — `DispatchBlockedBanner.tsx` has no dismiss state at all (0 grep hits). `Check now`
  (`home.tsx:447`) calls `beatPresenceNow()` un-awaited, no feedback, invalidates `['driver']` which
  may not be the key the banner reads.
- **item 6** — `rides.service.js:349` guard uses `findActiveTripForUser` + `reconcile.stillLive`.
  A timed-out ride lands in `NO_DRIVERS_FOUND` (`dispatch-cascade.service.js:662,787`). Confirm
  that status is terminal in BOTH `findActiveTripForUser` and `stillLive`, not just in
  `trip-lifecycle.service.js` (whose line 69 notes it was missing there once already).
- **item 8** morph — fixed 4× at the animation layer and still reported; the cost is the destination
  mount. D10 removes the destination on the hot path entirely.

## Key facts
- Only **8 morph call sites** exist app-wide — small blast radius.
- Rider already owns the target shell: `apps/rider/components/trip/{TripSheetHost,sheetSlot,TripMap}.tsx`
  + `packages/ui/src/panel/MorphSheet.tsx`. Sheet is custom, **not** `@gorhom/bottom-sheet`.
- Deps: reanimated 4.1.1, gesture-handler 2.28, maplibre 11.3.2, skia 2.2.12, expo 54, screens 4.16.
  `react-native-view-shot` NOT installed (not needed — RN rasterization + `effects/hardwareTexture.ts`).
- `npx` is broken in this sandbox → `node node_modules/typescript/lib/tsc.js`.

## Open Issues
- **item 11 (create-trip "more hooks than previous render") — NOT located. Negative results below
  are worth more than the search; do not repeat them.**
  * `create.tsx` itself is clean: every hook is above the first return (L324), and there are NO
    hook calls anywhere in its JSX region (L324–800). Its two local components (`FareRow` L794,
    `SummaryRow` L830) are hook-free.
  * Scanned `packages/ui/src`, `apps/driver/{components,app,hooks}` with brace-tracking for
    (a) an early `return` at component-body depth followed by a hook, and (b) hooks in a
    conditional position (`if(...)`/`&&`/ternary/`||`/`.map`). Matcher covered `function X`,
    arrow consts, `memo()` and `forwardRef()`. **Zero real hits** — the only 4 were false
    positives of the form `return useContext(...)` on one line.
  * `AppBackground`'s early returns (L200/L216) are AFTER all its hooks — safe, and the P1 change
    does not introduce a hook-order bug there even though it makes `ownsShader` flip more often.
  * Ruled out as mid-render throwers: `formatGhs` is null-safe (returns 'GH₵—');
    `distanceKm` is `roadRoute?.distanceKm ?? straightKm` and `straightKm` returns 0 rather than
    null, so the `.toFixed(1)` at L412/L561 cannot throw.
  * **Working theory:** "Rendered more hooks" is the SECONDARY error — a first render throws
    partway through, and React's retry render then has a different hook count. So the real bug is
    an exception thrown mid-render whose identity is being masked. Next step is to surface the
    first error (error boundary / dev overlay on device), NOT more static scanning.
- **item 6 not yet proven.** Static reading did NOT find the cause and the obvious suspects are
  all clean: `NO_DRIVERS_FOUND`/`EXPIRED` are terminal and excluded from `LIVE_STATUSES`;
  `findActiveTripForUser` reads the Trip row so a terminal trip cannot block; the
  `TASK_REQUEST_EXPIRY` handler correctly cancels the cascade AND transitions to EXPIRED, and its
  status guard `[REQUESTED, MATCHING, REASSIGNING]` does cover every pre-driver live state (there
  is no SEARCHING/OFFERED status — do not go looking for one again). The P5 fixes plausibly
  resolve it as a side effect (a ghost row was the thing being retried against). **Prove it in the
  e2e harness rather than by more static reading.**
- Pass-permanent needed NO schema change — `declined`/`declinedAt` already exist in the Redis
  cascade state and the old `declined` array already meant permanent, so the change is
  deploy-safe with no migration. D15 step 3 may be a no-op; confirm before running it.
