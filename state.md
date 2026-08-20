# State — admin enterprise completion

_2026-08-20 · branch `main` · **COMPLETE**_

Plan: `docs/superpowers/plans/2026-08-20-admin-enterprise-completion.md`
Report: `ADMIN_ENTERPRISE_COMPLETION.md`
Prior pass: `ADMIN_E2E_TEST_REPORT.md`

## Status

All six phases built and verified against a production build, a live API,
Postgres 18 and Redis. 14/14 console pages clean, `tsc --noEmit` clean,
production build clean, 0 RBAC violations on the new endpoints. **Uncommitted.**

## To bring the stack back up

Docker Desktop does not survive a session restart and must be started first.
Real path casing is `EyeGo V2` — a mismatched case resolves two React copies and
fails the build on `/404`.

```bash
docker compose --env-file .env.docker up -d          # from repo root
cd eyego-api && node src/server.js                   # :5020
cd apps/admin && node ../../node_modules/next/dist/bin/next start -p 4000
node eyego-api/prisma/seed-e2e-admin.js              # fixtures
# e2e.super@eyego.app / EyeGoE2E!Test7  (also .ops .finance .support .viewer)
```

Harnesses in the session scratchpad: `probe-enterprise.js` (all six phases),
`probe-admin-writes.js` (RBAC), `probe-admin-api.js`, `probe-console-pages.js`.

## Before this is production-ready

1. **Set `SOS_ONCALL_PHONES`** in Platform config. Until then the SOS page
   correctly reports "Nobody would be alerted" — the SMS roster is the only
   channel that reaches someone who is not already looking at the console.
2. **Turn on `ADMIN_MFA_REQUIRED` only after the team has enrolled.** The
   superadmin who flips it is warned but not exempt.
3. `sendSms` is a deliberate no-op in development, so SOS SMS delivery cannot be
   proven locally — `alertingHealth()` reports `smsConfigured: false` for exactly
   that reason. It needs one real send on staging.
4. Gateway refunds are implemented against Paystack's `POST /refund` but have
   only been exercised against the mock provider; they need one live test.

## Known-deliberate omissions

- **No bulk-approve button** on `/drivers/pending` — the page's own rule is that
  approval requires reading three documents, and select-all beside an unread
  queue defeats it. The audited API exists for a reviewed batch.
- No scheduled/emailed reports (no mail transport in the stack), no IP allowlist
  (belongs at the proxy), no WebSocket push (pages poll), no payout batching
  (needs the Transfers API and a live merchant account).
