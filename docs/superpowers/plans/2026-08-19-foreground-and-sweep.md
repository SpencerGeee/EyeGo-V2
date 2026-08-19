# Sweep 2026-08-19b — foreground durability + 13 fixes

## Root causes found

| # | Symptom | Root cause |
|---|---|---|
| 1 | Driver app shows nothing on foreground while rider says "asking driver 1 of 1" | Offer lives ONLY in a per-driver Redis key with the 45 s offer TTL. Once it lapses there is no server state a foregrounding app can read, and `notifySupplyAvailable` is edge-gated on the presence absent→present transition (`rejoined`) AND skips any cascade that is not `waiting`. A driver who foregrounds mid-offer, or whose presence never lapsed, nudges nothing. |
| 2 | Boarding PIN never appears on the rider after an app switch | `publishBoardingPinRequested` emits with `seq: null` → the sequenced trip channel cannot replay it, and nothing is persisted, so hydrate on foreground has nothing to find. |
| 3 | "In an emergency" bar overlaps Trusted Contacts | `scroll.paddingBottom: 200` is a hardcoded guess; the absolutely-positioned bar is taller (heading + hint + 2 buttons + safe area). |
| 4 | Driver "heading to pickup" while ETA says at-pickup; rider says "on the way" | Only `drivers.startTrip` (scheduled flow) does the at-pickup geofence walk. Dispatched rides land at `DRIVER_EN_ROUTE` and stay there until the driver taps Arrived — nothing watches location. |
| 5 | Seat reserved before OTP verified | `addOfflinePassenger` writes `status: 'SEAT_HELD'` (a seat-occupying status) up front and nothing ever releases it if the OTP is never entered. |
| 6 | Status switching is "basic" | Static chips + one swipe control. |
| 7 | "Driver signal lost" needs an app restart | `DRIVER_LINK_RESTORED` also rides an unsequenced socket frame, the `warned` set is per-process memory, and the rider only ever clears the flag from that frame. |
| 8 | Profile morph lands in the wrong place | Source is a 64 pt circle; target wrapper is 108 pt while the actual photo inside is 96 pt. `MorphTarget` latches the first frame it measures and `targetReady` immediately springs — a later layout pass (safe-area/glow settle) cannot correct it. |
| 9 | No "active promos" section | The applied/saved cards are unlabelled, offer rows never show that a code is already saved, and there is no way to remove one. |
| 10 | Group Ride goes to the normal flow | `type=group` is read but only appends `group=1` to a ride link. The seat stepper is hidden inside the "no rides available" empty state. |
| 11 | Ticket cards plain, tapping does nothing | The detail sheet is a second `PanelSheet` → a second native `Modal` presented while the first is visible. iOS refuses to present it. |
| 12 | Top-up not end-to-end | Hardwired to Paystack MoMo in the route body; no provider seam, no verify/poll loop for the rider, no ledger row. |
| 13 | Scan & Pay misbehaves | Unrecognised codes re-alert on every camera frame (no `scanned` latch), `router.replace` kills the scanner, no torch/re-scan/haptics, no amount on My Code. |

## Order

1–2 (foreground durability, shared), 4, 5, 7 — backend + client
3, 6, 8, 9, 10, 11, 13 — client
12 — payments provider seam

## Verification
`node node_modules/typescript/lib/tsc.js -p apps/rider`, same for driver, `npx prisma validate`.
