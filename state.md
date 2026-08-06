# State — stress-test fix pass (2026-08-06)

## Startup
Dev infra: **Neon (Postgres) + Upstash (Redis)**. API port **5020**.
`npx` is broken — always `node node_modules/prisma/build/index.js …` and
`node node_modules/typescript/lib/tsc.js -p apps/<app>/tsconfig.json --noEmit`.
Both apps typecheck clean; the only tsc output is `TS1149` path-casing noise
(`Eyego V2` vs `EyeGo V2`), pre-existing and not actionable.

## Decisions (locked by user)
- **Money: integer pesewas everywhere.** Apps never do math on raw values; they
  render through `formatGhs`. Any `*100` / `/100` at a call site is a bug.
- **Seat holds: hold on select, confirm on payment.** Shown as "held", never
  "booked", until payment lands. Driver renders held vs booked distinctly.
- **Motion: one central system, swapped app-wide.** iOS-native curves; zero
  aesthetic change, feel only.
- **Env: deployed PROD API.** Docker is irrelevant to the reported failures.

## Done
1. **Money 100x (4, 6, 13).** `AnimatedFareText` took `value` and rendered
   `.toFixed(2)` (cedis) while callers passed pesewas. Now takes `pesewas` +
   `formatGhs`; rename forced the compiler through all six call sites. Killed a
   `setInterval` tween (20 setStates/400 ms) for UI-thread `RollingDigits`.
2. **DOB overlap (1).** `Input` floated its label from `handleFocus` only, so a
   date-picker write left the label on the value. Now `focused || hasValue`.
3. **Profile blank (1, 5).** Auth store was a write-once cache seeded at OTP
   time, never reconciled with `/user/me`. Added `mergeUser` + `useProfileSync`;
   `profile/edit` adopts the profile behind a `dirty` ref.
4. **Three "back to Where To" (9, 14, 15).** One line: `hydrate()` resolves the
   active SOLO ride, null for every group booking, and its `catch` made offline
   look identical. `hydrate` now returns `{ trip, ok }`.
5. **Trip request (3) — diagnosable, root cause still unknown.** Three error
   paths collapsed into one message behind a bare `catch {}`. Now logs
   `[RequestStage] trip request failed` with status + body.
6. **Where-To rebuilt (2).** Whole card rewritten under a stated layout
   contract: nothing between the card and the field text takes its size from a
   flex, from `stretch`, or from measurement — that is what collapsed it four
   times. Bigger fields, chevron/search affordances, square destination dot,
   computed swap centring. The dead region below now holds saved-place chips +
   recents (`stores/recentPlaces.store.ts`, AsyncStorage, device-local).
7. **Guest booking + seat holds (10, 12, 16).** Three separate causes:
   - `bookSeat` cancelled holds by `{tripId, userId}`, so confirming your own
     seat cancelled the guest seat you had just held. Now scoped to the
     PASSENGER (guest name/phone, or "no guest attached" for yourself).
   - `payment.tsx` reused `activeBooking` for any booking on the same trip, so
     the second seat never created a booking at all — the rider paid twice
     against one row. Now requires same trip + seat + passenger + still held.
   - The hold-expiry sweep in `server.js` cancelled without nulling
     `seatNumber`, and `@@unique([tripId, seatNumber])` has no status in it — so
     every abandoned checkout permanently burned that seat.
   Driver `SeatMap` gained a distinct `HELD` state (dashed warning rim + pip);
   held seats no longer count toward `passengers` or gross earnings. Rider
   `StatusBadge` + `@eyego/types` BookingStatus completed to match the Prisma
   enum. Guest selection now toasts what happens next.
8. **Motion system (7, 11, 20, 21).** `packages/config/src/motion.ts` rewritten
   from the research doc: Apple-derived springs, nine of eleven at ζ ≥ 0.85,
   overshoot reserved for `accent` only. `packages/ui/src/Motion.tsx` wraps Moti
   so an unspecified transition resolves to `springs.standard` instead of
   Reanimated 3's `damping:10, stiffness:100` (ζ 0.5 → 16.3 % overshoot,
   1.46 s settle) — that default was the whole "bouncy toy" feel. All 41 files
   swapped from `from 'moti'` to `from '@eyego/ui'`.
9. **Join-trip loader (8).** Green orb was three looping `MotiView` rings inside
   a `GradientGlowBorder glow` — four scheduled animations, five composited
   layers, on the screen running dispatch. Replaced by
   `components/trip/SearchingIndicator.tsx`: one shared value, `withRepeat` on
   the UI thread, two rings derived by phase offset, honours reduce-motion.
10. **Performance (17), partial.**
    - `SwipeToConfirm` animated `width` every frame — a layout property, so the
      one control that must track a finger queued a Yoga pass per frame. Now
      a full-width fill on `translateX`. This is the laggy driver swipe.
    - The ambient rotation clock was shared but never stopped: it ran on every
      screen and in the background, rotating a 2.2×-diagonal gradient per ring.
      Now reference-counted and AppState-gated, resuming from its own angle.
11. **Driver earnings ledger (4, rest).** The wallet column is `amountPesewas`;
    the screen read `tx.amount`, which has never existed. Rows formatted
    `undefined` (the reported dash) and — worse — all three chart buckets summed
    `t.amount ?? 0`, so the earnings chart was a flat zero for every period on
    every device. Sign now comes from the signed ledger value, not from a
    type-name list.

## Open
- **Item 3 root cause.** Need the device log line from the next repro.
- **Item 18 (map disjointed).** Not started. Prod API confirmed, Docker ruled
  out, so it is a real client/camera issue — no reproduction detail yet.
- **Perf audit is partial.** Two confirmed offenders fixed; no profiling run.
- Nothing here is device-verified. Nothing is committed.
