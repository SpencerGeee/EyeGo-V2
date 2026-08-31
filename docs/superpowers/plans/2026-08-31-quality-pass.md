# Rider + Driver quality pass

Agreed 2026-08-31 by interview. The harness proves the apps *work*; this is the
pass that makes them feel finished. Three commits, harness run between each.

## The split (settled first, everything forks on it)

User-visible quality first, plus **one** foundation debt paid alongside it.

The recurring bug shape in this repo is *a wrong assumption about a payload
shape* — seats-vs-rows twice in one day, `paddingTop` vs `top`,
`place_formatted`. That is an `any` problem, not a polish problem, and it will
keep costing. So: ship the visible pass, and type only the payloads carrying
**money, seats and trip status** — ~15% of the `any`s, ~90% of the bug class.

---

## What the analysis actually found

Numbers are from the working tree at `885e2c2`.

| | Rider | Driver |
|---|---|---|
| LOC / files | 43,916 / 120 | 28,540 / ~90 |
| `any` per 100 LOC | 0.97 | **3.01** |
| `Alert.alert` — real decisions | 22 | 19 |
| `Alert.alert` — **pure error reports** | **74** | **69** |
| …titled literally `"Error"` | 9 | 13 |
| Pressables labelled | 112 | 22 |
| …unlabelled **but with visible text** | 63 | 75 |
| …unlabelled **icon-only** (genuinely silent) | **27** | **14** |
| `expo-image` adoption | 3 of 18 sites | **0** |
| Whole-store zustand subscriptions | 42 | 16 |

### Four findings that reframed the work

1. **The 96 alerts are two different things.** 41 across both apps are real
   two-way doors ("Depart with empty seats?") and *should* block. 143 are a
   blocking OS modal used as a status line.

2. **`useNetworkStatus.ts` exists in both apps and the rider's copy has zero
   consumers.** Built, never wired. `offlineQueue` has 5 callers per app, so
   writes are queued — the rider is simply never told.

3. **`packages/types` already holds 570 lines of good types, and the apps import
   from it 7 times (rider) / 2 (driver).** Not a missing-types problem — an
   adoption problem. And the reason for non-adoption is that `Trip` has drifted
   from the wire in BOTH directions: it requires `driver`/`vehicle`/`origin`
   (absent on an unassigned trip or a search payload) and omits
   `dropoffAddress`, `pickupLat`, `isOnDemand` and — critically —
   **`bookings[].seats`**, the field behind both seats-vs-rows bugs. Annotating
   against it today produces a wall of errors on correct code, so `as any` wins.

4. **The a11y gap is 41 controls, not 201.** The 138 unlabelled-with-text
   controls announce their `<Text>` child; they are imperfect, not silent.

### One suspicion that was wrong, recorded so nobody re-checks it
The driver store does **not** carry live location (that is local `useState` in
`useDriverLocation`). Its 16 whole-store subscriptions are harmless. The driver
has no equivalent of the rider's booking-flow re-render problem.

---

## Commit 1 — error surface & offline

**`notify(title, message, opts?)`**, positionally identical to
`Alert.alert(title, message)` so all 143 sites convert by script in one pass.
Routes to `GlobalToast` (rider) / `DriverToast` (driver) — both already exist
and are correct; they are starved of callers. `opts.persist` for the handful
that must stay up.

The 41 real decisions keep `Alert.alert`. They are correct as they are.

**Offline-aware by design.** `notify()` checks network first; when offline it
**suppresses** the individual error and raises one persistent banner instead:

> **You're offline** — 3 actions will send when you're back.

Reads `offlineQueue` depth so the count is real. Needs a recovery beat when the
queue drains ("Back online, 3 actions sent") or the rider never learns their
cancel went through.

The banner lives in `packages/ui` and mounts at both root layouts. The driver's
current offline surface is inlined in `(tabs)/home.tsx`, so it only exists on
one screen of one app — go offline on Earnings today and nothing tells you.
**That inline pill is deleted.**

**Write real copy for all 22 `"Error"` titles.** A title that says "Error" tells
the user the category of event they had already worked out.

Deferred to a later hand pass, not this commit:
- ~25 form-validation reports → inline, on the offending field
- ~6 blocking-state reports ("Documents required") → persistent banner

## Commit 2 — text scaling & accessibility

**No font-scaling policy exists in either app** — no `allowFontScaling`, no
`maxFontSizeMultiplier` — against 142 hardcoded fixed heights in rider alone.
A rider with large text set gets unbounded text inside containers that do not
move. The harness cannot see this; nor can a dev on default settings.

- **A:** `maxFontSizeMultiplier: 1.4` on the shared `Text`. 1.4 is where a
  two-line fare card becomes three and stays inside its container. Below 1.3
  overrides the user's setting rudely; above 1.5 clips again.
- **B:** `height` → `minHeight` on the ~20 primitives that *contain text* —
  buttons, rows, chips, tab bar, sheet headers. The other ~120 fixed heights are
  icons, dots, map pins, avatars and rails; those should stay fixed and would
  look wrong growing with the font. Converting all 142 indiscriminately would
  inflate map markers and spend a week making the app worse in places.
- **41 icon-only labels, by hand.** A chevron on a trip card means "Open your
  ride to East Legon", not "chevron".
- **138 × `accessibilityRole="button"`, by script.** Identical string every
  time; split by what actually requires a human.

Store-review angle: Apple has rejected apps for text clipping at accessibility
sizes, and a reviewer with large text hits it on the first screen.

## Commit 3 — performance, types & states

- **19 `useRideStore()` whole-store subscriptions → selectors.** Those 19
  components re-render on *any* ride-store change: origin, destination, tier,
  seats, doorstep, coverAll, guest info — i.e. on every keystroke and every
  stepper tap during booking. The smoothness system does not fix this: it moves
  work out of the transition window, it does not reduce how much there is.
  **Leave the other 23 alone** — `useAuthStore` changes twice a session,
  `useThemeStore` on toggle. Converting them is churn wearing the costume of an
  optimisation.
  Multi-field destructures need `useShallow`, or a re-render problem becomes an
  infinite-loop problem — so these are by hand, not by script.
- **Measure it.** Render counter on the booking flow, before and after, thrown
  away afterwards. Without it "this made it faster" is asserted, not shown.
- **Reconcile `Trip`/`Booking` by observation.** Enumerate every property access
  on trip/booking objects across both apps; the type is the union of what is
  actually read, optional wherever readers use `??` or `?.`. A type that
  documents reality rather than intention. Adopt in the ~8 files where money,
  seats and status flow (`home` 33, `activity` 26, `complete` 24, `payment` 18
  `any`s — 101 of the rider's 426 live in four files).
- **Unify 23 bespoke empty states** onto the shared component; fill the one
  genuine hole, `notifications.tsx`.

---

## Explicitly NOT doing, and why

- **Zod at the API boundary.** The right long-term answer to finding 3 — parse,
  don't cast, so a mismatch is a real error at the seam instead of `undefined`
  three layers down. Scoped to the ~8 money endpoints it is worth doing. It is
  a week, and the reconciled types cover the agreed bug class now. **Revisit if
  the server contract keeps moving** — this plan's option A will drift again.
- **Generating types from Prisma.** The API returns envelopes with computed
  fields (`sold`, `seats.available`) and scrubbed secrets, not Prisma models.
  Generated types would not match the wire either.
- **Converting the other 23 whole-store subscriptions.** See above.
- **Full dynamic type.** See commit 2.

## Verification

Harness between each commit, not once at the end. Three commits rather than one
400-file change, because items 1, 3 and 5 each touch 100+ sites and "which of
seven passes did it" is an expensive question to answer after the fact.

Run: `node scripts/e2e/run-all.mjs`, plus all three
`node node_modules/typescript/lib/tsc.js --noEmit -p …` (`npx` is broken here).
