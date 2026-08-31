# HANDOFF — Rider Backlog Pass (2026-07-07)

Continuation doc for another agent. Repo: `C:\Users\user\Downloads\Projects\EyeGo V2` (npm workspaces monorepo; app = `apps/rider`, shared UI = `packages/ui`, tokens = `packages/config`). Branch: `main`.

## User's original request (verbatim intent)

> "the ones to do next are the flashlist, formalize panel hook split, keyboard controll migration, prior map backlog, shared element transitions (make sure its not going to crash so its complete). do everything and push so i can test it out… everything is going to be very sleek, premium, and seamless transitions like i want it (yango-like experience)… make sure the morph is also optimized so its all done correctly and everything is complete."

**End state required: all items implemented, rider typecheck clean, committed and PUSHED** so the user can rebuild/sideload on iOS and test.

## Verification commands (run before every commit)

```
cd apps/rider && node ../../node_modules/typescript/bin/tsc --noEmit    # must be exit 0
cd packages/ui && npx tsc --noEmit    # exit 2 = pre-existing Toggle.tsx noise, ignore
```

Commit messages must end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Ground rules / constraints

- **Motion architecture**: ONE shared value drives derived progress; children never invent their own motion. Transforms/opacity only (never height/font = relayout). Spring tokens live in `packages/config/src/motion.ts` (`springs.snappy/morph/entrance/press/tab`, `panelSpring` in panel engine).
- **Shared-element = MorphProvider, NOT native Reanimated SET.** Native shared-element transitions crash on Fabric + Expo Router nested-stack-in-tabs. The crash-safe substitute (`packages/ui/src/morph/MorphProvider.tsx`) flies a measured clone in a root overlay; it was hardened in commit `59990d6` (stable runOnJS commit callback + unmount teardown). Do not re-introduce inline `runOnJS(() => {...})()` closures — they don't serialize reliably in release builds.
- **FlashList v2 gotchas** (already applied to the 3 migrated screens): `contentContainerStyle` honors ONLY padding (no `gap`, no `flexGrow`) — row spacing must come from `ItemSeparatorComponent`. Ref type is `FlashListRef<T>`. `inverted` is supported.
- Profile detail screens keep **native `detailPush`** transitions (prior user decision); morphs are for card→screen navs.

---

## ✅ DONE (already committed)

- `59990d6` — morph crash-safety (MorphProvider stable commit callback + unmount cancelAnimation/clearTimeout).
- `8aaa816` — profile page collapsing-hero motion engine + settings.tsx stagger.
- Earlier: panel motion engine (`packages/ui/src/panel/usePanelMotion.ts` + `PanelSheet.tsx`), FareBreakdownSheet rebuild, live-map motion pass (`281c390`), tab-bar crossfade, app-wide morph wiring.

## ✅ DONE (UNCOMMITTED — in working tree, typecheck-clean as of last check)

1. **FlashList migration (task #4, complete):**
   - `apps/rider/app/(tabs)/activity.tsx` — FlatList→FlashList, added `ItemSeparator` (height `spacing.sm`), contentContainerStyle reduced to padding-only.
   - `apps/rider/app/(tabs)/notifications.tsx` — FlatList→FlashList, added `NotifSeparator`, padding-only container style. MotiView stagger per card kept (delay=index*35, works fine).
   - `apps/rider/app/ride/[id]/chat.tsx` — FlatList→FlashList **preserving `inverted` + ref**; ref retyped to `FlashListRef<ChatMessage>`; removed `flexGrow:1` from `listContent`.
   - Rider `tsc --noEmit` was exit 0 after these three.
2. **keyboard-controller installed:** `react-native-keyboard-controller@^1.18.5` added to `apps/rider/package.json` via `npm install react-native-keyboard-controller@1.18.5 -w apps/rider` from repo root (npm is the package manager — node_modules has the npm marker; `npx expo install` is broken in this monorepo, resolves a bogus `node_modules\node_modules\expo\bin\cli` path).
3. **⚠️ HALF-DONE — dangling import:** `apps/rider/app/_layout.tsx` now imports `KeyboardProvider` from `react-native-keyboard-controller` (line right after the GestureHandlerRootView import) **but the JSX tree is NOT yet wrapped**. Next agent must add `<KeyboardProvider>` inside `<GestureHandlerRootView>` (wrapping `<AmbientRotationProvider>`…children) and close it before `</GestureHandlerRootView>`. Until then the import is unused (lint noise, not a type error).

---

## ⏳ REMAINING WORK

### Task #5 — Keyboard-controller migration (IN PROGRESS)

Package installed (see above). No `useAnimatedKeyboard` usages anywhere (nothing deprecated to rip out). 9 screens currently use `KeyboardAvoidingView`.

1. Finish mounting `KeyboardProvider` in `app/_layout.tsx` (see HALF-DONE note above).
2. Migrate screens — replace `KeyboardAvoidingView` with `KeyboardAwareScrollView` (forms) or `KeyboardStickyView` (bottom input bars), imported from `react-native-keyboard-controller`:
   - **CRITICAL:** `app/ride/[id]/chat.tsx` (bottom input bar — use `KeyboardStickyView` or `useKeyboardAnimation` to slide the input bar; keep the FlashList untouched), `app/(auth)/otp.tsx` (6 digit cells), `app/(auth)/phone.tsx`.
   - **HIGH:** `app/ride/[id]/payment.tsx`, `app/where-to.tsx` (Android currently has NO avoidance).
   - **GAPS (no handling at all today):** `app/ride/[id]/dispute.tsx` (TextInput ~line 195), `app/ride/[id]/rate-tip.tsx` (Android undefined behavior), `app/profile/business.tsx` (Android undefined), `app/profile/saved-places.tsx` (TextInput ~line 242).
   - **OK as-is (skip):** help.tsx (gorhom handles it), tracking.tsx (no TextInput), promotions, place-picker.
3. Note: native module — fine, user rebuilds for sideload anyway. Keep animations driven by the keyboard-controller's progress values (Reanimated) so input bars track the keyboard 1:1.

### Task #1 — Formalize panel hook split (LIGHT refactor only)

`packages/ui/src/panel/usePanelMotion.ts` is already textbook (one shared value `y`, derived `progress`, velocity-projected snap). **Do NOT over-engineer the 6-hook split** from the user's Reddit post — the principle is already met.
- Extract `usePanelLifecycle` from `PanelSheet.tsx`'s 3 lifecycle `useEffect`s (mounted/visible/contentH → snapToState orchestration) into `packages/ui/src/panel/usePanelLifecycle.ts`, export from `packages/ui/src/panel/index.ts` + `packages/ui/src/index.ts`. Behavior identical.

### Task #3 — Shared-element via morph (crash-safe)

Wire profile hero → edit screen using the existing MorphProvider (same pattern as ride-card morph in `ride/select.tsx` / `ride/[id].tsx`):
- `app/(tabs)/profile.tsx`: wrap hero avatar/card in `MorphSource` (id e.g. `profile-avatar`), edit-button/avatar press → `morphTo('profile-avatar', () => router.push('/profile/edit'))`.
- `app/profile/edit.tsx`: mount `MorphTarget id="profile-avatar"` around the destination avatar block; call `morphBack(() => router.back())` on back press.
- `app/_layout.tsx`: `profile/edit` route currently uses `detailPush` — for the morph to own the motion it must become `{ animation: 'fade', gestureEnabled: true }` (same treatment as `ride/[id]`). Other profile routes stay `detailPush`.
- MorphProvider already handles: skip on low tier/reduced-motion, 700ms target timeout dissolve, gesture-interruptible reverse. Nothing to add there.

### Task #6 — Map/tracking backlog (`app/ride/[id]/tracking.tsx` + `apps/rider/utils/mapbox.ts`)

Survey findings (line numbers approximate):
- **Route polyline draw-in**: ShapeSource + 2 LineLayers (shadow 7px/0.18 + main 4px/0.9) at tracking.tsx ~575–613; adapter mapbox.ts ~188–210 converts to react-native-maps `Polyline`. RN-maps Polyline has NO trim/gradient — implement draw-in via **coordinate-slice reveal** (animate an index 0→N with a shared value / RN Animated, slice `routeCoords` progressively on route change). `routeCoords` state ~line 331; sources: OSRM fetch ~261–272, socket `trip:eta` geometry ~451–453, straight-line fallback.
- **ETA rolling digits**: `tripEta` from `useRideStore` (socket `onTripEta` ~446–454); plain `Text formatDuration` at ~685–699 (pill) and ~864–870 (sheet). Build a small `RollingDigit`/`AnimatedETA` component (per-digit translateY crossfade, Reanimated) and use in both spots.
- **Price-change transition**: fare is static (`syncedTrip.fare ?? baseFare ?? 0`) at ~773–775. `AnimatedFareText` **already exists in packages/ui** — swap it in. Low urgency (no fare_update socket event exists); do the swap, skip the listener.
- **Ride-stage FSM extraction**: statuses in trip.types.ts (SCHEDULED|FILLING|BOARDING|DRIVER_EN_ROUTE|ARRIVED_AT_PICKUP|IN_PROGRESS|COMPLETED|CANCELLED). Handling is ad-hoc if/else in `onTripStatus` ~456–487. Extract a `stage → UI-config` map (sheet content/camera behavior/marker flags derive from one place). **NOT xstate. Keep behavior identical** — COMPLETED→haptic+route to complete, CANCELLED→alert+back, etc.

### Final step — commit + push

- Commit the working-tree changes (FlashList + keyboard install/provider) and each remaining task (separate commits fine).
- `git push` to origin/main — the user tests via iOS sideload rebuild.
- Update memory: `C:\Users\user\.claude\projects\C--Users-user-Downloads-Projects-EyeGo-V2\memory\project_rider_backlog_pass.md` (mark items done).

## Task list state (session task IDs)

| # | Task | Status |
|---|------|--------|
| 1 | Formalize panel hook split | pending |
| 2 | Optimize morph engine | ✅ done (59990d6) |
| 3 | Shared-element via morph (crash-safe) | pending |
| 4 | FlashList migration | ✅ done (uncommitted) |
| 5 | Keyboard-controller migration | in progress (installed + import added; provider wrap + screen migrations remain) |
| 6 | Map/tracking backlog | pending |

## Honest framing given to the user (keep it)

Architecture correctness + typecheck-clean is what's promisable headless; "feels Yango-smooth" is device-verified only. Don't claim buttery until the user confirms on device.
