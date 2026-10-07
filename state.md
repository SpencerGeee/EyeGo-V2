# State — 2026-10-07 (UI + bug pass for client demo 2026-10-08)

## Current Goal
Uber/Bolt-grade UI across rider + driver AND hunt hidden bugs everywhere (user: client demo tomorrow,
iOS + Android parity, no subagents). Grilled + locked:
- Look: Onyx (dark; rider green, driver blue) + Uber RESTRAINT — max one glow per screen, flat rows.
- Kit: packages/ui/src/page/Page.tsx (Screen, ScreenHeader, LargeTitle, ListSection, ListRow,
  SkeletonRows) + QueryBoundary. ListRow holds pressed state itself (no style functions).
- Delivery: 4 batches, commit+push each for OTA.

## Plan status
- ① DONE 0278583 — kit + driver account/settings/perf/docs/vehicle/payout/edit/help/safety/privacy/
  terms/delete/earnings, driver+rider phone/OTP, driver register→setup wizard.
- ② DONE 776f0ce — rider account tab, settings hub, privacy(+policy page), notifications, safety,
  trusted contacts, edit, wallet, payment methods, promotions, help, business, send credits, scan&pay
  (header/permission), saved places; schedule Android picker.
- ③ DONE (this commit) — browse = full map + 3-stop sheet, native clusters, Where-to search + place filter,
  sort soonest/nearest/cheapest, boarding strip, rich rows, Notify me (TripAlert model + migration
  20261007180000 + publish hook + push), calendar-correct departure labels, platform-identical clock.
- ④ NEXT — consistency + bug sweep: driver tabs (home/trips/notifications/quests), trip flows (both apps),
  rider tabs (home/services/activity/notifications/trips), place-picker, location-picker, guest-selection.

## Evidence
- tsc rider/driver/admin clean; static suites green; e2e driver-features 42, wallet-commission 18,
  money-flows 10, trip-alerts 10, driver-happy-path 32, rider-settings 83, rider-features 30, rider-edges 30.

## Open / tell the user
- Restart Claude Code (ECC env change). `prisma migrate deploy` (20261007120000 + 20261007180000_trip_alerts).
- Share-trip SMS fires only on online-paid confirmations; tracking link domain eyego.app unverified.
- No email service exists (business receipts by email, referral programme: removed from UI).
- KYC retention decision.
