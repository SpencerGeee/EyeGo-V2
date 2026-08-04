# Dev setup — Neon (Postgres) + Upstash (Redis)

No installs, no admin rights, no reboot. About five minutes.

> **PowerShell note:** this shell is PowerShell 5.1, which does **not** support
> `&&`. Use `;` to chain, or just run the commands on separate lines.
> `cd eyego-api && npm run dev` is a parser error here; `cd eyego-api; npm run dev`
> is not.

---

## 1. Postgres — Neon

1. Go to **https://neon.tech** and sign up (GitHub login is fastest).
2. Create a project. Name it `eyego`, region **AWS eu-central-1 (Frankfurt)** —
   it is the closest Neon region to Ghana, so dev queries are ~150ms rather
   than ~350ms from us-east.
3. On the project dashboard, open **Connection string**. You need **two** of
   them, and the difference matters:
   - **Pooled** (the default; host contains `-pooler`) → `DATABASE_URL`
   - **Direct** (toggle *Connection pooling* **off**) → `DIRECT_URL`

   Why both: the pooled endpoint runs PgBouncer in transaction mode, which
   cannot execute the session-level statements a migration needs. Prisma uses
   `DIRECT_URL` for `migrate` and `DATABASE_URL` for everything else. Giving it
   only the pooled URL produces a "prepared statement already exists" error
   that looks like a schema bug and is not one.

Both strings already end in `?sslmode=require`. Keep that.

## 2. Redis — Upstash

1. Go to **https://upstash.com** and sign up.
2. **Create Database** → type **Redis** → region **eu-central-1** (match Neon).
   Leave *Eviction* **off** — dispatch state and payment locks must not be
   evicted under memory pressure.
3. Open the database → **Connect** → copy the **`rediss://`** URL (note the
   double `s`; it is TLS). That is `REDIS_URL`.

Upstash's free tier is fine for development: it supports the GEO commands the
driver supply index uses and the pub/sub the Socket.IO adapter needs. It does
not support blocking commands, and this codebase does not use any.

## 3. Put them in `.env`

Edit `eyego-api/.env`:

```
DATABASE_URL="postgresql://...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://....eu-central-1.aws.neon.tech/neondb?sslmode=require"
REDIS_URL="rediss://default:XXXX@eu2-xxxx.upstash.io:6379"
```

Keep the quotes — the passwords contain characters PowerShell would otherwise
try to interpret.

## 4. Create the schema and start

```powershell
cd "C:\Users\user\Downloads\Projects\EyeGo V2\eyego-api"
node node_modules/prisma/build/index.js migrate dev --name canonical-trip
node node_modules/prisma/build/index.js generate
npm run dev
```

`npx` is broken in this workspace — always call the binaries through
`node node_modules/...` as above.

## 5. Check it actually works

```powershell
Invoke-RestMethod http://localhost:5020/health
Invoke-RestMethod http://localhost:5020/health/dispatch
```

`/health/dispatch` is the one that matters. It should return `healthy: true`
with `scheduledTasks.overdue = 0`. If `overdue` climbs above zero, the durable
timer worker is not draining — offer timeouts and request expiries are not
firing, and riders will strand mid-search.

On a healthy start the log shows, in order:

```
Database connected
Redis connected
ScheduledTask worker started (w-#####, sleeps until due, idle cap 15000ms)
Trip health monitor started (every 60000ms)
Socket.io server initialized
EyeGo API running on port 5020
```

If Redis is unreachable the process **exits** rather than starting — that is
deliberate. Redis holds dispatch state, the driver supply index, the Socket.IO
adapter and the payment locks; the old in-memory fallback made a Redis-less
deploy look healthy while silently voiding the payment double-charge lock.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `prepared statement "s0" already exists` | `DIRECT_URL` is missing or is the pooled URL. Use the non-pooled one. |
| `Environment variable not found: DIRECT_URL` | Set it. On a non-pooled Postgres, set it equal to `DATABASE_URL`. |
| Process exits with `FATAL: Redis ... did not answer PING` | Wrong `REDIS_URL`, or you copied the `https://` REST URL instead of the `rediss://` one. |
| `ERR unknown command 'GEOSEARCH'` | Database was created as something other than Upstash Redis. |
| Neon says "compute suspended" on first request | Free tier scales to zero; the first query after ~5 min idle takes a few seconds. Normal. |
