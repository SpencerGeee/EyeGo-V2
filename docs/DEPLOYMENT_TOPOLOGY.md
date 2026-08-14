# Where the database goes, and why it is the whole latency story

Measured from the dev machine on 2026-08-14, against the current setup
(Neon `eu-central-1`, Frankfurt):

| | |
|---|---|
| One simple query | **281 ms** |
| One 4-query interactive transaction | **1557 ms** |
| Redis ping | **282 ms** |

`applyTransition` — the thing that runs on every status change — is a 4-query
interactive transaction. So a single "driver accepted" costs ~1.5 seconds of
pure network before any logic executes. A trip request chains several of those.
That is the entire "why is it so slow" question, and none of it is code.

---

## First, correct the framing

Two things are commonly assumed here and both are wrong.

**"Host all three apps on the server."** The rider and driver apps are React
Native — they ship to the App Store and Play Store and run on phones. They are
never hosted on your server. Only **the API** and **the admin console** (Next.js)
are server-side. Nothing you do to the server makes the mobile apps' own code
faster.

**"Put the database close to Ghana."** Closer than Frankfurt, yes — but that is
the smaller half. Count the round trips in one user action:

```
phone -> API          1 round trip
API   -> database     4 to 10 round trips
```

The API↔database hop is where the multiplier is. Getting those two into the same
place matters roughly ten times more than getting the database near Ghana. So
the rule is:

> Choose where the **API** will live. Put Postgres and Redis in exactly that
> place. Then, separately, prefer a location that is also near your users.

---

## Recommended: run Postgres and Redis on the VPS itself

This is the best option, and the codebase already supports it with no changes.

| | Round trip | One 4-query transaction |
|---|---|---|
| Today (Frankfurt) | 281 ms | 1557 ms |
| Managed, same region as API | ~1–5 ms | ~10–25 ms |
| **Same host (loopback)** | **~0.05–0.2 ms** | **~1–3 ms** |

Loopback is not "a faster network", it is *no network* — the kernel hands the
bytes over without a NIC involved. That is why it is another order of magnitude
below same-region managed hosting.

### Do NOT build from source

Cloning the Postgres and Redis git repos and compiling them buys you nothing and
costs you the security-update path. Both are already optimised; a from-source
build is not faster in any way you will measure. Use the distribution packages
or the official Docker images.

### docker-compose.yml

Put this next to the API on the VPS. Note `127.0.0.1` in both port bindings —
that is what stops the database being reachable from the public internet, which
is the single most common way a self-hosted database gets ransomwared.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: eyego
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: eyego
    # Bound to loopback ONLY. Never publish 5432 to 0.0.0.0.
    ports: ["127.0.0.1:5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    command: >
      postgres
      -c shared_buffers=512MB
      -c effective_cache_size=1536MB
      -c max_connections=100
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U eyego"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports: ["127.0.0.1:6379:6379"]
    volumes:
      - redisdata:/data
    # appendonly: dispatch state lives in Redis (cascade state, the supply geo
    # index, presence keys). A restart that loses it strands every in-flight
    # search, so it is worth the write amplification.
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --appendfsync everysec
      --maxmemory-policy noeviction
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

`maxmemory-policy noeviction` is deliberate: the default (`noeviction` is
already the Redis default, but hosted providers often change it) means Redis
refuses writes rather than silently evicting. An evicted presence key or cascade
state is a rider stranded on a spinner — you want the loud failure.

### .env on the VPS

```bash
# No pooler in front of a local Postgres, so both point at the same place —
# exactly what the note in prisma/schema.prisma describes.
DATABASE_URL="postgresql://eyego:${POSTGRES_PASSWORD}@127.0.0.1:5432/eyego"
DIRECT_URL="postgresql://eyego:${POSTGRES_PASSWORD}@127.0.0.1:5432/eyego"

# redis:// (not rediss://) is correct on loopback — there is no network segment
# to encrypt. src/config/redis.js only demands TLS for hosted hostnames.
REDIS_URL="redis://default:${REDIS_PASSWORD}@127.0.0.1:6379"
```

### What you are taking on

This is the real price, and it is not the setup — it is the operations:

- **Backups.** Neon does them for you; a VPS does not. `pg_dump` on a cron, and
  the dump must go **off the VPS** (S3, Backblaze, anywhere else). A disk
  failure with only local backups is an extinction event for the business.
- **No point-in-time recovery** unless you configure WAL archiving.
- **No failover.** One VPS is one point of failure.
- **You patch it.** Postgres and Redis security updates are now your job.

A minimum viable backup, on the VPS crontab:

```bash
0 */6 * * * docker exec postgres pg_dump -U eyego eyego | gzip > /backups/eyego-$(date +\%Y\%m\%d-\%H).sql.gz
# ...then rclone/aws s3 sync /backups to somewhere that is not this machine.
```

---

## If you stay on Neon + Upstash: **London (eu-west-2)** for both

From the region lists available to you:

- **Neon** → `AWS Europe West 2 (London)`
- **Upstash** → `London, UK (eu-west-2)`

Reasons, in order:

1. **It matches where the API should live.** Hostinger offers a London VPS, so
   all three land in one metro and the API↔DB hop collapses to single-digit ms.
2. **West African subsea cables land in Europe.** The cables serving Ghana —
   WACS, MainOne, Glo-1, ACE, SAT-3, Equiano — run up the Atlantic coast and
   terminate in Portugal, France and the UK. London is therefore one of the
   best-connected destinations from Accra.
3. **Cape Town is a trap.** Upstash offers `af-south-1`, and it looks closer on
   a map. In practice a great deal of Accra↔Johannesburg/Cape Town traffic is
   still routed *via Europe*, so it is frequently slower and always less
   predictable than London. Neon does not offer it at all, so choosing it for
   Redis would split your two datastores across continents — the worst outcome.
4. **Do not accept the US East default.** Ohio/N. Virginia is roughly 100 ms
   further from Ghana than London, on every single round trip.

Verify rather than trust the above — from the VPS you are about to buy:

```bash
# Run this from the VPS, not your laptop. The number that matters is the one
# between the API and the database.
ping -c 20 <neon-host>
```

### One non-obvious Upstash point

Your screenshot is the **"Add/remove read regions"** panel of a Global database.
Read replicas will not help you. EyeGo's Redis traffic on the hot path is
**writes** — `GEOADD` on every driver location ping, `SET` on every presence
key, the dispatch cascade state. Writes always go to the **primary** region. So
the setting that matters is where the primary is, not how many read regions you
add.

---

## Can I guarantee it will be faster?

Split the honest answer in two.

**Guaranteed, because it is arithmetic, not prediction.** The 281 ms is
round-trip network time to Frankfurt. Remove the distance and that number is
gone — it is not an efficiency that might or might not materialise. A 4-query
transaction currently spends ~1.5 s waiting on the wire; on loopback it spends
~1–3 ms. Request-to-dispatch-offer, measured at ~14 s, drops below 1 s.

**Not guaranteed, and no region change can fix it.** The phone→API hop remains.
From a Ghanaian mobile network to London that is realistically 100–200 ms, and
it is paid once per user action. So the floor for "rider taps, driver sees" is
roughly:

```
~150 ms  phone -> API
~5 ms    all database work
~150 ms  API -> driver phone (socket push)
--------
~300 ms  end to end
```

Three hundred milliseconds reads as instant. Several seconds does not. That is
the change you are buying.

Two things outside this document also affect perceived speed and are already
fixed in code: the dispatch cascade no longer runs inside the HTTP request, and
`trip:seat_update` now carries the booking rows so the driver app stops
refetching what the socket already delivered.

---

## Migrating off Neon

No schema changes, no code changes — the connection strings are the only thing
that moves.

```bash
# 1. Dump from Neon. Use the DIRECT (non-pooled) URL: pg_dump needs session-level
#    statements that a transaction-mode pooler cannot run.
pg_dump --no-owner --no-privileges --format=custom \
  "postgresql://…@ep-….neon.tech/neondb?sslmode=require" \
  -f eyego-backup.dump

# 2. Bring the new stack up, then create the schema from Prisma rather than
#    restoring it. Migration history stays authoritative this way.
cd eyego-api && npx prisma migrate deploy

# 3. Restore DATA only, on top of the schema Prisma just created.
pg_restore --data-only --disable-triggers --no-owner \
  -d "postgresql://eyego:…@127.0.0.1:5432/eyego" eyego-backup.dump

# 4. Verify before cutting over. Row counts on the tables that matter.
psql "$DATABASE_URL" -c 'SELECT
  (SELECT count(*) FROM "Trip")    AS trips,
  (SELECT count(*) FROM "Booking") AS bookings,
  (SELECT count(*) FROM "Driver")  AS drivers,
  (SELECT count(*) FROM "User")    AS users;'
```

Do this during a quiet window with the API stopped, or bookings written during
the dump will be lost. Redis needs no migration at all — it holds only live
dispatch state, which rebuilds itself from the next driver ping.
