# State — 20-item sweep + global smoothness rollout (2026-08-31)

## Current Goal
All 20 items delivered; smoothness system now applied app-wide to BOTH apps;
driver dispatch offer screen rebuilt. Awaiting device testing.

## ⚠ NOTHING IS COMMITTED
The sideloaded build is `96bbaa6`, which predates every change in this session.
That is why the toast redesign and the "looking for a driver" redesign both
looked missing on device — they are in the working tree, not in the APK.

## Verification (all green)
- `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json` (packages)
- `... -p apps/rider/tsconfig.json`
- `... -p apps/driver/tsconfig.json`
- `node scripts/invariants.test.mjs` — 2/2
- `node --check scripts/e2e/purge-test-data.mjs`
- **`npx` is broken here — always use the node path above.**
- NOT device-tested.

## The smoothness system — now global, not selective
`packages/ui/src/motion/smooth/`

| Piece | Reach |
|---|---|
| `smoothScreenLayout` via `screenLayout` | **every screen**, on both root Stacks and both Tabs — including screens added later |
| `SmoothNavigationProvider` | arms the transition clock from the navigator's own `state` event, so the back gesture, deep links, notification taps and tab presses all count — not just routed helpers |
| …its query half | holds React Query's focus signal until the transition ends, so an arriving screen's refetches commit into a free thread |
| `Entrance` rewritten | **127 call sites / 26 files** — shared values instead of Reanimated layout animations, waits for `settled`, travels 14 pt not a screen-height |
| `StaggerList` / `AnimatedList` | inherit it (both build on `Entrance`) |
| `enableFreeze(true)` + `freezeOnBlur` | both Stacks **and** both Tab navigators |
| `goDeeper`/`goBack` sweep | **239 call sites across 88 files** (147 pushes + 92 backs) |
| `goLateral` | driver manage ⇄ tracking (was a 7-deep stack of live maps) |
| `SmoothDefer` on heavy maps | rider `ride/[id]`, `browse/[group]`, `profile/place-picker`; driver `(tabs)/home`, `(trip)/location-picker` |

Design notes that matter:
- `screenLayout` is **eager** on purpose — a blanket hold would break the morph
  targets (`ride/[id]` expands out of the card the rider tapped). Screens opt
  into holding individually.
- `Entrance` deliberately does NOT gate on `firstAppearance`; only `SmoothIn`
  does. Entrance wraps banners and transient UI that are genuinely new on mount.

## Driver dispatch offer screen (rebuilt)
- Money now sits on **its own tinted panel** with a hairline rim, concentric
  radius (18 inner / 28 outer).
- **The duplicated stats strip is gone.** TO PICKUP / RIDE / FARE were printed
  twice — once in the strip, once in the spine. Each fact now appears once:
  earnings + rate + your-share on the money panel; distances **on the spine's
  connector**, which is what a connector is for.
- Two marker **shapes** (hollow ring = origin, filled square = destination) —
  survives a glance through a windscreen; hue does not.
- Cascade position surfaced: "You are the closest driver" / "Driver 3 of 8 asked".
- Header says how hard the offer is held ("Held for you" vs "Up for grabs ·
  first to accept") instead of "New offer" for everything.
- Sheet scrim was a **hardcoded `rgba(3,12,24,…)`** — a dark smear in light
  mode. Now `colors.backgroundDeep`, passing through the accent at its midpoint.
- Ring 84 → 76; dead `Stat` component removed.

## Open
- Device testing for all of it.
- `apps/rider/components/trip/SearchingIndicator.tsx` is now unreferenced —
  delete once the new `SearchingPanel` survives review.
- Everything needs committing before the next sideload/OTA.
