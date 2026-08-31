# State — quality pass complete (2026-08-31)

## Where things stand
All three quality-pass commits are done, verified and **pushed to `main`**.
The database has been purged of harness fixtures. Nothing is device-tested.

    fdfd9e9  perf: 9,495 re-renders removed, and a Trip type that matches the wire
    be456d6  feat: text that can grow, and 199 controls a screen reader can name
    09fcc79  feat: 151 blocking modals become one in-app notice
    885e2c2  chore: keep the design boards and screen captures out of history
    a441895  fix: a toast that was never the toast … (the 20-item sweep)

Plan and the full analysis that produced it:
`docs/superpowers/plans/2026-08-31-quality-pass.md`

## ⚠ Before running the harness again
`node scripts/e2e/run-all.mjs` **re-seeds** the database — 261 riders, 176
drivers, 173 trips last time. It was purged after the final run, so the board is
clean right now. **Sideload and test first; run the harness after.**

    node scripts/e2e/purge-test-data.mjs            # dry run
    node scripts/e2e/purge-test-data.mjs --confirm

## Verification (all green, all re-runnable)
- `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json` (packages)
- `... -p apps/rider/tsconfig.json` · `... -p apps/driver/tsconfig.json`
- `node scripts/e2e/run-all.mjs` → **340/340 · 11/11** against the live backend,
  run after each of the three commits
- `node scripts/invariants.test.mjs` → 2/2
- `node scripts/bench/ride-store-renders.mjs` → the 10,032 → 537 measurement
- **`npx` is broken here — always use the node path above.**

## What changed, and the findings behind it

**Commit 1 — the error surface.** 96 `Alert.alert` calls were two different
things: 36 real decisions (kept) and 151 pure reports (a blocking modal used as
a status line). `notify(title, message, opts?)` is positionally identical to
`Alert.alert`, which is the only reason a 151-site migration finished.
`useNetworkStatus` existed in both apps and the rider's copy had **zero
consumers**; offline now suppresses rather than stacks, reading the real
`offlineQueue` depth. 25 titles saying `"Error"` rewritten.

**Commit 2 — text scaling.** Neither app had *any* font-scaling policy against
142 fixed heights. 1.4 cap on shared `Text`, 60 `TextInput`s capped,
text-bearing heights → `minHeight`. The a11y gap was **41 controls, not 201**:
158 unlabelled Pressables carry visible text and were never silent, only
roleless.

**Commit 3 — perf and types.** 19 whole-store `useRideStore()` subscriptions
woke on every GPS frame (the store holds `driverLocation`). Measured 94.6%
reduction. The shared `Trip` type was **fiction** — it required `driver`/
`vehicle`/`origin` (absent on unassigned trips) and omitted 25 read fields
including `bookings[].seats`, the field behind both seats-vs-rows bugs.
Rebuilt by observation; new `TripBooking` adopted in 15 `(b: any)` reducers.

## Deliberately not done (with reasons, for the re-audit)
- **Zod at the API boundary.** The right long-term answer — parse, don't cast.
  The reconciled types will drift again. Revisit if the server contract moves.
- **The other 23 whole-store subscriptions.** `useAuthStore` changes twice a
  session; converting it is churn dressed as optimisation.
- **Full dynamic type.** Converting all 142 heights would inflate map markers.
- **The ~25 form-validation notices → inline fields**, and ~6 blocking-state
  ones → persistent banner. Queued as a hand pass; the sweep put them all on
  the toast first so nothing was lost.

## Open
- Device testing for everything from this session.
- `apps/rider/components/trip/SearchingIndicator.tsx` is unreferenced — delete
  once `SearchingPanel` survives review.
- Two claims of mine that a re-audit should re-check rather than trust:
  `notifications.tsx` does have an empty state (my detector missed it), and the
  driver store does **not** hold live location (so its 16 whole-store
  subscriptions are harmless).
