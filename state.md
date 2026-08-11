# State — Stress Sweep 2026-08-11b + feature round

## Bugs: ALL RECEIVED ITEMS FIXED. Features: 2 of ~13 shipped.

## Commits this session (11)
`44720bf` where-to rebuild · `7d20378` matching screen bg · `49852f4` pickup
semantics + post-trip map · `d23616f` invite polyline + brand map + ETA ·
`d03a7e9` driver manage sheet · `2b0698a` SelectStage back nav ·
`e0f6532` held-seat/idempotency/keyboard · `623e360` cancel screen ·
`ca233c6` driver shell + green glow · `b3284b9` Verify My Ride + Pause Requests

## Second bug batch (the items 8–22 the user re-sent)
1. Chat keyboard — **third** attempt. Root cause both prior fixes missed:
   `KeyboardAvoidingView` infers space from its own frame, and the frame was
   wrong (not root, edge-to-edge, shifting safe-area). Now uses
   `useReanimatedKeyboardAnimation` height directly. Both chats.
2. Phantom booking — invite holds seats at `SEAT_HELD`; server AND home screen
   only excluded TERMINAL statuses, so a hold read as a live ride. Now an
   allow-list: `CONFIRMED, PAID, BOARDED`. Invite screen declares its round trip.
3. Idempotency 409 — **our own retry** racing our own first attempt on a slow
   pay-for-all. Client now treats `IDEMPOTENCY_IN_PROGRESS` as retry-after-
   backoff; server releases the reservation on `close` as well as `finish`.
4. Cancel screen — `isFeeLoading` was `!cancelFeeData`, so a FAILED fee query
   was stuck "checking" forever. Now reads `isPending`/`isError`. Separately the
   ScrollView had no `flex`, so it sized to content and clipped its own tail.

## Visual overhaul (user's mid-turn request)
- `apps/driver/components/trip/TripSurfaceShell.tsx` — ONE shell both driver
  trip screens render. Owns panel geometry (from rider `TrackingStage`),
  the Reconnecting chip, spacing rhythm, card ring. **Visual layer only** — no
  trip logic touched, per the user's explicit choice.
- `apps/driver/stores/connection.store.ts` — presentation-only socket state.
  `useDriverSocket` had connect/disconnect handlers that only console.logged.
- `packages/ui/src/effects/CardAuroraGlow.tsx` — green bottom bloom on the
  rider tracking panel. Centre BELOW the surface, intensity hard-capped at 0.28,
  single static paint. All three are constraints, not defaults.

## Features
**Shipped:** Verify My Ride (PIN), Pause Requests. Both opt-in, both default to
today's behaviour.
**Remaining ~11:** see `docs/FEATURE_BACKLOG_DRIVER_RIDER.md` — audited, sized,
ordered, with the blocking decision named for each. Record My Ride is
deliberately unbuilt with a legal write-up.

## Decisions locked (do not re-ask)
- Trip Radar = broadcast first, sequential cascade as fallback.
- Record My Ride = not built; needs Ghanaian DPA review first.
- Driver screens = one shared shell; visual layer only.
- Green glow = subtle bottom-anchored, static.

## Verification
- `apps/rider` and `apps/driver` `tsc --noEmit` → **exit 0** after every commit.
- `node --check` clean on every changed backend file. Prisma schema valid.
- **NOTHING device-tested.** Needs a new EAS build + a backend deploy.

## MUST DO BEFORE DEPLOY
1. Run the migration `20260811120000_boarding_pin_and_pause_requests`.
   Additive only (nullable columns + defaulted booleans) — safe on live data.
2. `prisma generate` — it failed locally with a Windows EPERM file lock
   (`query_engine-windows.dll.node`), which is environmental, not a code fault.
   It will regenerate on a clean run.

## Traps
- `GradientGlowBorder` needs `fillColor`; reach cap is `maxGlowRadius`.
  Clipped glow = padding + cap, never lower `glowIntensity`.
- A ScrollView with no `flex` in a column parent sizes to CONTENT and clips.
- `npx` is broken: `node node_modules/typescript/lib/tsc.js --noEmit` from
  inside `apps/<app>`.
