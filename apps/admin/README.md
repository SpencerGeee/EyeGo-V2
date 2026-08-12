# EyeGo Admin Console

Next.js 15 (App Router) operations console for EyeGo. Replaces the vanilla-JS
SPA that used to live inside `eyego-api/public`.

## Why it is a Next app and not a SPA

The old console held `ADMIN_SECRET_KEY` in code the browser could read. There is
no way to fix that in a static SPA — whatever the page uses to call the API, the
page can be made to reveal.

Here, **every read happens in a server component and every write in a Server
Action**. `lib/api.ts` begins with `import 'server-only'`, so importing it from a
client component is a build error, not a runtime leak. The admin JWT lives in an
httpOnly cookie the browser cannot read, and the API is only ever called
server-to-server — which is also why **CORS never comes up**.

The one exception is deliberate: the fleet map polls `/api/live/drivers`, a route
handler in this app that reads the cookie server-side and forwards the request.
The browser never sees a token.

## Identity and roles

| Role | Can do |
|---|---|
| `SUPERADMIN` | Everything, including admin accounts and OTA releases |
| `OPS` | Dispatch, fleet approval, surge, schedules |
| `FINANCE` | Revenue, promotions |
| `SUPPORT` | Tickets, trip reports, SOS triage, rider bans |
| `VIEWER` | Reads everything, writes nothing |

`lib/roles.ts` decides what the **navigation** shows. The real gate is
`requireRole()` in `eyego-api/src/middleware/adminRbac.js` — anyone can curl the
API, so a check that exists only here is decoration. Both layers are always
updated together.

Every mutating request is recorded in `AdminAuditLog` (who, what, target, status
code, IP), including refused attempts, with credentials stripped from the payload.

## First run

```bash
# 1. From the repo root (yarn workspaces):
yarn install

# 2. API: migrate and seed the first superadmin.
#    Stop the API dev server first — Prisma cannot replace the query engine DLL
#    on Windows while node is holding it.
cd eyego-api
npx prisma generate
# This repo gitignores migration SQL (eyego-api/.gitignore), so the generated
# migration exists only on the machine that made it. Either apply the one
# written for this change:
npx prisma migrate deploy   # 20260812120000_admin_identity_and_audit
# …or, on a fresh clone, push the schema directly:
#   npx prisma db push
node prisma/seed-admin.js --email you@example.com --name "Your Name"
#    ^ prints a generated password once, and forces a change on first sign-in.

# 3. Console:
cd ../apps/admin
cp .env.example .env.local     # set EYEGO_API_URL
yarn dev                        # http://localhost:4000
```

From the repo root, `yarn admin` and `yarn admin:build` do the same thing.

## Environment

See `.env.example`. Only `EYEGO_API_URL` is required.

## Known monorepo gotcha: `react-dom`

Yarn v1 hoists `next` and `react` to the repo root but keeps `react-dom` inside
this workspace, because the two Expo apps do not depend on it. Next's own server
runtime then `require`s `react-dom/server.browser` from the **root**
`node_modules`, which never walks down into a workspace, and the build dies at
"Collecting page data" with `Cannot find module 'react-dom/server.browser'`.

`next.config.ts` fixes the webpack half (a fallback resolution root). The Node
half needs `react-dom` reachable from the root — either let yarn hoist it, or
link it:

```bash
node -e "require('fs').symlinkSync('apps/admin/node_modules/react-dom','node_modules/react-dom','junction')"
```

On Vercel this does not arise: with Root Directory set to `apps/admin`, the
install is rooted here and `react-dom` sits alongside `next`.

## Deploying to Vercel

- **Root Directory**: `apps/admin` (not the repo root — the repo root is a
  React Native workspace and will not build here).
- **Install Command**: leave default; Vercel runs the workspace install.
- **Environment Variables**: `EYEGO_API_URL` pointing at the public HTTPS URL of
  `eyego-api`. Do not set `EYEGO_ADMIN_LEGACY_SECRET` in production.
- Cookies are marked `secure` automatically when `NODE_ENV=production`, so the
  console must be served over HTTPS.

## Session handling

`middleware.ts` decodes (does not verify) the access token to decide which page
to draw, and silently rotates an expired one using the refresh cookie — but only
on real navigations, detected via `sec-fetch-mode: navigate`. A prefetch or fetch
that hits an expired session gets a 401 rather than a redirect, because a
redirect returned to a prefetch can rewrite the user's location.

Rotation races are expected (two tabs, two rotations) and are absorbed by a 20s
replay grace window in `adminAuth.service.js` that mirrors the rider flow.

The console layout re-checks identity against `/auth/me` on every render. That is
not redundant with middleware: middleware only reads the token, while the API
re-reads the `AdminUser` row, so a demoted or disabled admin holding a still-valid
token is stopped within one access-token lifetime.

## Design system — "Graphite"

Defined entirely in `app/globals.css` (Tailwind v4, CSS-first `@theme inline`):

- **Hairlines carry structure, not shadows.** Shadow means "floating above the
  page" and nothing else, so a modal reads as a modal.
- **Exactly one accent** (`--accent`), reserved for the primary action and live
  state. `--critical` is reserved for SOS alone — if everything is urgent,
  nothing is.
- **Tabular numerals everywhere numbers align** (`.num`), so a column of fares
  can be scanned rather than read.
- **Status is never colour alone.** Every badge pairs its hue with a glyph or the
  status word, so it survives colour blindness and greyscale printing.
- **Runtime theming by swapping custom properties**, which is why no element in
  this app carries a `dark:` variant. Three-way resolution: explicit
  `data-theme`, then `prefers-color-scheme`, then the dark default.
- `prefers-reduced-motion` removes every animation, including the live pulse.

Money is stored and passed as integer pesewas and divided by 100 only in
`lib/format.ts`. Anything named `…Pesewas` is an integer; float arithmetic on
money never happens in this app.

## Two invariants this console must not break

`lib/status.ts` encodes both, with the reasoning inline:

1. **`ARRIVED_AT_PICKUP` belongs in every active-trip status set.** Omitting it
   made a driver with a rider walking up to their car look free, which is how the
   same vehicle gets dispatched twice. This was a shipped bug.
2. **Settlement is `Booking.paymentStatus === 'PAID'`, never
   `PaymentTransaction.status === 'SUCCESS'`.** EyeGo is cash-majority; a cash
   fare has no successful transaction row, so reading transactions reports a
   fraction of real revenue.

## Accessibility

Skip link, `aria-current="page"` in the nav, real `aria-sort` on sortable tables,
`aria-live` on async results, focus trap and restore in modals, and every chart
paired with an `sr-only` table of the same numbers.
