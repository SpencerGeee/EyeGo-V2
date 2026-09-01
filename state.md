# State — production-readiness run (2026-09-01)

## Where things stand

**The backlog is closed.** Every item in
`docs/superpowers/plans/2026-08-31-production-readiness.md` §3b is done,
including the four the previous session had to leave open. Nothing is
device-tested; that is the next step and the only thing left.

    415c1e7  fix: the other half of the price lock — a trip pins its fees too
    470ff04  test: the release surfaces, and the schema that would have refused every fare
    dd0ba9f  feat: the driver's statement, the platform's receivable, and errors that leave the console
    bf324bb  feat: zod at the API boundary, and the suite that was asserting nothing

## What was open, and what closed it

| Item | Outcome |
|---|---|
| **24 — Zod at the boundary** | Done. `packages/api/src/schemas.ts` is the boundary; `money-guards.ts` is now a façade over it with the same names, error type and messages. The blocker recorded last session — "zod is not installed" — was not true: zod 4 resolves from the workspace root and is now declared in `packages/api/package.json`. |
| **11 — Sentry in admin** | Done, on `@sentry/node` rather than `@sentry/nextjs`. The latter rewrites the webpack build, which is exactly why it was deferred; `@sentry/node` was already in the tree. Client errors POST to `/api/client-error` so the DSN never enters the browser bundle. `next build` verified green. |
| **14 — Driver earnings statement** | Done. The screen now reads `GET /driver/earnings/breakdown` instead of re-deriving totals from one page of transactions. Admin half done too: unrecovered commission is aggregated on the revenue page instead of telling the operator to add up driver wallets by hand. |
| **23 — E2E for the new work** | Done. `scripts/e2e/release-surfaces.mjs`, 28 checks: release gate, consent, receipts, SOS, payments, documents, reviewer mode, admin door. Registered in `run-all.mjs`. |
| **E2 — stored quotes did not pin fees** | Done, properly. Two nullable columns on `Trip`, a `pinnedRatesFor(trip)` helper applied at all 13 call sites, migration `20260901110000_trip_fee_price_lock`. The `test.todo` is now four passing tests. |
| **E4 — 7 failing jest suites** | Done. 12 failures were stale fixtures, not product bugs — cedis amounts naming columns the services stopped writing, `status not CANCELLED` where `seatOccupyingWhere()` belongs, a mock client missing the models a transaction now touches. |

## Verification, as it actually stands

    tsc --noEmit    packages · rider · driver · admin      GREEN
    prisma validate                                        GREEN
    prisma migrate deploy                                  APPLIED (17 total)
    prisma generate                                        DONE
    jest                                                   139 passing, 0 failing, 0 todo
    scripts/e2e/run-all.mjs                                368/368 · 12/12 suites
    apps/admin  next build                                 GREEN, every route renders
    purge-test-data.mjs (dry run)                          database clean

## Three things found by running it that static review had passed

1. **The zod schema would have refused every fare.** It constrained breakdown
   values to `number | boolean`; `doorstepDetourKm` is `null` on any ride
   without a detour and `typeof null === 'object'`. No rider could have seen a
   price. Caught by the new e2e suite within minutes of it existing.
2. **`getMe` never selected the driver's consent columns.** `acceptTerms`
   wrote four fields and nothing read them back, so the app could not tell
   whether to re-prompt — it would either nag someone who had agreed or, worse,
   never prompt after a terms update and record consent to a document the
   driver was never shown.
3. **`confirmPayment` summed sibling fares with no guard.** One null row made
   the total `NaN`, and `walletBalancePesewas: { gte: NaN }` matches nothing —
   a cover-all host with a full wallet was told "insufficient balance" with no
   way to find out why.

## The live stack

Postgres and Redis are up in docker; the API runs on **:5020**, started
detached. Restart it the normal way when convenient:

    cd eyego-api && npm run dev

`npx` is broken here — use `node node_modules/typescript/lib/tsc.js` and
`node node_modules/prisma/build/index.js`.

`npm install` still fails on this machine (`Cannot read properties of null
(reading 'location')`) — the tree is inconsistent with the lockfile after the
manual react-dom repair. A clean `npm ci`, which the Docker build does, works.
Nothing added this session needed an install: both zod and `@sentry/node`
already resolved from the workspace root and are now declared.

## ⚠ Before running the harness

`node scripts/e2e/run-all.mjs` **re-seeds** the database. Purge afterwards:

    node scripts/e2e/purge-test-data.mjs --confirm

A suite must never leave a driver online. There is ONE shared Redis supply
index across suites, so a leftover online driver is offered every later suite's
ride — `release-surfaces.mjs` failed two other suites exactly this way before
it was fixed.

## Facts worth carrying forward

- **Mobile money was already built, both directions.** Cancelled, not deferred.
- The driver app already had an `ErrorBoundary`, inline in `_layout.tsx`.
- `Driver` is NOT a `User` row: own `phone`/`name`, no `userId`.
  `req.user.userId` on a driver token IS the `Driver.id`.
- `Trip` uses `requesterId`, not `riderId`. `Booking` uses `fareAmountPesewas`.
- Fare composition: `farePerPerson = ride + bookingFee + platformFee`, and
  `commission + driverEarnings = ride`. No commission on the fees.
- Cash bookings are `paymentStatus: 'PENDING'` — there is no `CASH_PENDING`.
- `dailyBreakdown` rows are `{ date, earnings, trips }`, never `amountPesewas`.
- The go-live pack is at `docs/go-live/` — ten documents, legal ones DRAFT.

## Still not done

- **Nothing is device-tested.** Sideload is the next step.
- Sourcemap upload for the admin console. `@sentry/node` does not do it; a
  `sentry-cli sourcemaps upload` step against the same `SENTRY_RELEASE` is
  written up in `docs/go-live/01-credentials-checklist.md`.
- `concurrency.real.test.js` is skipped — it needs a live DB and its own run.
