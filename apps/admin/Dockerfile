# The admin console, built for the production box.
#
# Context is the REPO ROOT, not apps/admin — the console imports from
# packages/* through the workspace, so a build context scoped to its own
# directory cannot see its own dependencies.
#
#   docker build -f apps/admin/Dockerfile -t eyego-admin .
#
# Multi-stage so the shipped image carries the built output and the production
# dependency tree, and not the toolchain that produced them.

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /repo

# Manifests only, so this layer is cached until a dependency actually changes.
# Copying the whole tree first would invalidate the install on every source edit
# and turn a 5-second rebuild into a 3-minute one.
COPY package.json package-lock.json* ./
COPY apps/admin/package.json apps/admin/
COPY packages/api/package.json packages/api/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
COPY packages/maps/package.json packages/maps/
COPY packages/map-styles/package.json packages/map-styles/

RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# `next build`, never `next dev`. The console has been tested against a
# production build before and dev masked nothing while costing minutes per page
# — but a dev server in production is also a different application: no route
# prerendering, no minification, and stack traces served to the browser.
WORKDIR /repo/apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /repo/apps/admin

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

# Not root. The console holds the admin session cookie and talks to the API on
# an internal network; there is no reason for it to be able to write to its own
# image.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /repo/apps/admin/.next ./.next
COPY --from=build --chown=nextjs:nodejs /repo/apps/admin/public ./public
COPY --from=build --chown=nextjs:nodejs /repo/apps/admin/package.json ./package.json
COPY --from=build --chown=nextjs:nodejs /repo/apps/admin/next.config.ts ./next.config.ts
COPY --from=build --chown=nextjs:nodejs /repo/node_modules /repo/node_modules

USER nextjs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/login || exit 1

CMD ["npm", "run", "start"]
