# State — 2026-10-07 (UI pass)

## Current Goal
Uber/Bolt-grade UI pass across rider + driver apps (user: "make me proud"). Grilled + locked:
- Look: Onyx (dark; rider green, driver blue) + Uber RESTRAINT — max one glow per screen, flat rows,
  strong type hierarchy, one template. Light + dark both must hold.
- Kit (packages/ui): ScreenHeader (large title → collapses on scroll), ListSection, ListRow,
  ScreenState (skeleton | empty | error+retry). Every secondary page migrates. 33 rider + several
  driver screens hand-roll headers today.
- IA: rider Settings hub (Appearance, Notifications, Privacy, Safety, Legal, Delete account; privacy.tsx
  duplicate delete flow removed). Driver "Ratings & performance" (merge performance+ratings; weekly
  goal → Earnings). Old routes redirect.
- Browse (apps/rider/app/browse/[group].tsx): full map + draggable sheet, clustered pins (ShapeSource,
  not 30 MarkerViews), "Where to?" search + sort (soonest/nearest/cheapest), richer rows (walk time
  to pickup, live countdown, driver rating + vehicle, seat dots), leaving-soon strip + one-tap reserve,
  live seat counts, useful empty state, NOTIFY ME (new table + check on trip publish + push; migration).
- Reference: extend docs/research/2026-10-06-rival-ux-spec.md page-by-page (it only covered 5
  surfaces) BEFORE touching pages.
- Delivery: 4 batches, commit+push each for OTA: ① kit + driver account/auth/onboarding
  ② rider account/settings ③ browse + Notify me ④ consistency sweep. No subagents.

## Done this pass (uncommitted)
- rider profile/account-deletion.tsx: WALLET_NOT_EMPTY confirm flow + truthful copy (it was the
  primary delete path and bypassed the confirm; onPress passed the event as acknowledgeBalance).
- trips.service searchTrips: driver currentLat/currentLng removed from public listing (privacy leak).

## Unpassed clusters (measured: 0 design-system components)
- driver: (profile)/* all 13, (auth)/*, (onboarding), (trip)/location-picker
- rider: profile/{account-deletion,business,notification-preferences,privacy,safety,send-money,terms,
  scan-pay,place-picker}, ride/guest-selection

## Next
1. Rival spec extension (web research, concise, one entry per page).
2. Batch ①.
