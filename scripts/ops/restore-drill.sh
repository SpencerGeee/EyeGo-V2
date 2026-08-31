#!/usr/bin/env bash
#
# Restore the latest backup into a throwaway container and check it is real.
#
# ── WHY ──────────────────────────────────────────────────────────────────────
#
# A backup nobody has restored is a hypothesis. The failure mode is not "the
# backup is missing" — that gets noticed. It is the backup that has been
# uploading successfully for eight months and cannot be read back, because the
# encryption passphrase rotated, or the dump was truncated by a disk that
# filled, or the Postgres major version moved and the archive no longer loads.
# Every one of those is silent until the day it matters.
#
# So this runs monthly, from CI, against a container that is destroyed
# afterwards. It never touches production.
#
#   scripts/ops/restore-drill.sh
#
# Exit code 0 means: the newest backup downloaded, decrypted, restored into a
# clean Postgres, and the row counts in it are not absurd.
#
set -euo pipefail

: "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY}"

DRILL_CONTAINER="eyego-restore-drill"
DRILL_PORT="${DRILL_PORT:-55432}"
WORKDIR="$(mktemp -d)"

cleanup() {
  echo "[drill] cleaning up"
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "[drill] finding the newest backup"
LATEST="$(aws s3 ls "$BACKUP_S3_BUCKET" --recursive \
  ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \
  | grep -E 'eyego-.*\.dump\.gpg$' | sort | tail -1 | awk '{print $4}')"

if [ -z "$LATEST" ]; then
  echo "[drill] FAIL: no backup found in $BACKUP_S3_BUCKET"
  exit 1
fi
echo "[drill] newest is $LATEST"

# A backup that exists but is a week old is its own kind of failure: it means
# the nightly job has been dead for a week and nobody noticed.
BACKUP_DATE="$(echo "$LATEST" | grep -oE '[0-9]{8}T[0-9]{6}Z' | head -1 | cut -c1-8)"
TODAY="$(date -u +%Y%m%d)"
AGE_DAYS="$(( ( $(date -u -d "$TODAY" +%s 2>/dev/null || date -u -j -f %Y%m%d "$TODAY" +%s) \
              - $(date -u -d "$BACKUP_DATE" +%s 2>/dev/null || date -u -j -f %Y%m%d "$BACKUP_DATE" +%s) ) / 86400 ))"
echo "[drill] backup is ${AGE_DAYS} day(s) old"
if [ "$AGE_DAYS" -gt 2 ]; then
  echo "[drill] FAIL: newest backup is stale — the nightly job is not running"
  exit 1
fi

echo "[drill] downloading and decrypting"
aws s3 cp "$BACKUP_S3_BUCKET/$LATEST" "$WORKDIR/backup.dump.gpg" \
  ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
  --output "$WORKDIR/backup.dump" "$WORKDIR/backup.dump.gpg"

# Same major version as production. pg_restore will not load an archive from a
# newer server, and the root docker-compose.yml pins 18 for exactly this reason.
echo "[drill] starting a throwaway postgres"
docker run -d --name "$DRILL_CONTAINER" \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_USER=drill \
  -e POSTGRES_DB=drill \
  -p "127.0.0.1:$DRILL_PORT:5432" \
  postgres:18-alpine >/dev/null

echo "[drill] waiting for it to accept connections"
for i in $(seq 1 60); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U drill -d drill >/dev/null 2>&1; then break; fi
  sleep 1
  if [ "$i" = "60" ]; then echo "[drill] FAIL: drill postgres never became ready"; exit 1; fi
done

echo "[drill] restoring"
docker cp "$WORKDIR/backup.dump" "$DRILL_CONTAINER:/tmp/backup.dump"
# --no-owner: the production role does not exist in the drill container, and a
# restore that fails on ownership tells you nothing about whether the DATA is
# intact, which is the only question being asked here.
docker exec "$DRILL_CONTAINER" pg_restore \
  --username=drill --dbname=drill --no-owner --no-privileges \
  /tmp/backup.dump 2>&1 | tail -5 || true

# ── Is what came back actually a database? ──────────────────────────────────
#
# Table presence AND row counts. A dump can restore cleanly and be empty — that
# is what a truncated upload looks like on the way back in.
echo "[drill] checking the restored data"
FAIL=0
check_table() {
  local table="$1" min="$2"
  local n
  n="$(docker exec "$DRILL_CONTAINER" psql -U drill -d drill -tAc \
        "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "ERR")"
  if [ "$n" = "ERR" ]; then
    echo "[drill]   FAIL  $table — table missing from the restore"
    FAIL=1
  elif [ "$n" -lt "$min" ]; then
    echo "[drill]   FAIL  $table — $n rows, expected at least $min"
    FAIL=1
  else
    echo "[drill]   ok    $table — $n rows"
  fi
}

# PlatformSetting is the honest canary: it is always populated on a live system
# and it is small, so a zero here means the dump is empty rather than that the
# platform is quiet.
check_table "PlatformSetting" 1
check_table "User" 0
check_table "Driver" 0
check_table "Trip" 0
check_table "Booking" 0

if [ "$FAIL" -ne 0 ]; then
  echo "[drill] FAILED — the backup restored but does not look like the production database"
  exit 1
fi

echo "[drill] PASS — $LATEST restored and verified"
