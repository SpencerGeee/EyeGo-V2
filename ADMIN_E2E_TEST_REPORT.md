# EyeGo Admin Console — End-to-End Test Report
_2026-08-20 · branch `main` · production build, exercised in a real browser against a live API and database_

## What this document asserts, precisely

The previous audit (`PRODUCTION_READINESS_AUDIT.md`) marked section D — the admin
console — complete on the strength of **static** analysis: routes enumerated,
predicates read, contracts diffed. It said so plainly, and it said the thing it
could not say was whether the console behaves correctly when actually run.

This pass ran it. A production `next build` was served on `:4000` against the
real `eyego-api` on `:5020`, backed by Postgres 18 and Redis in Docker, loaded
with a purpose-built fixture set. Every page was rendered, every mutating action
invoked, every role signed in, and the numbers on screen were reconciled against
`SELECT` results underneath them.

**Eight defects were found that static analysis had not caught.** All eight are
fixed and re-verified. Three of them were wrong *numbers on screen* — the class
of bug that reads as working software right up until someone makes a decision on
it.

---

## Environment

| Piece | What ran |
|---|---|
| Console | `next build` + `next start -p 4000` — production output, 31 routes, not dev |
| API | `eyego-api` on `:5020`, `NODE_ENV=development` |
| Database | Postgres 18 in Docker on loopback; 9 migrations, **zero drift** |
| Redis | 7-alpine on loopback; dispatch pool and presence keys live |
| Browser | Chrome, driven through the extension, signed in as a seeded superadmin |
| Fixtures | `eyego-api/prisma/seed-e2e-admin.js` (new, committed) |

### The fixture set

`node prisma/seed-e2e-admin.js` builds a platform with at least one row behind
every list, filter value and moderation action the console can reach:

- 3 routes + virtual stops · 10 riders (1 banned, 1 deactivated, 1 business)
- 9 drivers — 3 pending review with per-document states, 1 suspended, 1 rejected — plus vehicles
- **61 trips covering all 15 statuses**, 243 bookings across all 10 booking statuses
- 180 receipts + 180 payment transactions, 20 wallet ledger rows, 24 online sessions
- 5 SOS events (3 open), 5 trip reports (3 open), 6 support tickets with threads
- 4 promotions (live / disabled / expired), 3 pulse schedules, 24 ratings
- **6 console operators, one per role**, so RBAC can be exercised rather than assumed

Everything it writes is prefixed `e2e_`, and the teardown matches on parent keys
as well as ids, so a re-run removes exactly what a previous run added.

```bash
node prisma/seed-e2e-admin.js          # wipe previous fixtures, insert fresh
node prisma/seed-e2e-admin.js --keep   # insert without wiping
# sign in: e2e.super@eyego.app / EyeGoE2E!Test7   (also .ops .finance .support .viewer)
```

---

## Results

| Check | Result |
|---|---|
| Console pages rendering (22) | **22 / 22** — no error panel, no `NaN`, no `[object Object]`, no `undefined` |
| Admin API read endpoints (27) | **26 / 27** — the one failure is `/ota/runs`, correctly 503 without `GITHUB_TOKEN` |
| Mutating actions as superadmin (17) | **17 / 17** |
| RBAC (4 roles × 17 actions) | **68 / 68 correct** — VIEWER denied every write by blanket guard |
| Self-lockout guards | Cannot demote self, cannot disable self — both refused 403 |
| Disabled account sign-in | Refused |
| Audit trail | Every one of the 17 actions produced a row with actor, target and IP |
| Malformed-input handling (18 cases) | **0 unhandled 5xx** after fixes (was 3) |
| Backend module load sweep | 119 / 119 clean |
| Invariants suite | 2 / 2 pass |
| `tsc --noEmit` (admin) | Clean |

---

## Defects found and fixed

### 🔴 D1 — The live dispatch board reported every busy driver as free

`GET /v1/admin/live/drivers` returns each driver's current job as an object
named **`activeTrip`**. The dispatch page declared and read **`activeTripId`**.
That is not a type error at runtime — it reads `undefined`, which is falsy — so
`free = drivers.filter(d => !d.activeTripId)` matched *everyone*.

Observed on screen: **"Free to dispatch 4 · On a trip 0"** while
`/dispatch/health` said 0 of 10 drivers were dispatchable and three of those
four were mid-trip. Every row badge read "Free". The PLATE column was empty for
the same reason (`vehiclePlate` vs `vehicle.plateNumber`).

The consequence is not cosmetic: **the reassign picker offered a stranded trip
to drivers already carrying passengers.** An operator working an incident — the
only time this page is open — was being shown the reassuring number and invited
to act on it.

*Fixed* by normalising the payload where it enters the page, with both spellings
declared on the type so the two cannot silently drift again.
Now reads "Free to dispatch 1 · On a trip 3", plates populated, badges showing
real trip codes.

### 🔴 D2 — "Revenue today" was two different numbers on two pages

`getMetrics` (dashboard tile) filtered `Booking.updatedAt >= today`.
`getAnalyticsOverview` (Revenue and Analytics pages) filtered `Booking.createdAt`.

On screen: dashboard **GH₵8,705**, Revenue page **GH₵923** — and the dashboard's
"today" was nearly triple the "this week" figure printed directly beneath it.

`updatedAt` moves on *any* write — a PIN verification, a cancellation, a
live-activity token refresh. A booking settled last month re-enters "today"
merely by being touched, and can do so again tomorrow. The number was not just
inconsistent, it was uncountable.

*Fixed* with a single `settledRevenueWhere()` helper both call sites use.
Verified: dashboard == Revenue page, and today ≤ week ≤ month.

### 🟡 D3 — Trip reports could never show the trip's status

`getTripReports` selected `{ id, shortId, route: { originName, destinationName } }`.
The console renders a **status badge** and `route.name` — neither was selected.
Every report therefore displayed the badge **"Unknown"**, which reads as a claim
about the trip rather than a missing column. The neighbouring `getSosEvents` had
the same shape and got it right.

The link text was a second defect: `shortId(r.tripId)` printed the first eight
characters of the *database id* while the trip's real short code sat unused in
the payload.

*Fixed* — select now matches `getSosEvents`; the component renders `trip.shortId`
and hides the badge entirely when status is genuinely absent.
Now reads "Trip **E2EDONE1** · Completed".

### 🟡 D4 — A 723 KB image was being inlined into list pages

`User.profilePhoto` is an unvalidated free-string column. A live account held a
**723 KB base64 `data:` URI** in it. The console's `Avatar` renders that column
straight into `<img src>`, and Next ships it twice — once in the markup, once in
the RSC flight payload — so the **riders list was a 1.5 MB page for twelve rows**.
Fifty such riders would be a 70 MB page.

The blast radius is wider than the console: the same column is served as
`avatarUrl` on trip, booking and passenger-manifest payloads, so that one row
put three quarters of a megabyte into every API response mentioning that rider —
on a phone, on Ghanaian mobile data.

*Fixed* on both sides. New `eyego-api/src/utils/asset-url.js` refuses `data:`
URIs, non-`http(s)` schemes (`javascript:` included) and over-long values on the
rider and driver profile-photo write paths. The console declines to inline rows
that predate the guard and falls back to initials.
**Riders page: 1506 KB → 60 KB, zero base64 blobs.**

### 🟡 D5 — Support could post an empty reply, or get a 500

`POST /support-tickets/:id/respond` validated nothing.
- No `text` → Prisma NOT-NULL violation surfaced as **500 `DB_WRITE_FAILED`**, with the body "Please try again" — advice that would never once have worked.
- `text: "   "` → **200**, and an empty message posted into the rider's thread, which the rider sees as support having answered with nothing.
- `text: 12345` → 500.

*Fixed* — trimmed, type-checked, length-capped, 400 with a real message.

### 🟡 D6 — Pulse schedules accepted impossible values

`createPulseSchedule` was `prisma.pulseSchedule.create({ data })` — the request
body handed straight to Postgres. An unknown `routeId` came back as a raw
foreign-key violation: **500, with Prisma's own `P2003` leaked as the API's
error code**. A `departureTime` of `"99:99"` was accepted outright, creating a
recurring departure that can never fire and that nothing downstream reports.

*Fixed* — route existence, `HH:MM` format, day names, tier and seat range all
validated with specific messages.

### 🟡 D7 — Document review approved documents that do not exist

`POST /drivers/:id/documents/:type/review` wrote `review[type]` for **any**
`type` off the URL. `/documents/banana/review` answered **200 "Document
approved"**, stored a key nothing reads, left the real document untouched — and
wrote an audit row asserting a compliance document had been reviewed. An
approval that approves nothing while claiming otherwise is worse than an error,
because the queue looks done.

*Fixed* — allow-listed to `DRIVERS_LICENSE`, `GHANA_CARD`, `PROFILE_PHOTO`.

### 🔵 D8 — Two smaller fake-successes

- `PATCH /settings` with a missing or empty `settings` object returned **200 "Settings applied — live immediately, no restart needed"** having applied nothing. On an endpoint that prices real rides, an operator told a change landed will not go back and check. Now 400.
- `POST /promotions` accepted an expiry already in the past, creating a promotion that is dead on save but looks live in the list. Now 400.

---

## What was checked and found sound

These were tested, not assumed, and needed no change.

- **RBAC is real.** 68 role×action checks, zero violations. VIEWER is denied every write by the blanket `denyReadOnlyWrites` guard, so a newly added mutating route is closed by default. FINANCE writing platform settings is *deliberate* and documented on the route — these values price rides.
- **Settings validation is solid.** Unknown keys, wrong types and out-of-range values (`PLATFORM_COMMISSION: 5`) are all rejected with specific messages; accepted writes persist with `updatedById` and `updatedByEmail` attribution.
- **Audit coverage is complete.** All 17 mutating actions recorded with actor, target type/id and IP.
- **Self-lockout guards hold.** Cannot demote or disable yourself; disabled accounts cannot sign in.
- **Session handling.** httpOnly cookies only — no token in client JS; silent rotation in middleware; `lib/api.ts` is `server-only`, so importing it client-side is a build error.
- **`driversDispatchable` tells the truth.** The dashboard leads with the Redis-presence count (0) and keeps the `isOnline` toggle count (4) as its subtitle, so the gap that *is* the "nobody got my ride request" symptom is visible without opening `/dispatch/health`.
- **Money basis is consistent.** Revenue reads `Booking.paymentStatus = PAID` everywhere — correct for a cash-majority platform where card transactions are the minority.
- **Error states are honest.** A dead API renders "Cannot reach the EyeGo API", never "0 revenue". `/ota` says "No apps reported" rather than showing an empty success.

---

## Competitive gap analysis

Verified absent by search, not assumed. None of these is a defect — the console
does what it claims. These are the things comparable operations consoles have
that this one does not.

### Tier 1 — I would not run a support desk without these

1. **CSV / data export — absent everywhere.** No page can export. Finance cannot reconcile against Paystack without hand-copying, and no regulator request can be answered. This is the single highest value-per-hour addition. *~1 day for a shared export helper + buttons on trips, bookings, drivers, riders, revenue, audit log.*

2. **Refunds and wallet adjustments — no admin path exists.** There is no `refund` endpoint on the admin surface and no manual wallet credit. Today a support agent who agrees a rider was overcharged has literally no way to act on it; the money paths exist only inside rider/driver flows. Every ride-hailing support desk has this on day one. *~2 days including the ledger row, audit and RBAC (FINANCE + SUPERADMIN only).*

3. **SOS alerting has no delivery channel the console can use.** The plumbing is real — `admin:fcm_tokens` in Redis is read at both SOS creation sites — but the only registration endpoint is mobile-only and the web console never calls it. In practice, unless someone is running an admin mobile app, **a panic alert reaches nobody until a human happens to refresh the page.** For a safety feature this is the most serious gap in this document. *~1 day for browser push or an email/SMS fan-out.*

4. **Internal notes on rider and driver records.** No way to write "called her, resolved, do not re-ban". Every ticket is worked from zero.

### Tier 2 — operational leverage

5. **Bulk actions.** No multi-select anywhere. Approving twenty drivers is twenty page loads.
6. **Date-range picker on Analytics/Revenue.** Windows are hard-coded (today / 7 / 30 / 14-day chart). "How did last month compare" cannot be asked.
7. **Global search / command palette.** Each entity is searchable only from its own page. A support agent with a phone number does not know whether it is a rider or a driver.
8. **Saved views.** "Pending drivers older than 3 days" must be re-filtered every session.
9. **Stale SOS queue.** 28 unresolved events, the oldest 3 days old, all on long-completed trips, permanently badged "needs triage now". A queue that is always red is a queue nobody reads. Needs auto-ageing or a triage state.

### Tier 3 — enterprise / compliance

10. **No MFA on admin accounts.** Password-only for accounts that can change platform-wide fares and ban users. Riders get OTP; admins get less. TOTP is the standard bar and is a common procurement blocker.
11. **No IP allowlist** for console access.
12. **No scheduled/emailed reports** — daily revenue digests, weekly ops summaries.
13. **No audit-log export or retention policy** — the log is append-only and queryable but cannot leave the system.
14. **No live push into the console.** Every page polls on a timer (15s–120s). Dispatch and SOS both want a socket.
15. **No driver payout batching** — payouts are per-driver only.

---

## Honest limits of this pass

- **Single-operator.** No concurrent-editor testing; two admins acting on the same driver simultaneously was not exercised.
- **Volume is fixture-scale.** 61 trips, not 61,000. Pagination works; index behaviour under real load is untested. `/sos-events` already takes ~1.7 s for 29 rows because each is reverse-geocoded (Redis-cached) — at 500 events that ordering needs review.
- **Not load-tested, not penetration-tested.** RBAC was verified by direct API calls bypassing the UI, which is the meaningful check, but this is not a security assessment.
- **Externally-gated features could not run end to end**: OTA publishing (needs `EXPO_TOKEN`/`GITHUB_TOKEN`), Paystack refunds (needs live keys), map basemap (needs `NEXT_PUBLIC_MAP_STYLE_URL` — markers plot correctly without it).
- The `eyego-api` process was restarted and the console rebuilt during this session; both are running the fixed code.

## Verdict

**The admin console is complete and, with the eight fixes in this document, correct.** Every page reaches a real endpoint, every action performs the write it claims, RBAC is enforced server-side, and every mutation is attributed in an append-only log.

Two caveats belong on the record rather than buried. First, three of the eight defects were **wrong numbers displayed confidently** — the dispatch board in particular was actively misleading during exactly the incident it exists for. That class does not surface without running the thing, and it is worth assuming more of it exists in the volume and concurrency regimes this pass did not reach. Second, "complete" is not the same as "sufficient to operate": **there is no refund path, no data export, and no working SOS alert delivery.** None is a bug. All three are things a support desk needs on its first day.

---

### Files changed

```
eyego-api/src/modules/admin/admin.service.js      D2, D3, D5, D6, D8
eyego-api/src/modules/drivers/drivers.service.js  D4, D7
eyego-api/src/modules/users/users.service.js      D4
eyego-api/src/utils/asset-url.js                  D4  (new)
eyego-api/prisma/seed-e2e-admin.js                fixtures (new)
apps/admin/app/(console)/dispatch/page.tsx        D1
apps/admin/app/(console)/dispatch/DispatchBoard.tsx D1
apps/admin/app/(console)/trip-reports/ReportsList.tsx D3
apps/admin/components/ui/primitives.tsx           D4
```

Uncommitted. `tsc --noEmit` clean, 119/119 backend modules load, invariants 2/2.
