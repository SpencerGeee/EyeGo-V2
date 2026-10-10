# State — 2026-10-10 (completeness + rival-parity pass)

## Current Goal
Close the "while you were away" holes, make both inboxes real, and build the rival-parity gaps (Uber/Bolt/Yango/Lyft).

## Decisions (grilled with user 2026-10-10)
- Inbox (both apps) = away-outcomes.service facts over 30 days, same wording as the away sheets, read state per device. No Notification table.
- Rider late-cancel / no-show fee → driver wallet minus the trip's commission rate (new `CANCELLATION_FEE` row).
- Wait fee: on-demand only; runtime settings (3 free min, GH₵0.50/min, cap); goes to driver minus commission.
- Mid-trip change destination / add stop: on-demand only; rider re-quotes from pinned rates, confirms; driver notified (no consent); TripEvent.
- Doc expiry: reminders 30/7/1 days; on expiry → EXPIRED + dispatch blocks until a new one is approved.
- Fatigue: 12 h online → 6 h break (runtime settings); warn at 11 h; current trip may finish.
- Referral: rider→rider credits after invitee's first completed paid ride (default GH₵10 each), one per phone, no self-referral.
- Lost item: from a finished trip (≤7 days) → LOST_ITEM ticket + driver push/away + 1:1 chat reopened 24 h; driver marks found/not found.
- Cash change: driver enters cash received; overpayment → rider wallet credit + driver wallet debit, one tx, capped.
- Ride prefs (quiet / AC / luggage help) in profile + per-ride pickup note; driver sees chips + note on offer + trip sheet.
- Providers: Resend email receipts; Africa's Talking masked calls; selfie ID — all key-gated, no-op until keys set.
- My calls (no question): driver away-sheet live duplicate fix; support-reply push + outcome; report-resolved / payout-completed outcomes; rider scheduled-ride reminder.

## Evidence (verified 2026-10-10)
- Driver AwayOutcomesSheet re-shows live-bannered events (DriverTripStatusListener banners cancel/joined; no told-marking).
- admin respondToTicket: no push, no socket. resolveTripReport: tells nobody.
- notifications.routes.js (rider) + drivers.service getNotifications: derived feeds; markRead no-ops; unread-count = paid bookings.
- cancellation.service keeps fee from refund; no driver credit anywhere.
- DriverDocument.expiresAt indexed, never read outside admin.
- Referral/ReferralBonus models exist; nothing writes them.

## Plan status
[ ] A away/inbox  [ ] B money (cancel fee, wait fee, cash change)  [ ] C trip (prefs+note, mid-trip edit, rider reminder)
[ ] D driver compliance (doc expiry, fatigue, selfie stub)  [ ] E growth/support (referral, lost item, email, masked calls)
One migration for new columns — user must run `prisma migrate deploy` (boot refuses pending migrations).
