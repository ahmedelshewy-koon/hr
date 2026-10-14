#!/usr/bin/env bash
# Offline-only validation of the approved SANA HR additive bridge using a
# disposable copy of the verified local backup. Never writes production DB.
set -Eeuo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo "Please run as root" >&2; exit 1; }

CT="sanaa-hr-postgres"
BRIDGE="${1:-}"
[[ -f "$BRIDGE" && -s "$BRIDGE" ]] || { echo "Usage: $0 /path/to/vps-additive-compatibility-bridge.sql" >&2; exit 2; }
[[ -r "$BRIDGE" ]] || exit 2

BACKUP="$(find /root/sanaa-hr-cicd-backups -maxdepth 1 -name 'hr-before-upgrade-*.dump' -type f -printf '%f\n' | sort | tail -n 1)"
[[ -n "$BACKUP" ]] || { echo "No verified HR backup found" >&2; exit 1; }
BACKUP="/root/sanaa-hr-cicd-backups/$BACKUP"

docker exec "$CT" pg_restore --list >/dev/null < "$BACKUP"
docker inspect -f '{{.State.Running}}' "$CT" | grep -qx true
systemctl is-active --quiet sanaa-hr.service
image="$(docker inspect -f '{{.Config.Image}}' "$CT")"
[[ -n "$image" ]] || exit 1

name="sana-hr-bridge-test-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

echo "Starting temporary PostgreSQL instance from production image..."
docker run -d --rm --network none --name "$name" \
  --memory=512m --cpus=1 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=hr_clone \
  "$image" >/dev/null

ready=0
for attempt in {1..30}; do
  if docker exec "$name" pg_isready -q -U postgres -d hr_clone >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 1
done
(( ready )) || { echo "Temporary PostgreSQL did not start" >&2; exit 1; }

echo "Restoring latest HR backup ONLY to the isolated temporary database..."
docker exec -i "$name" pg_restore -U postgres -d hr_clone \
  --no-owner --no-acl --exit-on-error < "$BACKUP"

before="$(docker exec "$name" psql -X -U postgres -d hr_clone -At -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
[[ "$before" == 33 ]] || { echo "Unexpected baseline in backup: $before migrations, require 33" >&2; exit 1; }

echo "Applying proposed additive bridge to disposable database..."
docker exec -i "$name" psql -X -q -U postgres -d hr_clone -v ON_ERROR_STOP=1 < "$BRIDGE"
echo "Reapplying same SQL to test repeat safety..."
docker exec -i "$name" psql -X -q -U postgres -d hr_clone -v ON_ERROR_STOP=1 < "$BRIDGE"

after="$(docker exec "$name" psql -X -U postgres -d hr_clone -At -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
[[ "$after" == "$before" ]] || { echo "Migration ledger modified unexpectedly" >&2; exit 1; }

echo "Checking table/column existence in disposable DB..."
docker exec "$name" psql -X -U postgres -d hr_clone -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT name, to_regclass('public.' || name) IS NOT NULL AS exists
FROM (VALUES ('attendance_ingest_sources'), ('subscription_plans'),
 ('integrations'), ('integration_requests')) t(name);
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='attendance_devices' AND column_name='source_id';
SQL

echo "Checking live HR was not interrupted..."
systemctl is-active --quiet sanaa-hr.service
curl -fsS --max-time 8 -o /dev/null http://127.0.0.1:4050/
echo "STAGING SCHEMA BRIDGE TEST: PASS; production unchanged"
