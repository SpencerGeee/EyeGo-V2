#!/usr/bin/env bash
#
# Nightly Postgres + Redis backup to offsite object storage.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
#
# Production is one box (docs/superpowers/plans/2026-08-31-production-readiness.md
# §2.1). That is the right call — colocating the API with Postgres and Redis is
# what closed a 281 ms per query and 1557 ms per transaction gap — but it means
# one disk holds every trip, every wallet balance and every payout row. A single
# box with no offsite copy is not a deployment, it is a bet.
#
# So: nightly full dump, continuous WAL archiving for point-in-time recovery,
# both encrypted, both offsite. And scripts/ops/restore-drill.sh, which proves
# monthly that what is being written can actually be read back. A backup nobody
# has restored is a hypothesis.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#
#   scripts/ops/backup.sh                 # full dump + prune
#   BACKUP_DRY_RUN=1 scripts/ops/backup.sh
#
# Install as a cron entry on the host:
#
#   15 2 * * *  /srv/eyego/scripts/ops/backup.sh >> /var/log/eyego-backup.log 2>&1
#
# ── REQUIRED ENVIRONMENT ─────────────────────────────────────────────────────
#
#   POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD   as in .env.docker
#   BACKUP_S3_BUCKET      e.g. s3://eyego-backups   (Backblaze B2 and Cloudflare
#                                                    R2 both speak S3; either is
#                                                    far cheaper than S3 itself
#                                                    for this size)
#   BACKUP_ENCRYPTION_KEY passphrase for age/gpg. WITHOUT THIS THE BACKUP IS
#                         PLAINTEXT PII IN SOMEBODY ELSE'S DATACENTRE.
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL
#
set -euo pipefail

: "${POSTGRES_USER:?set POSTGRES_USER}"
: "${POSTGRES_DB:?set POSTGRES_DB}"
: "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
: "${BACKUP_ENCRYPTION_KEY:?refusing to write an unencrypted backup — set BACKUP_ENCRYPTION_KEY}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DRY_RUN="${BACKUP_DRY_RUN:-0}"
run() { if [ "$DRY_RUN" = "1" ]; then echo "DRY RUN: $*"; else "$@"; fi; }

echo "[backup] $STAMP starting"

# ── Postgres ────────────────────────────────────────────────────────────────
#
# --format=custom, not plain SQL: it is compressed, and pg_restore can then
# restore a single table, which is what you want at 3am when one table was
# truncated by mistake and the rest of the database is fine.
#
# Dumped from INSIDE the container. The image's pg_dump always matches the
# server; a host-installed client is a version-skew bug waiting for the next
# major upgrade — pg_dump refuses to dump a server newer than itself.
DUMP="$WORKDIR/eyego-$STAMP.dump"
echo "[backup] dumping postgres"
run docker exec eyego-postgres pg_dump \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  --file=/tmp/backup.dump

run docker cp "eyego-postgres:/tmp/backup.dump" "$DUMP"
run docker exec eyego-postgres rm -f /tmp/backup.dump

# ── Redis ───────────────────────────────────────────────────────────────────
#
# Redis here is NOT a cache: it holds dispatch cascade state, the driver supply
# geo-index and the presence keys. Losing it strands every in-flight search. The
# AOF is the live durability mechanism; this is the offsite copy of it.
echo "[backup] snapshotting redis"
run docker exec eyego-redis redis-cli --no-auth-warning -a "${REDIS_PASSWORD:-}" BGSAVE || \
  echo "[backup] WARNING: redis BGSAVE failed — continuing with the postgres dump"
sleep 5
run docker cp "eyego-redis:/data/dump.rdb" "$WORKDIR/redis-$STAMP.rdb" || \
  echo "[backup] WARNING: no redis dump.rdb to copy"

# ── Encrypt ─────────────────────────────────────────────────────────────────
#
# A database dump is every rider's phone number, every driver's Ghana Card
# number and every trip anyone has taken. Unencrypted in object storage, one
# leaked access key is a data-protection incident with a regulator attached.
echo "[backup] encrypting"
for f in "$WORKDIR"/*; do
  [ -f "$f" ] || continue
  case "$f" in *.age) continue;; esac
  run gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_ENCRYPTION_KEY" \
      --output "$f.gpg" "$f"
  run rm -f "$f"
done

# ── Ship it ─────────────────────────────────────────────────────────────────
echo "[backup] uploading to $BACKUP_S3_BUCKET"
for f in "$WORKDIR"/*.gpg; do
  [ -f "$f" ] || continue
  run aws s3 cp "$f" "$BACKUP_S3_BUCKET/$(date -u +%Y/%m)/$(basename "$f")" \
    ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
done

# ── Prune ───────────────────────────────────────────────────────────────────
#
# Deliberately NOT a lifecycle rule on the bucket. A lifecycle rule that is
# misconfigured deletes silently and you find out when you need the file;
# pruning here is visible in this script's own log.
echo "[backup] pruning older than $RETENTION_DAYS days"
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y-%m-%d)"
run aws s3 ls "$BACKUP_S3_BUCKET" --recursive \
  ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \
  | awk -v cutoff="$CUTOFF" '$1 < cutoff { print $4 }' \
  | while read -r key; do
      [ -n "$key" ] && run aws s3 rm "$BACKUP_S3_BUCKET/$key" \
        ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
    done

echo "[backup] $STAMP done"
