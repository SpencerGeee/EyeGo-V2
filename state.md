# State — production readiness run (2026-08-31)

## Where things stand

The previous quality pass is done and pushed (`a4353ca` and below). Nothing is
device-tested.

Thirteen questions resolved the scope; the audit then ran. The contract and all
findings live at:

    docs/superpowers/plans/2026-08-31-production-readiness.md

**Audit complete** — three batches in §3, ranked into 28 items across 7 groups
in §3b. No fixes applied yet. Next action is Group 1.

## The frame, in one paragraph

Ship-safe launch, not Bolt parity. One continuous run — the user sideloads once
at the end, not per phase. Production is a single Docker box with API, Postgres
and Redis colocated. No external accounts exist yet (Apple, Play, Paystack live,
domain, Firebase/APNs, VPS) and the client buys them last, so everything must be
credential-pluggable and documented.

## Next action

Execute §3b Group 1 (safety and correctness), then Groups 2–7 in order.

## What the audit concluded

The codebase is **mature, not half-built**. 286 server routes, 266 client call
sites, and not one client call to a route that does not exist. Money paths hold
under concurrency. Zero TODO markers. The gaps are things that were never
started — mobile money, document expiry, reviewer mode, backups, telemetry —
plus five genuine defects, of which one (A1, swallowed SOS dialer failures) is
the only high-severity find in the app layer.

## ⚠ Before running the harness

`node scripts/e2e/run-all.mjs` **re-seeds** the database. It was purged after
the last run, so the board is clean.

    node scripts/e2e/purge-test-data.mjs            # dry run
    node scripts/e2e/purge-test-data.mjs --confirm

## Verification commands (unchanged)

- `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json`
- `... -p apps/rider/tsconfig.json` · `... -p apps/driver/tsconfig.json`
- `cd apps/admin && next build`
- `node scripts/e2e/run-all.mjs` — needs the API and docker stack up
- `node scripts/invariants.test.mjs`
- **`npx` is broken here — always use the node path above.**

## Facts established today (not in the plan doc)

- `PaymentMethod` is CASH / CARD / WALLET only — no mobile money anywhere.
- Driver documents are a JSON blob on `Driver.documentReview`: status only, no
  expiry dates, no insurance, no roadworthiness, no enforcement.
- Driver app has `lib/sentry.ts` but **no** `ErrorBoundary` component.
- Admin has no Sentry at all.
- Neither `app.json` has `ios.privacyManifests`; `eas.json` `submit.production`
  is empty.
- Rider dials `tel:112`, driver dials `tel:191` — two different emergency
  numbers, neither configurable.
- `apps/admin/lib/api.ts` falls back to an `x-admin-secret` header when
  `EYEGO_ADMIN_LEGACY_SECRET` is set — a full bypass of the JWT path.
- SOS is genuinely end-to-end (events, ack/release/resolve, alerting-health,
  admin device push) — the old "reaches nobody" note is stale.
- Already built, do not rebuild: idempotency, in-app receipts, cancellation
  fees, promotions, support tickets, trip share links, user anonymisation,
  driver deactivation, TOTP MFA + RBAC + audit log on admin.
- Zero TODO/FIXME markers across all four codebases.
- `eyego-api/docker-compose.yml` (pg16) contradicts the root
  `docker-compose.yml` (pg18) — the api one is stale dev leftovers.
