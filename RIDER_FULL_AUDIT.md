# EyeGo V2 — Rider-Centred Full Audit
_2026-08-20 · branch `main` · commits `fcc52ef`, `2346670`_

This audit is **independent of `PRODUCTION_READINESS_AUDIT.md`**. That one was
100% static and said so in its own first paragraph. This one leads with the
thing it could not do: **boot the stack and drive the real endpoints and
sockets.** Static reading was used only where runtime cannot reach — store
config, native modules, UI layout, animation.

**Twelve defects found, all fixed.** Eight of them are invisible to static
analysis: the code is correctly wired, type-checks clean, and does the wrong
thing when a real request goes through it. Two were P0s on the primary product.

---

## THE HARNESS

`scripts/e2e/` is the durable output of this audit and the reason it found what
it found. It is not a mock — it points at a running `eyego-api` with real
Postgres and real Redis and plays whole journeys through it.

| File | What it does |
|---|---|
| `lib.mjs` | HTTP + socket.io client, actor factories (rider / driver / vehicle / ACTIVE), a frame recorder, `until()` |
| `rider-happy-path.mjs` | 35 checks: signup → quote → book → dispatch → offer → accept → the whole status rail → rate → receipt, asserting both sides at every step |
| `rider-edges.mjs` | 30 checks: cancellation and its fee, chat both ways, SOS, disputes, scheduling, the wallet ledger, settings persistence, account deletion |
| `reset-pool.mjs` | Drains a local dispatch pool left dirty by earlier runs |

```
node scripts/e2e/reset-pool.mjs
node scripts/e2e/rider-happy-path.mjs     # 35/35
node scripts/e2e/rider-edges.mjs          # 30/30
```

The recorder matters more than the request count. Almost no socket bug here is
"no frame arrived" — it is "the frame arrived with `seq: null`", or "it carried a
relation-less trip", or "it still had the driver's phone on it after the ride
ended". None of those is visible unless you keep the frames and inspect them.

---

## FINDINGS

### 🔴 P0 — broken on the primary product

**R1. `GET /v1/trips/:id` returned 500 for every on-demand ride.**
`trips.service.getTrip` read `trip.route.distanceKm` unconditionally, and
`rides.service.requestRide` creates the trip with `routeId: null` — that is the
defining shape of the on-demand product ("no driver, no vehicle, no route"). So
the endpoint threw `Cannot read properties of null` on the main product, every
time. Two rider screens call it: **`ride/[id]/chat.tsx`**, so rider↔driver chat
could not open on a normal ride at all, and Activity's tap-through to
`/ride/[id]`, which showed "Trip not found" for every past hailed ride.
**Fixed:** routeless trips read their price off the booking that recorded it.
Deliberately not recomputed — no distance was ever stored on the `Trip` (only in
the seq-0 `TripEvent` payload), and a fare re-derived from a straight line would
quietly disagree with the signed quote the rider was charged. The per-passenger
fare is stripped from the payload again so no new disclosure ships with it.

**R2. Cancelling a hailed ride charged 100% of the fare.**
`CancellationPolicy` measures the fee from `Trip.departureTime`: free up to an
hour before, half after, 100% once it has passed. Correct for a bus that leaves
at 07:30. An on-demand ride is created with `departureTime: new Date()`, so
`minutesUntilDeparture` is ≤ 0 from the first second and **every hailed
cancellation was a no-show at 100%**. Measured on a real booking: a rider who
cancelled one second after a driver accepted was quoted, and charged, GH₵27.02
of a GH₵27.02 fare.
**Fixed:** hailed rides measure from `assignedAt` instead, with a free window and
a flat fee capped at the fare, both in the settings registry (`RIDE_CANCEL_
GRACE_SECONDS` = 120 s, `RIDE_CANCEL_FEE_PESEWAS` = GH₵5) so the console can
retune them. The bus product is untouched. The quote and the charge had each
written the policy out separately; they now share one derivation.

**R3. Cancelling through `/cancellation/:id/cancel` left the trip running.**
It asked only "should a part-full bus go back on sale?", and answered it for
`FILLING`/`CONFIRMED`. A hailed ride is never in either, so the *booking* went to
CANCELLED and the *trip* stayed at `DRIVER_ASSIGNED`. Downstream, everything
believed a ride was still running with no passenger on it: the driver kept it on
screen and drove to the pickup, `isDriverAvailable` counted them busy so dispatch
skipped them, and the rider could not book anything else — `POST /rides` answered
"You already have a ride in progress" for a ride they had just cancelled and paid
a fee on. This is the cancel path the Assigned stage uses, so it is the ordinary
one.
**Fixed**, through the state machine so both apps are told, plus the offer chain
is stopped so no later driver is woken for a dead trip.

### 🟡 P1 — correctness

**R4. Cancelling during dispatch failed with "Trip … was modified concurrently".**
`applyTransition`'s compare-and-swap lost the race against the cascade bumping
the version (`REQUESTED → MATCHING`, then a `DISPATCH_PROGRESS` per candidate).
`RequestStage.tsx` — the *finding-you-a-driver* screen, i.e. exactly when the
cascade is churning — raised "Could not cancel" over the database's own wording,
and the ride carried on.
**Fixed:** a caller that passes no `expectedVersion` is not asserting anything
about the version, so a lost swap re-reads and retries. The retry re-runs
`assertTransition` against the *new* status, so two drivers accepting still
resolve to exactly one winner — the loser now gets `ILLEGAL_TRANSITION`, which is
what actually happened, instead of a storage detail. `cancelRide` is also
idempotent now: a double-tapped Cancel returns success rather than
`TRIP_ALREADY_IN_STATE`.

**R5. The cancel sheet could never show a fee.**
`cancellationApi.getFee` was typed `{ fee, reason, eligible }` — three fields the
server has never sent — and returned the un-unwrapped axios response, while the
server nests the terms under `data.cancellationFeePesewas`. Three mistakes
compounding: `cancellationFeePesewas ?? 0` was always 0, `eligible ?? false`
always false, so the sheet showed the vague "cancelling … may incur a
cancellation fee" line **including when the rider was one tap from being charged
a real one**. The post-cancel alert had the same bug and never named the fee
either.
**Fixed** in `packages/api` with the real shape, and the sheet now states what it
will cost, over how many seats, and why.

**R6. Tipping had never worked.**
Three names for one number: the client sends `amountPesewas`, the controller read
`amount`, the service destructured `amountPesewas`. Every tip reached
`assertPesewas` as `NaN`. The `parseFloat` alongside it was the same mistake
twice — it treats the value as *cedis*, while every column and guard downstream
is integer pesewas. Past that, it passed the **ride's** payment method into a
mobile-money charge, so a cash ride — the common case in this market — died on
`Unsupported MoMo method: CASH`.
**Fixed:** one name, one unit, no coercion; and a tip charges a MoMo network,
inheriting one from the ride only when the ride was itself paid by MoMo.

**R7. `Trip.tier` was written as a UI id, and the tier filter went quiet.**
`trips.service.createTrip` wrote `data.tier` through untouched, defaulting to
`'ECONOMY'` — the id the apps' tier pickers use (`packages/ui/tierTheme.ts`), not
the value this system stores. Every `Vehicle.tier` is a wire value
(ECO/COMFORT/PREMIUM), so `matcher.service`'s
`d.vehicles.some(v => v.tier === tier)` matched **no car at all** for those trips
and fell through to its "any car rather than no ride" fallback. The tier filter
was silently inert for the whole driver-created product, and nothing said so.
`CancellationPolicy` lookups by tier missed for the same reason. Pricing survived
only because `calculateFare` normalises on the way in.
**Fixed** on write *and* on read, so rows already in the database behave too.

### 🔵 P2 — smaller, still real

**R8. The public share/track page had no origin or destination on a hailed ride.**
`public/tracking/index.html` reads only `data.route.*` — the header, both address
rows, the pickup and destination pins, and the map's own bounds all come from it.
A rider who shared the ride they were actually on sent their contact a page with
a blank header and no pins. **Fixed** by synthesising the route view from the
trip's own pickup/dropoff, so the ended-trip branch keeps its names-only privacy
rule for free.

**R9. A degenerate `fitBounds` — the known SIGABRT — was unguarded.**
`ride/[id].tsx` guarded null coordinates but not two identical corners, which is
reachable whenever pickup and destination resolve to the same point. That aborts
inside `MLRNCamera`, and the stack always blames `_setInitialCamera`, which is
why it reads as an init bug rather than an input one. **Fixed:** centres on the
single point instead.

**R10. Client amount errors were 500s.** `assertPesewas` threw a bare `Error`, so
a fractional (cedis) amount answered "An unexpected error occurred" and logged at
error level — the one guard built to say "your app is still sending cedis" was
the one that could not say it. **Fixed:** 400/`INVALID_AMOUNT` at the six call
sites that read a request body; server-invariant sites still 500, correctly.

**R11. Every gateway failure looked like a server crash.** A decline, an expired
key and a Paystack outage all reached the rider as "An unexpected error occurred.
Please try again." **Fixed** at the provider seam — the one module allowed to
know the gateway's name — as 402 (refused) or 502 (unreachable), preserving the
gateway's own message, so "Insufficient funds" reaches the person who needs it.

**R12. Three screens broke the `Pressable` invariant.** `profile/help.tsx`,
`profile/promotions.tsx` (rider) and `(profile)/help.tsx` (driver) imported
`Pressable` from `react-native` **while using the `({ pressed }) => style`
function form** — the exact shape NativeWind's css-interop drops, and NativeWind
4.2.3 is installed in both apps, so the press state silently stopped rendering.
**Fixed.** The other 51 `react-native` Pressable imports pass a plain style
object and are unaffected — worth stating, because a blanket ban would be noise.

---

## COVERAGE

### Runtime (65 checks, all green)
Auth · `/user/me` envelope · refresh · quote determinism and tier monotonicity ·
single-use quotes · `POST /rides` latency (must not run the cascade inline) ·
socket offer delivery · REST offer fallback · dispatch progress · accept · the
whole status rail · **seq contiguity and gap-freedom across every lifecycle
frame** · event replay · driver-phone gating on terminal statuses · no credential
on any frame · history · active-ride clearing · rating · receipt `fareBreakdown` ·
driver release · earnings · IDOR (a stranger 404s on the trip; a second rider
cannot dispute someone else's booking) · cancellation at both stages with
quoted-equals-charged · chat both directions plus history replay · SOS ·
emergency contacts · safety / privacy / notification settings persistence ·
wallet balance, overdraw refusal, fractional-amount refusal, ledger · scheduling
create/list/cancel · saved places · `/config/public` · account deletion, token
revocation, and phone reuse.

### Static (where runtime cannot reach)
- **Contract**: 276 server routes enumerated from the live router and diffed
  against 178 client call sites. No client method points at a route that does not
  exist. Envelope conventions audited across all 16 `packages/api` modules —
  `cancellationApi` was the only genuine mismatch (R5). `userApi`'s `unwrapUser`
  rewrites in place and its five call sites are correct.
- **Money**: one conversion boundary (`pesewasFromCedis`, in `send-money.tsx`),
  every column `…Pesewas`, no stray cedis path found.
- **Status strings**: 15 canonical statuses; every status-shaped literal outside
  that set is an error code, a push type or a settings key — including
  `DRIVER_ARRIVED` (a push type, handled alongside `ARRIVED_AT_PICKUP`) and
  `MATCHED` (a `ScheduledRideIntent` status, a different enum used consistently).
- **Typecheck**: rider and driver `tsc --noEmit` clean; all 126 backend modules
  load.

### Not covered
**Nothing here was run on a phone.** The harness proves the server behaves; it
cannot prove the app feels right in the hand, and animation is the category a
simulator hides best. A device pass on a real low-end Android is still yours.

---

## ON THE ANIMATION BRIEF

**The diagnosis is wrong, because it was written from your documents rather than
your code.** Its highest-leverage move — Task 1, "extract the container-transform
morph into a reusable primitive in `packages/ui`" — describes work that is
already done and has been for some time:

- `packages/ui/src/morph/` — `MorphProvider` (800 lines), `MorphSource`,
  `MorphTarget`, `MorphBackSwipeDetector`. 1,165 lines, used by both apps.
- `packages/ui/src/panel/` — `MorphSheet`, `PanelSheet`, `InlayPanel`,
  `usePanelMotion` (with real velocity hand-off out of `Gesture.Pan()`).
- `packages/config/src/motion.ts` — eight named springs, every one ζ = 1.00 and
  annotated with its response time and overshoot. Bounce is allowed in exactly
  one token (`accent`) and the comment says why.
- `packages/ui/src/usePressScale.ts` — one press animation for every touchable in
  both apps, written specifically to kill the hand-rolled ones. Its own doc
  comment tabulates the four screens whose ζ ≈ 0.25 springs produced the "blob".
- `packages/ui/src/motion/layoutTransitions.ts` — reflow driven by the same
  springs as the sheet edge, so a row appearing and the sheet growing to fit it
  are one motion.

The brief is right about the *principles* — interruptible springs, one continuous
surface, orchestrated reveal, animated elevation, everything on the UI thread —
and that is precisely why it lands as a no-op: this codebase already holds them,
with more rigour than the brief asks for. Implementing it as written would mean
re-extracting a primitive that exists, and a large diff over working code.

**So I audited the motion stack against its own principles instead, and fixed
what was actually violating them** — three of them, listed above as R9 and R12,
plus the rider tab bar:

> It was the last hand-rolled press animation in either app: a 100 ms ease down
> and a 150 ms `Easing.back(1.5)` up. `back` overshoots *by design* — it is the
> inflating "blob" press `usePressScale` was written to remove, and that file's
> doc comment names the tab bar as one of the offenders it replaced. It had been
> moved off a bad spring onto a bad timing rather than onto the token. Its focus
> transition drove a **scale** off a 150 ms timing too, so drumming across the
> bar restarted an un-interruptible ease on every tap. Both now use
> `springs.press` and `springs.micro`. **The driver's tab bar already did this
> correctly** — the rider's was the sole outlier.

Everything else the sweep flagged is correct as it stands: the remaining
`withTiming` calls are on opacity-only crossfades (`MorphProvider`'s clone fade,
`MorphCTA`'s label swap) and on a deliberately-timed OTP shake — none is a
position, size or radius the eye tracks. Camera padding is never driven from a
shared value. There is no second Skia canvas fighting `LightPillar`.

One point in the brief is worth keeping regardless of the rest: **the stage-to-
stage transitions inside `trip.tsx` are the ones competitors nail hardest**, and
the tier-select → finding-a-driver collapse is genuinely the most-copied
transition in the category. That is a product decision with a real cost, not a
bug, so I have not opened it — but if you want one motion investment, that is the
one I would make, and the primitive to build it on already exists.

---

## STILL EXTERNAL (unchanged from the previous audit)

Nothing below is code. Paystack live keys · Apple Developer account and APNs key
· Google Play records and the Data Safety form · an **https** API origin ·
`prisma migrate deploy` · `ADMIN_LEGACY_SECRET` left unset · the first `AdminUser`
seeded · **API and database colocated** (still the single largest performance
lever: Frankfurt at ~280 ms/query).

Two additions from this pass:

- `RIDE_CANCEL_GRACE_SECONDS` and `RIDE_CANCEL_FEE_PESEWAS` are new settings with
  defaults of 120 s and GH₵5. Those are my numbers, not yours — set them in the
  console before launch.
- **Run a real rider→driver→completion loop on hardware against staging.** R1 is
  the shape of defect only tracing finds; its converse — something that compiles,
  wires up, passes 65 runtime checks and still behaves wrong in the hand — is the
  shape only a phone finds.
