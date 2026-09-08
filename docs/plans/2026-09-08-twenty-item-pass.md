# 2026-09-08 — twenty-item pass

User decisions (locked, 2026-09-08):
- Driver manage-trip + tracking redesign → **Stop Timeline** (collapsible map pane,
  vertical stop timeline, per-stop passenger rows, swipe action bar).
- QR → **two payloads, one scanner** (`pay` vs `book`) + universal links.
- Mid-ride dispatch offers → eligible when live ETA to final drop ≤ 5 min
  (exposed as a PlatformSetting).
- New-ride alert → sound + haptic + full-screen popup, repeating, driver-toggleable.

## Batch A — ambient background & driver palette (items 1, 9)

- [x] A1 `shaderSlot` becomes priority-aware: an ANIMATED background outranks a
      STATIC one, so a pushed/tab screen can never demote the app's single live
      canvas to a frozen frame.
- [x] A2 Driver `(tabs)/*` screens drop their own `<AppBackground/>` — the tabs
      group already declares `TRANSPARENT_CONTENT`, so the root shows through
      (this is exactly what the rider does).
- [x] A3 `overFullBleedMap` no longer matches `'home'` by substring; the home
      map is full-bleed but the sheet above it is translucent.
- [x] A4 `driverColors` background ramp → deep near-black (was `#030C18`).

## Batch B — rider trip surface

- [x] B1 (#2) Book-a-ride map shows the PICKUP pin, and recenter reframes the
      whole route instead of jumping to the user.
- [x] B2 (#3) 4-seat request → `FARE_EXPIRED` "party size changed".
- [x] B3 (#4) Remove the duplicate back control on the request stage error card.
- [x] B4 (#6/#15b) Walking leg (rider → pickup) must follow the road.
- [x] B5 (#7) Tracking page freezes on `ARRIVED_AT_PICKUP`.
- [x] B6 (#10) Ride-complete shows placeholders / "Your Driver".
- [x] B7 (#14) False "you're already on a ride".
- [x] B8 (#16) Boarded state never reaches the rider — new BoardedCelebration.
- [x] B9 (#18) "Find another ride" after a no-show lands on the search stage.
- [x] B10 (#12) "Set a destination" is a dead op.

## Batch C — driver bugs

- [x] C1 (#13a) Home camera puts the driver under the balance card.
- [x] C2 (#13b) Heatmap is wrong + half-built — end-to-end pass.
- [x] C3 (#15a) Passenger payment shows an error-coloured toast.
- [x] C4 (#17) No-show → "unfinished ride" toast → blank manage screen.

## Batch D — dispatch alerting (item 5)

- [x] D1 Full-screen offer popup, app-wide, over any screen.
- [x] D2 Alert sound + haptics, repeating while the offer is live.
- [x] D3 Mid-ride offers when ETA to final drop ≤ 5 min.

## Batch E — redesigns

- [x] E1 (#5) Dispatch screen — map gets real height, details legible.
- [x] E2 (#6/#8) Driver tracking — Stop Timeline.
- [x] E3 (#6/#8) Driver manage trip — Stop Timeline + cabin strip.
- [x] E4 (#20a) Seat sheet redesign.

## Batch F — the rest

- [x] F1 (#11) Apple-grade screen transitions (kill the flat fades).
- [x] F2 (#19) QR split + deeplinks end to end.
- [x] F3 (#20b) Guest booking goes straight to seat selection.


---

## Outcome

All 20 items addressed across two passes on 2026-09-08.
Both apps tsc-clean, all touched server files node --check clean.
Nothing device-verified. See state.md for the per-item root causes.

One follow-up the repo cannot do for itself: expo-audio is declared in
apps/driver/package.json but not installed, so the new-ride alert is
haptics+vibration until someone runs the install and a native build.
