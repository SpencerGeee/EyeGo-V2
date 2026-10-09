# State — 2026-10-09 (premium pass + all-bug-class hunt + admin audit)

## Current Goal
User: "do everything… make sure everything is touched and looking premium… hunt for all types
of bug class… identify all the flaws in the system and also audit the admin side so it's complete."

## Done this session (all pushed to main, last 93974f3)
- Device round 2026-10-08: driver one trip screen, party boarding, minibus puck, offer card,
  rider seat holds/live card/ended-while-closed, seat picker life, receipts, trips/alerts.
- Light mode: shader light composite (white valleys, brand crests, opaque, contrast curve,
  luminance-balanced crest), white grounds, 9 forced-dark GlassSurface removed, dark-only colours.
- Button labels single-line (Button/ShinyText + 30 hand-built labels) + ux-invariants rule 4.
- Rider request flow: ride options (per-tier ETA from nearest car of class, drop-off time, trip
  summary, Cash row, named CTAs), Plan your ride (Choose a ride, distances), schedule Uber
  Reserve style, scheduled list polish. Server: nearby drivers return tier + rounded distance.
- New harness: party-boarding.mjs, shader-compile.mjs, dispatch-payload offer-length check.

## Plan (this turn)
1. Run full run-all against local stack (docker compose up; API on 5020; run in background).
2. Bug-class hunt by grep: req.user.id (done), IDOR/ownership, seats-as-rows, lying fallbacks
   (`?? 0` money / placeholder text), swallowed write errors, status writes bypassing
   assertTransition, missing select fields, unbounded queries, socket room names.
3. Admin audit (apps/admin Next 15): build/tsc, RBAC on every route, audit log, money pages.
4. Premium pass on untouched pages (Activity, Services, driver create/add-passenger…).
5. Docs: state.md, session-log [saved], memory.

## Open / tell the user
- Redeploy production API (nearby-driver tier/distance, seat map userId fix, party boarding).
- Device-verify: light wave, ride option rows, schedule strips, trip sheet heights, puck.
