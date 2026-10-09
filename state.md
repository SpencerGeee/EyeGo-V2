# State — 2026-10-09 (premium pass + bug-class hunt + admin audit)

## Current Goal
User: make everything premium, hunt every bug class (like the money audit), find all system
flaws, audit the admin side for completeness.

## Done (pushed to main)
- d158369 light mode: shader light composite, white grounds, crest balance (+ shader-compile.mjs)
- b299f71 single-line button labels everywhere (+ ux-invariants rule 4)
- 740fa61 ride options: per-tier ETA (nearest car of class) + drop-off time, trip summary, Cash row
- 5350277 schedule a ride, Uber Reserve style; scheduled list polish; forced-dark glass removed
- 183c00a bug-class sweep:
  * publishSeatUpdate selected non-existent Booking.seatHeldUntil → every seat push threw and
    was swallowed (since 5ea52c5). Fixed; new static check prisma-fields.mjs (brace-matched).
  * seats-not-rows in 9 server/admin sites (availability, group page, pulse, GraphQL, offers,
    upcoming, rider fare summary, admin user/driver pages)
  * GH₵0.00 shown for unknown money at 6 display sites
  * admin Payouts page + GET /admin/payouts (paid / processing / failed→refunded, >24h stale)

## Classes checked clean
IDOR (all param handlers are admin-gated or token-public by design; tracking is cuid + lifecycle
gated), direct trip status writes (all CAS-guarded), unknown status literals, uncleared
intervals, money amount validation (services assert pesewas), admin route guards (auth +
read-only blanket + roles on money/settings + audit on writes), swallowed money writes.

## Evidence
- tsc rider/driver/admin clean; conditional-hooks, ui/ux/motion/button/formatters/maestro,
  prisma-fields, shader-compile green.
- run-all before the sweep fixes: 518/522 (3 suites red from a crawling local DB: 250 ms
  SELECT 1, 10 s Prisma tx timeouts). Docker Desktop then stopped responding; the post-fix
  rerun could not complete. RE-RUN run-all once Docker is healthy.

## Open / tell the user
- Redeploy production API (seat push fix, seats sums, nearby-driver tier/distance, payouts).
- bookSeat runs a 10 s interactive transaction; with the DB 280 ms away (Frankfurt) a slow
  moment 500s a booking — colocate API + DB (see Latency Is Topology memory).
- Premium pass NOT yet done on: rider Activity/Services layout, driver create-trip,
  add-passenger, location picker, chat; seats & extras steps beyond shared fixes.
- Device-verify: light wave, ride option rows, schedule strips, trip sheet heights, puck.
