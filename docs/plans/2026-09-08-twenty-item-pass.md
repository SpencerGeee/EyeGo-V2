# 2026-09-08 — twenty-item pass

User decisions (locked, 2026-09-08):
- Driver manage-trip + tracking redesign → **Stop Timeline** (collapsible map pane,
  vertical stop timeline, per-stop passenger rows, swipe action bar).
- QR → **two payloads, one scanner** (`pay` vs `book`) + universal links.
- Mid-ride dispatch offers → eligible when live ETA to final drop ≤ 5 min
  (exposed as a PlatformSetting).
- New-ride alert → sound + haptic + full-screen popup, repeating, driver-toggleable.

## Batch A — ambient background & driver palette (items 1, 9)

- [ ] A1 `shaderSlot` becomes priority-aware: an ANIMATED background outranks a
      STATIC one, so a pushed/tab screen can never demote the app's single live
      canvas to a frozen frame.
- [ ] A2 Driver `(tabs)/*` screens drop their own `<AppBackground/>` — the tabs
      group already declares `TRANSPARENT_CONTENT`, so the root shows through
      (this is exactly what the rider does).
- [ ] A3 `overFullBleedMap` no longer matches `'home'` by substring; the home
      map is full-bleed but the sheet above it is translucent.
- [ ] A4 `driverColors` background ramp → deep near-black (was `#030C18`).

## Batch B — rider trip surface

- [ ] B1 (#2) Book-a-ride map shows the PICKUP pin, and recenter reframes the
      whole route instead of jumping to the user.
- [ ] B2 (#3) 4-seat request → `FARE_EXPIRED` "party size changed".
- [ ] B3 (#4) Remove the duplicate back control on the request stage error card.
- [ ] B4 (#6/#15b) Walking leg (rider → pickup) must follow the road.
- [ ] B5 (#7) Tracking page freezes on `ARRIVED_AT_PICKUP`.
- [ ] B6 (#10) Ride-complete shows placeholders / "Your Driver".
- [ ] B7 (#14) False "you're already on a ride".
- [ ] B8 (#16) Boarded state never reaches the rider — new BoardedCelebration.
- [ ] B9 (#18) "Find another ride" after a no-show lands on the search stage.
- [ ] B10 (#12) "Set a destination" is a dead op.

## Batch C — driver bugs

- [ ] C1 (#13a) Home camera puts the driver under the balance card.
- [ ] C2 (#13b) Heatmap is wrong + half-built — end-to-end pass.
- [ ] C3 (#15a) Passenger payment shows an error-coloured toast.
- [ ] C4 (#17) No-show → "unfinished ride" toast → blank manage screen.

## Batch D — dispatch alerting (item 5)

- [ ] D1 Full-screen offer popup, app-wide, over any screen.
- [ ] D2 Alert sound + haptics, repeating while the offer is live.
- [ ] D3 Mid-ride offers when ETA to final drop ≤ 5 min.

## Batch E — redesigns

- [ ] E1 (#5) Dispatch screen — map gets real height, details legible.
- [ ] E2 (#6/#8) Driver tracking — Stop Timeline.
- [ ] E3 (#6/#8) Driver manage trip — Stop Timeline + cabin strip.
- [ ] E4 (#20a) Seat sheet redesign.

## Batch F — the rest

- [ ] F1 (#11) Apple-grade screen transitions (kill the flat fades).
- [ ] F2 (#19) QR split + deeplinks end to end.
- [ ] F3 (#20b) Guest booking goes straight to seat selection.
