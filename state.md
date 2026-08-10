# State — Stress Sweep 2026-08-10c (26 items)

## Current Goal
26-item stress-test list. 24 done and committed; 2 partially addressed.

## Decisions (confirmed with user)
- Rider Where-to = 5 paged steps. Steps 1–2 stay on SearchStage's existing
  card (pickup/destination are two rows of one timeline); 3–5 are the new
  `ConfigureStage`.
- Driver destination filter: 2 uses/day, ends at first matched trip or 2h.
- Loader: Reanimated port of luma-spin, replaces every loader in both apps.
- Delivery: 5 commits on `main`, both apps `tsc` green before each.

## Plan Status — commits c5729ac, c968be9, 1b4752e, 401409d, 046360f

### DONE
1  Neon P1001 — retry extension + 503 mapping (`config/database.js`, `errorHandler.js`)
2  Dispatch never arrived — `req.driver.id`/`req.user.id` were both undefined
   (JWT field is `userId`); AND nothing rendered the stored offer → new
   `apps/driver/components/DispatchOfferSheet.tsx`, root-mounted
3  Rider paged Where-to — `ConfigureStage.tsx` + step dots on SearchStage
4  Suggested card — `maxCapacity` doesn't exist (`maxSeats`); destination added
5  Loader — orbiting-square Reanimated port; every ActivityIndicator swapped
6  Invite page — fetch no longer gated on MapLibre `load`; links follow the
   live request origin (`utils/publicUrl.js`, `app.set('trust proxy', 1)`)
7  Group-hub cash — empty `bookingId` reached `/payments/initiate`; heavy-cargo
   now editable while PENDING
8  Rider cancel — Cancel action on every live booking row in Activity
9  Straight line — `estimateLeg` returns `geometry: null`; clients draw nothing
   until the road route lands
10 Top scrim — 200pt → 118pt, 0.45 → 0.34
11 Chat badge — `apps/rider/stores/chatUnread.store.ts` + badge on both buttons
12 Rider chat — removed 156pt clearance for an in-flow header
13 Line-height — add-passenger + 67 more sites across both apps
14 Offline-passenger latency — awaits refetch, drops the confirm modal
15 Booked seats — stepper walks free seats only, from real occupancy
16 Wrong leg — client discards a path whose leg ≠ current status (`pathForStatus`)
17 Stuck ETA — `DRIVER_ASSIGNED` had no leg in `activeLeg`
18 Route casing — black, 11pt (was backgroundDeep @ 0.55)
19 Destination pin — group trips keep dropoff on the Route; snapshot now falls back
21 Transaction expiry — quests moved post-commit, tx budget 20s
22 Recenter overlap — pill stack bounded `right: 76`
25 Destination mode — `destination-mode.service.js`, matcher filter, migration,
   `DestinationModeCard.tsx`
26 /caveman + /context-management used throughout

### PARTIAL — say so plainly
20/23/24 Perf. ONE structural cause fixed and it is the big one: every screen in
   a stack rendered its own full-screen Skia raymarch, so four screens deep meant
   four shaders compositing every frame. Now only the topmost, foreground one
   animates (`packages/ui/src/effects/topmostBackground.ts`). NOT measured on
   device. `SwipeToConfirm` was already transform-only; its `runOnJS` deprecation
   was left alone deliberately — see Open Issues.

## Evidence
- `tsc --noEmit` exit 0 for apps/rider and apps/driver after every commit.
- `node --check` clean on all changed backend files; `prisma validate` passes.
- Nothing device-tested.

## Open Issues
- `runOnJS` deprecation in SwipeToConfirm/trip.tsx left as-is: this repo has a
  history of SIGABRTs from gesture-callback worklet changes (see
  `project_sweep_2026_07_30`). Cosmetic warning, not worth the crash risk.
- Migration `20260810120000_driver_destination_mode` is written but NOT applied.
- `(trip)/dispatch/[id].tsx` is still the legacy scheduled/route offer screen.
  The new sheet handles on-demand only; converging them is unfinished work.
- Perf items need a device pass to confirm the thermal fix.
