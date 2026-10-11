# State — 2026-10-10/11 (completeness + rival-parity pass)

## Current Goal
Close the "while you were away" holes, make both inboxes real, build the rival-parity gaps. DONE — not pushed.

## Decisions (grilled with user 2026-10-10)
- Inbox (both apps) = away-outcomes.service facts over 30 days in the sheets' words; read state per device.
- Late-cancel / no-show fee → driver minus commission (CANCELLATION_FEE ledger row).
- Wait fee: hailed only; free minutes + cap are settings; RATE = tier card RIDE_<T>_WAIT_PER_MIN_PESEWAS (existed, never charged).
- Mid-trip destination / stops: hailed only, rider re-quotes, no driver consent; Trip.dropoff = NEXT place, Trip.onwardStops = queue.
- Fatigue 12 h / 6 h break; referral rider→rider (GH₵10 each after first paid ride); lost item → driver; cash change → wallets.
- Ride prefs (quiet/AC/luggage) + pickup note; providers key-gated: Resend email, AT voice masked calls, selfie check.

## Commits (main, local only)
622288a inbox+away · 30bc069 cancel/wait fee · a9387e8 cash change · 1c83d04 prefs+note · d844a85 route change
7455014 expiry-spam fix + departure reminders · 361b7bc fatigue · f8d4f31 referrals · 9f74491 lost items
084c0aa email receipts · 76748cb masked calls · eb68e42 selfie check

## Bugs found & fixed on the way
- Driver SOS ticket used userId=driverId (User FK) → never created (ticketUserFor).
- Every rider dispute 404'd (trip id posted as booking id).
- Doc-expiry sweep re-pushed hourly for 30 days (~720 pushes/doc) → expiryNoticeDays.
- SupportTicket.driverId ambiguity (own ticket vs rider dispute about driver) → phone discriminator.

## Verification
tsc rider/driver/admin green; API jest 178 pass / 3 fail (PRE-EXISTING stale mocks: payments.service, concurrency.webhook,
bookings.e2e — fail identically on bf3abc1); static e2e invariants all green; server e2e suites not run (no local API).

## Hidden-bug hunt (2026-10-11, user: "find all the hidden bugs before pushing")
Method: hunt by bug CLASS with scratch scripts (scratchpad/*_audit.js), verify each hit by hand.
Clean classes: client→server route match, route shadowing, socket emit/listen, swallowed writes,
req.user.id, enum literals, missing await, async filter/forEach, nav targets (button-wiring).
Fixed (db67b00): scheduled rides → dead TripRequest engine; scheduled seat SEAT_HELD vanishing +
confirmedSeats leak; wrong-trip receipt/rating via store activeBooking; 11 env-reads of console knobs.
Fixed (0e58681): driver top-up + payout reversal double-credit race (FOR UPDATE row lock); 3 stale suites → API jest 181/181.
Fixed (5cf6083): passenger chat leaked to browsing riders (trip:<id>:chat room); cash-change + route-change double-apply;
  FCM raw fetch ignored 401; WALLET_CREDITED/DISPUTE push taps.
Fixed (a6d62fa): away/inbox seen-state per account, not per device.
Checked clean: refunds (cash excluded, claim-once), rider top-up claim, settleTip, IDOR on receipts/booking/contact/events,
  room-join auth, my new endpoints' ownership.
Fixed (cfbc391): boarded cash commission never returned when a trip ends undriven.
Not re-audited this round (covered by earlier passes per memory): auth refresh, cover-all group.
Final: tsc rider/driver/admin 0, API jest 181/181, static e2e all green, prisma valid. PUSHED to main.

## User must do
1. `npx prisma migrate deploy` (migration 20261010120000_parity_pass) — boot refuses pending migrations.
2. Optional keys: RESEND_API_KEY, AT_VOICE_NUMBER (+ AT voice callback → /v1/contact/voice), DRIVER_SELFIE_CHECK_HOURS.
3. Push when ready (asked).

## Device-test watch list (new)
- Away sheet: no repeats of live banners after background/foreground; inbox badge clears.
- Wait meter at hailed pickup; receipt 'Waiting time' line.
- Change destination / add stop → driver banner + 'At the stop — continue'.
- Cash change sheet; referral share/redeem; lost item → driver Lost items → rider push.
