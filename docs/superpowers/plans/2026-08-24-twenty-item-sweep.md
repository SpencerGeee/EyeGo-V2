# Sweep 2026-08-24 — 20 items

## Root-cause spine

Three defects explain items 1, 3, 4, 5, 6, 10 and 12 between them:

1. **The cascade never lets go of `currentDriverId`.** `offerNext` sets
   `state.currentDriverId` / `state.expiresAtMs` when it offers, and *nothing*
   clears them when the offer lapses. So after a timeout the row still reports
   `offeredToMe: true` with a deadline in the past. `PendingDispatchList`
   computes `mine = offeredToMe && secondsLeft > 0`, which is false, and falls
   through to the `IN QUEUE` tag — while the offer screen reads the same stale
   deadline and says "Offer expired". Both symptoms in item 1, one line apart.
2. **A rider cancel can leave the trip live.** `cancelBookingWithFee` returns
   early with `transition: null` when the seat set is already empty, and only
   reconciles the trip when `activeCount === 0`. Any other shape leaves a
   `MATCHING` / `DRIVER_ASSIGNED` trip with no passenger: the rider is told "you
   already have a ride", the driver is `BUSY` to `isDriverAvailable` forever,
   and the trip keeps being advertised in the dispatch list.
3. **A live snapshot switches off the offer poll.** `_layout.tsx` skips
   `hydrate()` whenever `snapshot` is a live status. A stale trip from (2) thus
   kills the 2-second safety net for the rest of the session — item 10.

## Items

| # | Area | Fix |
|---|------|-----|
| 1 | backend + driver | Clear the offer holder on timeout/decline/park; expiry-aware `offeredToMe`; instant list refresh |
| 2 | driver | Dispatch board on `(tabs)/home`, Alerts keeps its Dispatch filter |
| 3 | backend | `reconcileTrip` — a trip with no live passenger and no driver is terminated |
| 4 | backend | Cancel always reconciles; `listSearchesForDriver` re-verified against bookings |
| 5 | driver + backend | One-tap Pass with a real result; declines expire after a cooldown |
| 6 | driver + backend | Complete screen refuses to render a receipt for a trip that is not COMPLETED |
| 7 | backend | Reverse geocode asks for `address` first, then falls back to `place` |
| 8 | full stack | `MapReport` model, `/v1/map-reports`, rider `improve-map` hub + 6 flows, admin queue |
| 9 | full stack | `SavedPlace.slot` + unlimited custom names |
| 10 | driver | Poll suppression keyed on a *fresh* live trip; socket re-dial on foreground |
| 11 | driver | Tier cards: constant ring thickness, equal content boxes |
| 12 | backend | Same as 3/4 — plus `bookSeat`'s active-ride guard reconciles first |
| 13 | driver + backend | `guestName` wins over the account holder's name everywhere |
| 14 | rider | Tracking surface renders BOARDED |
| 15 | rider | RideCheck never auto-sends; explicit button only |
| 16 | rider | Share uses the tracking link + a real place name |
| 17 | rider | Recenter follows the vehicle, like the driver app |
| 18 | driver | Toast redesign |
| 19 | rider | "Ended without a driver" only when that is what happened |
| 20 | driver | Dispatch surface: glass, glow borders, shimmer text |

## Status

- [x] Phase 1 — backend dispatch + lifecycle integrity (1, 3, 4, 5, 6, 12)
- [x] Phase 2 — geocoding (7, 16 partial)
- [x] Phase 3 — driver app (1, 2, 5, 10, 11, 13, 18, 20)
- [x] Phase 4 — rider app (14, 15, 16, 17, 19)
- [x] Phase 5 — saved places (9)
- [x] Phase 6 — improve maps (8)

## Verified

- `prisma validate` — valid
- `prisma generate` — `MapReport` + `SavedPlace.slot`/`sortOrder` present, `@@unique([userId, slot])` applied
- `tsc --noEmit` — rider, driver, admin all exit 0
- `node --check` — every touched backend file parses
- `require('./src/app')` — loads with the new `/v1/map-reports` mount and both new services

## NOT verified (needs a device / a running stack)

- The migration has NOT been applied — run `npx prisma migrate deploy` before the API starts,
  or `POST /v1/map-reports` and every saved-place write 500s on a missing column.
- No device testing. The dispatch fix in particular wants a two-phone run:
  request a ride, let the 45s offer lapse, confirm the row goes to
  "OPEN · TAP TO TAKE" rather than "IN QUEUE", and that tapping it claims.
- Photo upload on a map report is not wired — the form holds local URIs and
  filters them out on submit. The report still carries location, name, note and
  the structured payload. Flagged in the code at the submit call.

## Traced end-to-end (item 1, the reported scenario)

1. One driver, one candidate. Offer sent, `currentDriverId` set.
2. Driver is late → timeout handler `releaseHold` + persist → revoke frame → `offerNext`.
3. Candidate list exhausted; widening finds nobody new; `releaseHold` + park.
4. `listSearchesForDriver`: `holdLive` false → `holder` null → `offeredToMe: false`,
   `heldByAnother: false` → the row is **claimable**.
5. Board renders "OPEN · TAP TO TAKE" (was "IN QUEUE"); tap opens the offer card
   showing "OPEN" with the swipe live (was "Offer expired" + bounce home).
6. `acceptRide` → `currentHolder()` null → claim proceeds.

The 10s resweep still re-offers exclusively on its own tick; both paths work.
