# State — 2026-10-08 (device-test round 2 before the client demo)

## Current Goal
Fix the 8 items from the user's two-app device test and polish the pages no batch touched.
Grilled + locked:
- Driver trip = ONE screen `(trip)/active/[id]`: own map + TripStages sheet, manage folded into
  the sheet (drag up), swipe pinned at the bottom, no tab bar. Home is idle-only with a
  "Trip in progress / Your next trip" card. Supersedes 2026-09-17 "driver trip = stages on home".
- Offer map = driver → pickup only; trip length shown as numbers + heading, destination hidden.

## Plan status — done this round (main)
- 8498eba driver trip screen, party boarding (server + client), minibus puck, offer card
  facts, self-ride refusal message, softer chime, cancel releases cover-all, tripKm/tripMinutes.
- da34cf6 rider: own hold selectable (isMyHold), hub releases hold after cancel lands, live card
  kinds (searching / hold / ride), ended-while-closed → receipt, seat picker pass.
- 519593d driver receipt one row per person, trips card honest seats/fares, alerts Today/Earlier.
- (this commit) seat map `req.user.userId` (isMine was never true), zero-commission cash rows
  board, offer card mojibake, completed trip → receipt, swipe labels, party-boarding e2e suite.

## Evidence
- tsc rider/driver/admin clean. conditional-hooks clean.
- Local stack: party-boarding 6/6 (new), driver-happy 32/32, driver-features 42/42,
  rider-features 30/30, rider-happy 35/35, dispatch-payload 15/15 (offer carries tripKm),
  lifecycle-edges 17/17, completion-pass 19/19, silent-failures 28/28, ui/ux/motion/button/formatters/maestro invariants
  green, wallet-commission 18/18.

## Open / tell the user
- PRODUCTION API must be redeployed (server changed: boarding, cancel, seat map, offer hint,
  trips list). No new migration this round. Earlier: `prisma migrate deploy` still owed for
  20261007120000_promo_subsidy_per_user_limit and 20261007180000_trip_alerts.
- New chime + vehicle PNG are assets: OTA carries them, but verify on device.
- Not device-verified: trip-screen sheet heights (0.42/0.52/0.42) with the pinned bar,
  minibus puck rotation, seat picker live pulse.
- Older open items: universal links domain, Paystack callback_url, social sign-in, email
  service, driver support tickets shadow user.
