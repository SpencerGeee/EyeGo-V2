# Reviewer Triage — 2026-08-17

Two external reviewers (Claude, Gemini 3.1 Pro) read `EYEGO_FEATURE_INVENTORY.md`
and produced a combined 13 claimed defects. Each was checked against the code.

## Already handled — reviewers were wrong (no change)

| Claim | Reality |
|---|---|
| `IN_PROGRESS → REASSIGNING` strands a rider mid-highway | Edge does not exist. `trip-state.service.js` `TRANSITIONS[IN_PROGRESS]` = `{COMPLETED, CANCELLED(sys), EXPIRED(sys)}` only. |
| Concurrent seat overbooking | `bookings.service.js` runs booking creation in `$transaction(..., { isolationLevel: 'Serializable' })`. Postgres aborts the loser. |
| Scheduled-task duplicate dispatch race | `scheduled-task.service.js#claimDue` already uses `FOR UPDATE SKIP LOCKED` + a claim lease. |
| `SIMULATED` wallet credit inflates revenue | Revenue reads `Booking.fareAmountPesewas WHERE paymentStatus=PAID`, never `WalletTransaction`. (The *root* risk is still real — see fix 1.) |
| `OFFER_REVOKED` window lets a driver accept a dead ride | `cascade.cancelCascade` calls `forgetOffer` → the 2 s poll answers `null`; and `acceptRide` goes through `applyTransition`, which rejects any edge out of a terminal status. |
| `trip:eta` room leak after reconnect | `tripChannel.ts` rejoins on `connect`, detects seq gaps, and replays via `/events?since=`. |
| GPS drop permanently evicts a driver from the geo-index | The next in-bounds ping calls `supply.upsertDriver` unconditionally. Recovery is automatic. |
| `fitBounds` degenerate-bbox SIGABRT | `packages/maps/src/camera.ts` pads every box to `MIN_SPAN` and refuses to fit an empty box. |

## Real — fixing

1. **`PAYMENTS_SIMULATED` has no fail-closed boot assert.** Setting it `true`
   with `NODE_ENV=production` mints real balance. Throw at boot instead.
2. **Two divergent redispatch paths.** `drivers.service#redispatchTrip` bypasses
   the cascade and pushes `trip:assigned` to *twelve* drivers at once —
   violating "exactly one driver holds an offer" (invariant 13), setting no
   `dispatch:offer:driver:*` key (so the driver poll cannot recover it), with no
   offer TTL. It also sends its own rider push, violating single notification
   ownership (invariant 16). Delegate to `cascade.startCascade`.
3. **Public `/track/:shortId/data` is not lifecycle-gated.** It serves the
   driver's live coordinates, photo and plate forever — including after
   drop-off, so the link becomes a permanent driver tracker.
4. **`Driver.status` is a free-form string** compared to `'ACTIVE'` in 15 places.
   `'Active'`/`'ACTIVE '`/`'APPROVED'` silently removes a driver from dispatch.
5. **Min-occupancy departure is unenforced and unacknowledged.** The driver
   eats the whole loss of an empty bus without ever being told.
6. **Rider spinner trap when the socket never connects at all.** `tripChannel`
   recovers once on subscribe, then waits for a `connect` that may never come.
7. **A driver vanishing mid-trip is invisible to the rider.** `trip-health`
   notices at 180 minutes and only logs. The rider watches a frozen puck.
8. **No lint guard on `Pressable`** despite it being a load-bearing invariant.

## Found while checking — not on either reviewer's list

- **`drivers.service#redispatchTrip` was a second, parallel dispatch engine.**
  Neither reviewer saw it; it is the worst thing found this pass. Fixed as item 2.
- **The driver app's generic 409 handler swallows every conflict as "this step
  already went through".** Correct for a double swipe, and it would have
  silently eaten the new under-minimum refusal — leaving a driver sitting at the
  pickup point believing they had departed. The new branch is checked first.
- **`errorHandler` dropped `err.details`**, so a refusal the client has to
  render (not just display) had nothing to render from. Now forwarded, for
  operational errors only.
- **264 files import `Pressable` from `react-native`** against invariant 17.
  Most are harmless — RN's Pressable handles a plain object style fine. The
  enforced guard covers the case that actually breaks (a function style in a file
  that imports no `@eyego/ui`), which is currently clean. Migrating the rest is a
  cleanup, not a defect.

## Deliberately not doing

- **`Driver.status` → Prisma enum.** Migration SQL is gitignored and tables were
  created directly against the dev DB; a schema migration here is riskier than
  the bug. Fix 4 normalises on write and rejects unknown values at the edge,
  which closes the actual failure mode without a migration.
- **Cover-all → one `Booking` with `seatCount`.** Both reviewers are right that
  it is the cleaner model, and both also concede it is a real migration (seat
  maps, per-seat boarding PIN, per-seat ratings all hang off the booking row).
  Not a same-day change alongside 8 other fixes.
- **Broadcast/Trip-Radar fallback after the first sequential sweep.** Sound
  advice, but it is a product change with driver-earnings-fairness implications,
  not a bug fix. Already sized in `docs/FEATURE_BACKLOG_DRIVER_RIDER.md`.
- **Multi-stop trips, rider loyalty.** Real product gaps; not defects.
