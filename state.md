# State — EyeGo V2

## Where things stand
Long multi-round session. Everything below is PUSHED to `main` and verified
(both apps `tsc` clean; harness **451/451 across 18/18 suites** against a local stack).

The one thing NOT started is the driver widget work — see the bottom.

## Harness (`node scripts/e2e/run-all.mjs`)
Needs the local stack: `docker compose --env-file .env.docker up -d postgres redis`,
then `node eyego-api/src/server.js` (port 5020). `npx` is broken here — run tsc as
`node node_modules/typescript/lib/tsc.js --noEmit -p apps/<app>/tsconfig.json`.

Three **source-reading** suites were added this session. They need no stack and each
was self-tested against pre-fix files from git before being wired in — a rule that
cannot fail is worthless:
- `conditional-hooks.mjs` — the "rendered more hooks" crash. TypeScript AST.
- `motion-invariants.mjs` — uncancelled infinite loops; per-component device sensors.
- `ux-invariants.mjs` — failure rendered as emptiness; unlabelled icon controls;
  `allowFontScaling={false}`.

## The recurring lesson of this session
**Regex reported the codebase clean three separate times and was wrong every time.**
The AST found each defect in one pass. If a question is about SCOPE — is this hook
before the return, is this loop cancelled, is this `return` the component's or a
callback's — use the TypeScript AST, not a pattern.

## Defect shapes now gated (do not reintroduce)
1. **A hook below a guard** — `useTripStops` sat 115 lines under `if (isLoading || !trip) return`.
2. **A fallback that lied** — failure rendered as "you have no trips" / "that code has expired".
3. **Work that never stops** — `withRepeat(-1)` with no `cancelAnimation`; a sensor
   subscribed per component; a 2s poll writing new object identities into a store.
4. **Balance moved without a ledger row** — see Money below.

## Decisions in force
- Driver trip = **stages on one never-unmounting map** (`components/surface/`).
  `active/[id]` and `tracking/[id]` still exist; the sheet carries the flow, the
  screens carry roster/PIN work.
- Morph springs are armed **on the tap**, before `navigate()`, flying at a
  self-calibrating predicted rect; `targetReady` is a correction. Never re-arm mid-flight.
- **Continuity never degrades by tier** (morph, detents, crossfade, camera).
  Decoration does (shader fps, aurora, blur, shimmer). `reducedMotion` still skips morph.
- Rider: motion/transitions only. **R1 (map unification) deliberately NOT done** — its
  justification evaporated (morph fix + `TripMap` already deferred behind
  `InteractionManager`), and `tripFlow.store` has no open/closed lifecycle, so making
  the surface persistent means inventing one. Plan is in git history if revisited.
- Push urgency: iOS `time-sensitive`; Android MAX channel + high priority.
  **No `USE_FULL_SCREEN_INTENT`** — Android 14 restricts it to calling/alarm apps and
  Play reviews it; asking would risk every release.

## Money — audited this session
Sound: auth perimeter (9 public routes, all legitimately public), Paystack webhook
verifies HMAC-SHA512 with `timingSafeEqual`, `/payments/initiate` is idempotency-guarded,
wallet has a real double-entry ledger.
Fixed: **two cancellation refunds credited `walletBalancePesewas` with no
`WalletTransaction` row** — invisible in the rider's history and `riderWallet.reconcile()`
was off by every refund ever issued. Both now go through `riderWallet.record({ tx })`.
The invariant is stated in `prisma/schema.prisma`: *never write the balance without
writing a row.*

## NOT DONE — driver widgets + live surface (decided, not started)
User-approved plan, stopped deliberately rather than started at low context:
1. **Android first** — Ghana's fleet is Android-dominant, and `@bacons/apple-targets`
   (which the RIDER already uses for `apps/rider/targets/live-activity`) is iOS-only.
2. **Widget** = slow facts only: today's earnings, online/offline, trips, quest progress,
   plus an interactive online toggle. A widget **cannot** show a dispatch offer —
   WidgetKit/Glance refresh on a budget of minutes and a 45s offer would be gone.
3. **Live surface** = the running trip. On Android this is an UPGRADE to the ongoing
   foreground-service notification expo-location already posts ("Trip in progress"),
   not new plumbing. On iOS it is ActivityKit, copying the rider's proven target.
4. Needs: a config plugin writing Kotlin (Glance), manifest receiver, a data bridge from
   RN, and **a native build** — none of it OTA-able, none of it verifiable by tsc or the
   harness.

Also outstanding and small: FlashList for the two chat screens, expo-image for `Avatar`.
