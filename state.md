# State — 2026-10-08 (UI + bug pass for the client demo)

## Current Goal
Uber/Bolt-grade UI across rider + driver AND hidden bugs found everywhere (client demo
2026-10-08, iOS + Android parity, no subagents). Grilled + locked:
- Look: Onyx (dark; rider green, driver blue) + Uber restraint — one glow per screen, flat rows.
- Kit: packages/ui/src/page/Page.tsx (Screen, ScreenHeader, LargeTitle, ListSection, ListRow,
  SkeletonRows) + QueryBoundary. ListRow holds pressed state itself (no style functions).
- Delivery: batches, commit + push (OTA) after each.

## Plan status — ALL DONE, pushed to main
- ① 0278583 kit + driver account/auth/onboarding.
- ② 776f0ce rider account/settings hub.
- ③ b916aed browse = map + 3-stop sheet, native clusters, Where-to, sort, boarding strip,
  Notify me (TripAlert + migration 20261007180000_trip_alerts).
- ④ c5fe935 → 130a422 sweep: hand-built dates/money (@eyego/utils/dates.ts, formatters
  suite), driver tomorrow-trip picker, createTrip departure validation, lying screens fixed
  (quests fallback, services fares, trip summary, notifications/activity errors), social
  sign-in dead end removed, card-checkout close verifies, tips/top-ups pick MoMo network by
  number, rate-tip retry, invite links survive sign-in, SOS number, invented capacities.

## Evidence
- tsc rider/driver/admin clean. run-all 514/514 (25 suites) before the last rounds; money,
  wallet, rider/driver feature suites re-run green after each server change.

## Open / tell the user
- PRODUCTION API: deploy the server AND run `prisma migrate deploy`
  (20261007120000_promo_subsidy_per_user_limit, 20261007180000_trip_alerts). OTA only ships apps.
- `https://eyego.app/pay|invite` universal links need the domain + AASA/assetlinks; in-app
  scanner and API-served /invite, /track pages work without it.
- No Paystack callback_url is set (card checkout now verifies on close, so it is safe).
- Social sign-in removed: server verifies Firebase tokens; needs a Firebase credential
  exchange + Google SDK before it can come back.
- No email service (business receipts / referrals removed from UI). KYC retention decision.
- Driver support tickets create a shadow rider User (schema change needed).
- Restart Claude Code (ECC hook env change from earlier).
