# Production Readiness — agreed scope

_Agreed 2026-08-31 via a 13-question grill. This document is the contract.
Audit findings get appended to §3 once the audit runs; nothing in §1–2 is
re-openable without saying so._

---

## 1. The frame

**Definition of done: ship-safe launch.** Pass App Store + Play review, and
survive real money and real riders in Accra without a safety or financial
incident. NOT feature-parity with Bolt. Surge, pooling, multi-city and driver
heatmaps are explicitly out.

**Sequencing:** one continuous run. No phase gates for testing — the user
sideloads once, at the end, when everything is done. Internal phasing exists
only so each landing is independently verifiable.

**Externals do not exist yet and will be bought last.** No Apple account, no
Play account, no Paystack live keys, no domain, no Firebase/APNs, no VPS.
Everything therefore has to be *credential-pluggable*: env-driven, documented,
and inert-but-not-broken when a key is absent. The client's final step must be
paste-and-pay, not research.

---

## 2. Decisions

### 2.1 Topology — settled

Production is **one box running Docker**: API, Postgres and Redis colocated.
That closes the 281 ms/query, 1557 ms/transaction gap measured against Neon in
Frankfurt (`docs/DEPLOYMENT_TOPOLOGY.md`); loopback is ~0.1 ms. The root
`docker-compose.yml` is already the production shape — loopback-only port
binds, `appendonly` + `noeviction` Redis, pg18 pinned to match the source.

Resilience is **offsite backups plus a proven restore**, not HA:

- pgBackRest or wal-g → S3/B2/R2, encrypted, 30-day retention
- nightly full + 5-minute WAL archive → RPO ≈ 5 min
- `scripts/restore-drill.sh` restores into a throwaway container and runs
  `invariants.test.mjs` against it; scheduled monthly in CI
- Redis AOF snapshotted to the same bucket
- Caddy/nginx TLS + HSTS in front of the API
- alerts on disk >80%, memory, container restart, `/health` failure
- documented RTO ≈ 30 minutes, rebuild from image + backup

Also: move `prisma migrate deploy` **out** of the container start command. It
races the moment there is more than one replica.

### 2.2 Admin console — settled

Runs **in Docker on the same box**, behind the same reverse proxy on
`admin.eyego.app`, reaching the API over `127.0.0.1`. The API call never leaves
the machine.

Hardening that ships with it:

- refuse boot when `EYEGO_ADMIN_LEGACY_SECRET` is set and `NODE_ENV=production`
  — that header is a full bypass of the JWT path
- MFA required for FINANCE and SUPERADMIN (TOTP already modelled)
- login rate-limit + lockout
- built and served from a production `next build`, never dev

### 2.3 Android background location — settled

**Drop `ACCESS_BACKGROUND_LOCATION`.** Use a foreground service with a
persistent "on trip" notification instead. Location survives screen-off and
backgrounding, which is the actual requirement; what is lost is tracking after
the user sweeps the app away, which is acceptable.

This removes the Play background-location declaration, the demo video, and the
review rounds that most often stall a driver app.

- add `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`
- configure `expo-location` foreground service
- iOS keeps `UIBackgroundModes: [location]` — Apple is fine with it

### 2.4 Observability — settled

**Server-side events into our own table, read by the admin console.** No
third-party analytics SDK: nothing to declare on the Play Data Safety form or
Apple's privacy labels, no SDK weight, no event upload on metered Ghanaian data.

- crash: port the rider's `ErrorBoundary` into driver (it has none — a render
  throw is currently a white screen), add Sentry to admin, tag release/dist,
  upload sourcemaps from EAS
- product: `ride_requested / matched / accepted / cancelled / completed` with
  reason codes and timings → request-to-match rate, p50 pickup ETA vs actual,
  driver acceptance rate, cancel-by-whom
- ops: `/metrics` via prom-client, small Grafana on the box, alerts on match
  rate drop, dispatch queue depth, 5xx rate

### 2.5 Money — settled

**Mobile money, both directions.** `PaymentMethod` is currently CASH, CARD,
WALLET. In Ghana MoMo is the dominant rail; without it most riders can only pay
cash and no driver can be paid without a manual transfer.

Pay-in: `MOMO` method + network enum, Paystack charge → pending → OTP/USSD →
webhook. Asynchronous — the trip must never block on a charge settling. A
reconciliation job sweeps stuck pendings.

Payout: Paystack transfer recipient per driver (network + MSISDN), withdrawal →
transfer → webhook → ledger entry, with a balance hold so two withdrawals
cannot overdraw.

Built and tested against Paystack **test** keys; live keys are a later paste.

### 2.6 Scope additions — all accepted

| # | Item | Why it is ship-safe, not polish |
|---|---|---|
| 1 | Driver document expiry + enforcement | `documentReview` is a JSON blob with a status and no dates. No insurance, no roadworthiness, no expiry, no gate. An uninsured driver on the platform is the operator's liability. Real `DriverDocument` rows, expiry, 30/7-day warnings, and a hard block at go-online. |
| 2 | Force-upgrade + kill switch | A bad native build in a store is otherwise unrecoverable for days. `minSupportedVersion` per app+platform and `maintenanceMode` on the existing `/v1/config/public`; 426 on stale clients for write routes. |
| 3 | Fraud & abuse basics | Mock-location detection, self-ride refusal, cancel-abuse cooldowns, payout hold flag, impossible-jump velocity check. Cheap now, expensive after a ring finds you. |
| 4 | Lost & found | Rides on the existing ticket system and `CONTACT_RELAY_NUMBER`. |
| 5 | **Reviewer / demo mode** | The single most common ride-hailing rejection: the reviewer is in Cupertino, there are no drivers there, so they cannot complete a booking. A flagged account whose dispatch is satisfied by a scripted synthetic driver on a canned polyline, with payment forced to sandbox. Both apps. |
| 6 | Terms + privacy acceptance record | Version-stamped at signup, re-prompted on bump. Both stores expect the links; disputes and the DPC expect the record. |
| 7 | Trip receipts by email/SMS | Receipts are in-app only today. A sent, timestamped artifact is what makes a dispute tractable. Africa's Talking is already wired for SMS. |
| 8 | Driver earnings statement + payout ledger | Immutable ledger for every money movement; daily/weekly driver statement; admin reconciliation of cash-collected vs commission owed. Drivers not trusting the numbers is the fastest way to lose supply. |

### 2.7 Go-live pack — drafted in repo, marked for review

    docs/go-live/
      01-credentials-checklist.md   what to buy → which env var
      02-privacy-policy.md          DRAFT — needs Ghanaian counsel
      03-terms-of-service.md        DRAFT — needs Ghanaian counsel
      04-play-data-safety.md        every answer pre-filled
      05-apple-privacy-labels.md    nutrition-label answers
      06-app-review-notes.md        reviewer credentials + demo script
      07-store-listing.md           copy, keywords, categories
      08-screenshots.md             required sizes + shot list
      09-deploy-runbook.md          bare VPS → live, step by step
      10-ghana-compliance.md        Data Protection Commission registration,
                                    ride-hailing licensing, insurance

Plus, in the apps: `ios.privacyManifests` in both `app.json`s, a populated
`eas.json` `submit.production`, and one configurable emergency number — the
rider currently dials `tel:112` while the driver dials `tel:191`.

---

## 3. Audit — method, then findings

**In progress.** Findings append here as each layer completes.

### Batch 1 — route layer (complete)

Built a full route table from the express files and cross-referenced it against
every path `packages/api` and the admin console ask for. **286 server routes,
266 client call sites.**

Method note worth keeping: the repo is mixed CRLF/LF, and JS `.` does not match
`\r`, so a naive `(.*)$` line scan silently drops every CRLF file — 16 of 20
route files. Any future tooling over this repo must strip `\r` first. Route and
API-wrapper calls also routinely put the path on the line *after* the call, so
per-line scanning under-reports by roughly a third.

**Verdict: the route layer is in good shape.** No client calls a route that
does not exist. The findings are dead code and one authorisation gap.

| id | severity | finding |
|----|----------|---------|
| R1 | medium | `POST /v1/trips/:id/emergency` never checks that the caller is on the trip. Any authenticated user can fire an SOS for an arbitrary trip id: the `sosEvent` insert fails the FK and is swallowed by a logging `.catch`, but the URGENT support ticket and the on-call SMS still fire. Pages a human, costs SMS, and pollutes the safety queue. Add an ownership check before any side effect. |
| R2 | low | Dead server endpoints with no client anywhere: `GET/POST/DELETE /v1/driver/destination-filter`, `POST /v1/driver/shifts/start`, `/shifts/end`, `GET /shifts/current`, `/shifts/history`, `GET/POST /v1/driver/inspections`, `GET /v1/driver/earnings/breakdown`, `POST /v1/driver/vehicle`. Either finish or delete — an endpoint nobody calls is an untested attack surface. Destination filter and shift tracking are real Bolt/Uber driver features; see D-series below for the recommendation. |
| R3 | low | `eyego-api/src/modules/routes/` is unmounted by design (the group/on-demand pivot) and `packages/api/src/routes.api.ts` is deliberately not exported from `index.ts`. Both are documented dead code. Delete both rather than keep a module whose comment has to warn future readers not to mount it. |
| R4 | low | `SOS_ONCALL_PHONES` is a `PlatformSetting`, not an env var, and appears nowhere in `.env.example`. An unset roster means SOS SMS reaches nobody — the service warns, and `/sos-events/alerting-health` surfaces it, but nothing forces it. Must be a hard item on the go-live checklist, and worth a boot-time warning in production. |
| R5 | low | `GET /v1/trips/pulse` is fully public — no auth, no rate limiter (its `join`/`track` siblings at least have `publicShareLimiter`). Add the limiter. |

Confirmed **not** problems, so they are not re-investigated later: `/v1/admin/export`, `/v1/admin/export/:dataset` and `/v1/admin/search` are wired through Next route handlers (`apps/admin/app/api/…`) — the "no CSV export" note in `session-log.md` is stale. `POST /v1/payments/webhook` is unauthenticated by design and HMAC-verified. Booking dispute, invite, heavy-cargo, receipt and driver-wallet routes all have callers.

**Pass 1 — flow trace.** Every journey, screen by screen, against the API route
it actually calls. For each screen: does every control do something real; are
there loading, empty *and* error states; does the route exist and does its
shape match what the screen reads?

- rider — onboard, book, dispatch, in-trip, pay, rate, schedule, group,
  wallet, profile, safety, disputes
- driver — onboard, documents, go-online, offer, pickup, PIN, in-trip,
  complete, earnings, withdraw, safety
- admin — every console page → service → query
- backend — every route reachable, authorised, and rate-limited

### Batch 2 — app surface (complete)

Swept rider, driver, admin and `packages/ui` for dead controls, swallowed
errors, theme drift and type erosion.

**Verdict: the apps are far healthier than the raw counts suggest**, and most
of what a naive grep flags here is deliberate and commented. Recording that
explicitly so a future pass does not re-litigate it:

- 68 `.catch(() => {})` — almost all are best-effort `AsyncStorage` writes
  behind a real `onError` toast and, on the contacts screen, an `offlineQueue`
  retry. Not silent failures.
- 227 hardcoded hex colours in rider — 114 are the palette definition in
  `utils/useColors.ts` and 44 are onboarding artwork. Not theme drift.
- 40 surviving `Alert.alert` calls — consistent with the quality pass, which
  kept 36 real decisions and migrated only the 151 pure reports.
- The two "dead" `onPress={() => {}}` are the standard swallow-the-tap idiom on
  a sheet body.

| id | severity | finding |
|----|----------|---------|
| A1 | high | The SOS screen swallows the failures that matter. `Linking.openURL('tel:112').catch(() => {})` appears three times and `sms:${contact.phone}` twice: if the dialer or SMS composer refuses to open, the rider taps the panic button and **nothing happens and nothing is said**. Every other `.catch(() => {})` in the codebase sits behind a toast; these do not. Surface a failure here, and fall back to showing the number as selectable text. |
| A2 | medium | Two emergency numbers, neither configurable. Rider dials `112`, driver dials `191`, in five places across the two apps. One `PlatformSetting` (`EMERGENCY_NUMBER`), served through `/v1/config/public`, read by both. Hardcoding it also makes the apps unshippable in any second market. |
| A3 | medium | 356 `as any` across rider and driver, spread thin (max 21 in one file) rather than clustered — i.e. it is the API-boundary cast pattern, not one bad file. This is the "parse, don't cast" item the quality pass deliberately deferred. The `Trip` type was rebuilt by observation and will drift again on the next server change. Zod schemas at the boundary in `packages/api`, starting with the payloads that carry money and seat counts. |
| A4 | low | The backdrop-blocking `Pressable` inside each modal sheet carries `accessibilityRole="button"`, so a screen reader announces the whole sheet body as a button. It is a tap sink, not a control — drop the role. |
| A5 | low | ~80 ungated `console.*` calls ship in both apps (`__DEV__` appears zero times in `auth.store`, `driver.store`, `useDriverLocation`). They log error objects, not token values, so this is log noise rather than a leak — but it should go through the existing Sentry/logger seam instead. |

**Pass 2 — adversarial.** Network drop mid-booking, double-tap, back-navigation
mid-flow, token expiry mid-trip, clock skew, GPS loss, killed app, negative /
huge / unicode input, concurrent claim, frame replay.

This is the pass that matters most here: every prior sweep in
`session-log.md` was dominated by races, stale state, silent failures and
envelope mismatches — not by missing screens.

### Batch 3 — adversarial and coverage (complete)

The money and dispatch paths have been swept repeatedly and they hold up.
Recording what was checked and found *sound*, so it is not re-audited:

- Driver withdrawal does its balance check **inside** the transaction, with the
  Paystack call deliberately outside it and a compensating credit-back on
  failure. No TOCTOU.
- `initiatePayment` has an in-flight idempotency guard that returns the
  existing pending charge rather than opening a second one, and treats an
  already-settled booking as success instead of reporting "payment failed".
- `goOnline` already gates on `status === 'ACTIVE'`, required documents being
  `VERIFIED`, the wallet float, and Ghana bounds. **The document-expiry work
  from §2.6 slots into this existing gate** — only the dates are missing, not
  the enforcement point.

| id | severity | finding |
|----|----------|---------|
| X1 | high | Harness coverage stops short of exactly the areas this run adds. Eleven suites exist (rider/driver happy path + edges, features, settings, wallet-commission, dispatch-payload, lifecycle-edges, geo-routing, silent-failures) and **none** covers payments end to end, documents, notifications, receipts, support tickets, SOS, the admin API, or config. Every §2.6 item ships with its own suite, and the existing gaps get backfilled — otherwise the done bar in §4 proves less than it appears to. |
| X2 | medium | Nothing enforces the production invariants the deployment depends on. Boot should refuse, in production, when: `EYEGO_ADMIN_LEGACY_SECRET` is set, `PAYMENT_PROVIDER=mock`, `JWT_ACCESS_SECRET` is unset or default, or `SOS_ONCALL_PHONES` is empty. The last one is the difference between an SOS reaching a human and reaching nobody, and today it is a log line nobody reads. |
| X3 | medium | `prisma migrate deploy` runs from the container start command. With one replica it is merely untidy; the moment there are two it is a migration race. Move it to an explicit deploy step in the runbook. |
| X4 | low | The repo is mixed CRLF/LF with no `.gitattributes`. It silently broke two passes of this audit's own tooling; it will do the same to anything else written against the repo, and it makes diffs noisier than they need to be. |
| X5 | low | `eyego-api/docker-compose.yml` pins postgres 16 while the root `docker-compose.yml` pins 18 and explains at length why 18 is load-bearing (pg_dump refuses to dump a server newer than itself). Two contradictory sources of truth for the dev database. Delete the api-local one and point its README at the root file. |

---

## 3b. Ranked backlog

Audit findings folded into the agreed scope, ordered so that each group leaves
the tree green. Numbers are the execution order, not a priority ranking —
everything here ships before handover.

**Group 1 — safety and correctness (smallest, highest stakes)**

1. A1 — SOS dialer and SMS failures become visible, with the number shown as
   selectable text as a fallback
2. A2 — one `EMERGENCY_NUMBER` setting, served from `/v1/config/public`,
   replacing `112`/`191` in five places
3. R1 — trip-ownership check on `POST /v1/trips/:id/emergency` before any side
   effect fires
4. X2 — production boot refuses a mock payment provider, a legacy admin secret,
   a default JWT secret, or an empty SOS roster
5. R4, R5 — `SOS_ONCALL_PHONES` onto the go-live checklist; rate-limit
   `/v1/trips/pulse`

**Group 2 — store blockers**

6. Foreground-service location migration in driver; drop
   `ACCESS_BACKGROUND_LOCATION`, add `FOREGROUND_SERVICE` +
   `FOREGROUND_SERVICE_LOCATION` (§2.3)
7. `ios.privacyManifests` in both apps; populate `eas.json`
   `submit.production`
8. Force-upgrade + maintenance mode on `/v1/config/public`, 426 on stale
   clients (§2.6 #2)
9. Reviewer/demo mode across both apps and dispatch (§2.6 #5)
10. Terms + privacy acceptance, version-stamped (§2.6 #6)
11. Driver `ErrorBoundary`, Sentry in admin, release tagging, sourcemap upload

**Group 3 — money**

12. MoMo pay-in: `MOMO` method, Paystack charge → OTP → webhook, async, with a
    reconciliation sweep for stuck pendings (§2.5)
13. MoMo payout: recipients, transfer, webhook, ledger, balance hold (§2.5)
14. Immutable money ledger + driver earnings statement + admin reconciliation
    (§2.6 #8)
15. Trip receipts by email/SMS (§2.6 #7)

**Group 4 — trust and compliance**

16. `DriverDocument` model with expiry, backfilled from the `documentReview`
    blob; 30/7-day warnings; hard block wired into the existing `goOnline`
    gate (§2.6 #1)
17. Fraud basics: mock-location, self-ride, cancel-abuse cooldown, payout hold,
    impossible-jump velocity (§2.6 #3)
18. Lost & found on the existing ticket system (§2.6 #4)

**Group 5 — ops**

19. Backups: pgBackRest/wal-g to object storage, `scripts/restore-drill.sh`,
    Redis snapshot (§2.1)
20. Caddy/nginx TLS, admin container, reverse proxy, `LEGACY_SECRET` refusal
    (§2.2)
21. X3 — migrations out of the container start command, into the runbook
22. Server-side event table, funnel queries, admin dashboard, `/metrics`,
    Grafana, alerts (§2.4)

**Group 6 — quality and hygiene**

23. X1 — e2e suites for payments/MoMo, documents, config/force-upgrade,
    reviewer mode, receipts, notifications, SOS, admin API
24. A3 — Zod at the API boundary in `packages/api`, money and seat payloads
    first
25. R2, R3 — finish or delete destination-filter, shifts, inspections,
    earnings/breakdown, `POST /v1/driver/vehicle`; delete the unmounted routes
    module and its client twin
26. A4, A5 — drop the backdrop `accessibilityRole`; route `console.*` through
    the logger
27. X4, X5 — add `.gitattributes`; delete the contradictory api-local compose

**Group 7 — the go-live pack**

28. All ten documents in `docs/go-live/` (§2.7)

## 4. Done bar

All green, all re-runnable, against a **live local stack** (user brings up
`docker compose` + the API):

- every new migration applied via `prisma migrate dev`
- `prisma generate` — a stale client 500s every trip endpoint at once
- `tsc --noEmit` for packages, rider, driver, admin
  (`npx` is broken here — use `node node_modules/typescript/lib/tsc.js`)
- `node scripts/e2e/run-all.mjs` — all suites green
- `node scripts/invariants.test.mjs`
- `eyego-api` jest suite
- `next build` for admin, production build
- **new** e2e coverage for MoMo, documents, force-upgrade, reviewer mode,
  receipts

Then purge harness fixtures (`scripts/e2e/purge-test-data.mjs --confirm`) and
hand over for sideload.

Nothing is reported complete on a typecheck alone.
