# Deploy runbook — bare VPS to live

_Draft, 2026-08-31. Assumes the credentials in `01-credentials-checklist.md`
exist. Follow it top to bottom the first time; after that only §6 matters._

---

## 0. The shape

One box. API, Postgres and Redis together, Caddy in front, admin console
alongside.

```
            :443 Caddy
              ├── api.eyego.app   -> api:5020
              ├── admin.eyego.app -> admin:4000
              └── eyego.app       -> static + /join, /track
                       │
                api ──┴── postgres:5432   (loopback only)
                      └── redis:6379      (loopback only)
```

Colocation is the point. The API talking to a database in another region cost
281 ms per query and 1557 ms per transaction; on loopback it is ~0.1 ms. Nothing
in this document is worth as much as keeping those three on one machine.

---

## 1. Prepare the box

```bash
# Docker, and nothing else that listens.
curl -fsSL https://get.docker.com | sh

# Only 22, 80 and 443. Postgres and Redis bind to 127.0.0.1 in the compose file
# already — this is the second lock on that door, not the first.
ufw default deny incoming
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable

# Unattended security updates. The box will outlive everyone's attention span.
apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

Create a deploy user; do not run any of this as root beyond the above.

---

## 2. DNS first

Point `api`, `admin`, `eyego.app` and `www` at the box **before** the first
`docker compose up`. Caddy requests certificates on boot, and Let's Encrypt
rate-limits five failures per domain per week — a wrong record can cost you a
week.

Verify: `dig +short api.eyego.app` returns the box IP.

---

## 3. Configuration

```bash
git clone <repo> /srv/eyego && cd /srv/eyego
cp .env.docker.example .env.docker      # POSTGRES_PASSWORD, REDIS_PASSWORD
cp eyego-api/.env.example eyego-api/.env
```

Fill `eyego-api/.env` from the credentials checklist. Then check the things
that fail loudly rather than quietly:

- `NODE_ENV=production`
- `PAYMENT_PROVIDER=paystack` — the API **refuses to boot** on `mock`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — 32+ chars, and not the example
- `EYEGO_ADMIN_LEGACY_SECRET` — **must be unset.** The console refuses it in
  production; it makes every admin action unattributable
- `CORS_ALLOWED_ORIGINS=https://admin.eyego.app,https://eyego.app`

Edit `deploy/Caddyfile` and replace the domains and the ACME email.

---

## 4. Bring up the stateful half and migrate

```bash
docker compose --env-file .env.docker up -d postgres redis
docker compose --env-file .env.docker ps          # both healthy?
```

Migrations are an **explicit step**, deliberately not part of container start.
Two replicas booting at once both race for the migration lock, and a bad
migration should fail a deploy step you can stop at rather than take the API
down.

```bash
cd eyego-api
npm ci
node node_modules/prisma/build/index.js migrate deploy
node node_modules/prisma/build/index.js generate    # a stale client 500s every
                                                    # trip endpoint at once
cd ..
```

---

## 5. Bring up everything else

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.docker up -d --build
```

Watch the first boot:

```bash
docker compose logs -f api | head -50
```

You are looking for:

- `EyeGo API running on port 5020 (production)`
- **`[safety] SOS alerting is NOT reaching anyone by SMS`** — expected on a
  fresh box. It clears once `SOS_ONCALL_PHONES` is set in the console. Do not
  take a real ride before it does.

Then:

```bash
curl -sS https://api.eyego.app/health          # {"status":"ok"}
curl -sS https://api.eyego.app/health/dispatch # healthy:true
```

---

## 6. Every deploy after the first

```bash
cd /srv/eyego && git pull

# Migrate BEFORE the new image runs. Prisma migrations here are additive; if one
# ever is not, take a manual dump first (§7) — a rollback of a destructive
# migration is a restore, not a `git revert`.
cd eyego-api && node node_modules/prisma/build/index.js migrate deploy && cd ..

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.docker up -d --build api admin

docker compose logs --tail=30 api
```

Rollback is `git checkout <previous>` and the same command. That works because
migrations are additive; it stops working the moment one is not.

---

## 7. Backups — do this on day one, not day thirty

```bash
crontab -e
15 2 * * *  cd /srv/eyego && ./scripts/ops/backup.sh >> /var/log/eyego-backup.log 2>&1
```

Then **prove it**, before you need it:

```bash
./scripts/ops/restore-drill.sh
```

It downloads the newest backup, decrypts it, restores into a throwaway
container and checks the row counts are not absurd. Run it monthly from CI. A
backup nobody has restored is a hypothesis — and the failure that hurts is not
the missing backup, it is the one that uploaded successfully for eight months
and cannot be read back.

**Keep `BACKUP_ENCRYPTION_KEY` in a password manager, not only on the box.** A
key that exists solely on the machine the backup protects you from losing is
not a backup.

---

## 8. Watch

Minimum viable alerting — an alert nobody receives is a log line.

| Check | Threshold |
|---|---|
| `GET /health` | non-200 for 2 minutes |
| `GET /health/dispatch` | `healthy:false` |
| Disk | >80% |
| Memory | >90% |
| Container restarts | more than 2 in 10 minutes |
| Backup log | no success line in 26 hours |

`/health` is deliberately cheap and does not touch the database, so it stays
answerable when Postgres is the thing that is unwell. `/health/dispatch` is the
one that hits the database and reports whether rides can actually be matched.

---

## 9. When it goes wrong

**Roll back the app:** `git checkout <sha>` then §6.

**Stop new work without stopping trips in progress:** set `bookingEnabled` and
`driverOnlineEnabled` to false in the console. Rides already running must be
allowed to finish; cutting them off mid-journey is worse than whatever you are
fixing.

**A bad build already in the stores:** set `MIN_SUPPORTED_VERSION_RIDER` or
`..._DRIVER` above it. Writes from older builds get 426 and a blocking upgrade
screen; reads keep working so someone mid-ride still sees their driver.

**Restore:** stop the API, `pg_restore` the newest dump into a fresh database,
repoint `DATABASE_URL`, start. Expect ~30 minutes. Practise it once before you
need it.

---

## Known gaps at first launch

Stated plainly so nobody discovers them at 3am:

- **No HA.** One box. A hardware failure is a restore, not a failover.
- **RPO is one night** until WAL archiving is added. The nightly dump is the
  recovery point; work since the last one is lost.
- **No Sentry in the admin console** — needs `npm i @sentry/nextjs`.
- **No metrics endpoint or dashboard yet.** The health endpoints and the log are
  the whole observability story on day one.
