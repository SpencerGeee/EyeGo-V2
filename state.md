# State — production-readiness run (2026-09-01)

## Where things stand

The audit is complete and **Groups 1, 2, 5, 6 and 7 are done and committed.**
Group 3 turned out to be mostly already built; Group 4 is half done. Nothing is
device-tested — that is the user's next step.

Plan, findings and the ranked backlog:
`docs/superpowers/plans/2026-08-31-production-readiness.md`

    f21908a  chore: delete the module whose comment was longer than the code
    67edb27  ops: backups that get restored, TLS that renews itself, go-live pack
    0c0a959  feat: paperwork that expires, and a gate that notices
    49ed6cb  feat: a receipt that leaves the app, and the release gate under test
    40fb543  feat: a driver for the app reviewer, and consent where drivers live
    cf80e10  feat: a recall lever for shipped builds, and consent with a record
    af9eedd  fix: a panic button that could fail silently, two emergency numbers

## Not done — say so plainly

| Item | Why |
|---|---|
| Fraud basics (backlog 17) | Mock-location detection already exists in `useDriverLocation`. Self-ride refusal, cancel-abuse cooldowns and payout holds are not built. |
| Lost & found (18) | Not started. Rides on the existing ticket system; ~1 day. |
| Telemetry + `/metrics` + Grafana (22) | Not started. The health endpoints and the log are the whole observability story today. |
| Sentry in admin (11) | Needs `npm i @sentry/nextjs`. Deliberately not added to `package.json` without an install — it would break `next build`. |
| E2E suites for the new features (23) | The 340-check harness has NOT been re-run this session. New work is covered by jest and by a live-DB probe, not by the harness. |
| Zod at the API boundary (24) | 356 `as any` remain. Big, and the right long-term answer. |
| Driver earnings statement UI (14) | API wrapper added; the screen still derives its own totals. |
| Destination filter / shifts / inspections UI | Server-side is live — `destination-mode.service` is used by the dispatch cascade — but no client sets them. **Do not delete these endpoints.** |
| E2 — stored quotes do not pin fees | Real, recorded as `test.todo`. Money code; not worth a rushed fix. |
| E4 — 9 integration suites | Stale mocks, not product bugs. Need their own pass. |

## Verification, as it actually stands

    tsc --noEmit    packages · rider · driver · admin      GREEN
    prisma validate                                        GREEN
    prisma migrate deploy                                  APPLIED (2 new)
    prisma generate                                        DONE
    API cold boot                                          /health 200 in ~8s
    apps/admin  next build                                 GREEN (after the fix below)
    jest                                                   4 suites pass, 9 fail (E4)
    scripts/e2e/run-all.mjs                                NOT RUN this session

**`node_modules` was repaired, not just the code.** The admin build failed with a
null `useRef` during static export — two React copies. Root
`node_modules/react-dom` was a corrupted partial install (a lone `LICENSE`, no
`index.js`), so `react` resolved to the root and `react-dom` to a nested copy
under `apps/admin`. The real package was moved to the root and the nested copy
removed; both now resolve to one file and the build completes. If a future
`npm ci` ever reproduces it, that is the symptom and that is the fix.

**`npx` is broken here** — use `node node_modules/typescript/lib/tsc.js` and
`node node_modules/prisma/build/index.js`.

## The live stack right now

Postgres and Redis are up in docker. The API is running on **:5020**, started
detached by me — logs at
`…/scratchpad/api2.log`. It was originally under `nodemon`; I stopped that to
release the Prisma engine lock for `generate`. Restart it the normal way when
convenient:

    cd eyego-api && npm run dev

## ⚠ Before running the harness

`node scripts/e2e/run-all.mjs` **re-seeds** the database. Purge afterwards:

    node scripts/e2e/purge-test-data.mjs --confirm

## Facts worth carrying forward

- **Mobile money was already built, both directions.** The audit said otherwise
  and that was the largest item in the agreed scope. Cancelled, not deferred.
- **The driver app already had an ErrorBoundary** — inline in `_layout.tsx`. The
  audit looked for a filename.
- `Driver` is NOT a `User` row: it has its own `phone`/`name` and no `userId`.
  `req.user.userId` on a driver token IS the `Driver.id`. Consent columns
  therefore exist on both tables.
- `Trip` uses `requesterId`, not `riderId`. `Booking` uses `fareAmountPesewas`.
- Fare composition: `farePerPerson = ride + bookingFee + platformFee`, and
  `commission + driverEarnings = ride`. No commission is taken from the fees.
- The go-live pack is at `docs/go-live/` — ten documents, the legal ones marked
  DRAFT for counsel.
