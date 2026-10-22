#!/usr/bin/env bash
# HR production preparation. Fail-closed:
#  1. Compare ALL expected 107 tables / 1245 columns against live PostgreSQL.
#  2. Only if differences are the five independently reviewed additive objects,
#     verify a fresh backup and rehearse against a disposable DB clone.
#  3. Apply the same SQL as one transaction to live PostgreSQL.
# Does NOT deploy/restart HR and does NOT touch drizzle migration history.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 2; }
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for file in hr-schema-contract.json hr-schema-audit.sh vps-additive-compatibility-bridge.sql test-vps-bridge-on-clone.sh; do
  [[ -s "$HERE/$file" ]] || { echo "Missing validated input: $file" >&2; exit 1; }
done
systemctl is-active --quiet sanaa-hr.service
[[ "$(docker inspect -f '{{.State.Running}}' sanaa-hr-postgres)" == "true" ]]
pg_restore --version
[[ -s /etc/sanaa-hr/hr.env ]] || { echo "HR environment missing" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "===== COMPARE COMPLETE HR DATABASE CONTRACT ====="
rc=0
bash "$HERE/hr-schema-audit.sh" "$HERE/hr-schema-contract.json" > "$work/schema-before.txt" || rc=$?
cat "$work/schema-before.txt"
[[ "$rc" == 0 || "$rc" == 3 ]] || { echo "Unexpected schema checker error $rc" >&2; exit "$rc"; }
python3 - "$work/schema-before.txt" <<'PY'
import sys
from pathlib import Path
txt=Path(sys.argv[1]).read_text()
tables={x.split(': ',1)[1] for x in txt.splitlines() if x.startswith('MISSING_TABLE: ')}
cols={x.split(': ',1)[1] for x in txt.splitlines() if x.startswith('MISSING_COLUMN: ')}
allowed_tables={'attendance_ingest_sources','subscription_plans','integrations','integration_requests'}
allowed_cols={'attendance_devices.source_id'}
bad_tables=tables-allowed_tables
bad_cols=cols-allowed_cols
if bad_tables or bad_cols:
    print('BLOCKED: Unexpected missing tables or columns; no production modification made')
    print('UNEXPECTED_MISSING_TABLES:', ', '.join(sorted(bad_tables)) or 'none')
    print('UNEXPECTED_MISSING_COLUMNS:', ', '.join(sorted(bad_cols)) or 'none')
    sys.exit(4)
print('COMPATIBILITY_GATE=PASS: only previously reviewed additive objects are absent')
PY
if [[ "$rc" == 0 ]]; then
  echo "No HR schema upgrade required. Production unchanged."
else
  echo "===== REHEARSE BRIDGE ON RESTORED CLONE ====="
  bash "$HERE/test-vps-bridge-on-clone.sh" "$HERE/vps-additive-compatibility-bridge.sql"
  echo "===== NEW VERIFIED PRE-CHANGE PRODUCTION BACKUP ====="
  backup_dir=/root/sanaa-hr-cicd-backups
  install -d -m 0700 "$backup_dir"
  free="$(df -Pk "$backup_dir" | awk 'NR==2{print $4}')"
  (( free > 1048576 )) || { echo "Less than 1GiB free to preserve backup" >&2; exit 1; }
  backup="$backup_dir/hr-before-new-github-release-$(date -u +%Y%m%dT%H%M%SZ).dump"
  docker exec sanaa-hr-postgres pg_dump -U sanaa_hr -d sanaa_hr -Fc --no-owner --no-acl > "$backup"
  [[ -s "$backup" ]] && pg_restore --list "$backup" >/dev/null || { echo "Backup verification failed" >&2; exit 1; }
  chmod 0600 "$backup"
  echo "VERIFIED_BACKUP=$backup"
  echo "===== APPLY VETTED ADDITIVE SQL IN ONE TRANSACTION ====="
  docker exec -i sanaa-hr-postgres psql -X -v ON_ERROR_STOP=1 -U sanaa_hr -d sanaa_hr < "$HERE/vps-additive-compatibility-bridge.sql"
fi

echo "===== VERIFY ENTIRE LIVE HR SCHEMA AGAIN ====="
bash "$HERE/hr-schema-audit.sh" "$HERE/hr-schema-contract.json"
echo "===== VERIFY AUTHENTIC INDEXES ====="
docker exec -i sanaa-hr-postgres psql -X -U sanaa_hr -d sanaa_hr -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_subscription_plans_code')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_integration_requests_integration')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_attendance_ingest_sources_key_hash')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_attendance_devices_source')
 THEN
  RAISE EXCEPTION 'Expected source-defined HR indexes are missing';
 END IF;
END $$;
SQL
echo "===== VERIFY HR AND EXISTING LEDGER ====="
# 33 rows = production's pre-0052 ledger. ops/prod-migration-0052-0054 keeps those rows and records only
# 0052-0054, so afterwards the newest row is this release's last journal entry; that state is accepted too.
ledger="$(docker exec sanaa-hr-postgres psql -X -U sanaa_hr -d sanaa_hr -At -F ' ' -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*), COALESCE(MAX(created_at),0) FROM drizzle.__drizzle_migrations;')"
journal="$HERE/../drizzle-postgres/meta/_journal.json"
release_head=""
[[ -s "$journal" ]] && release_head="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["entries"][-1]["when"])' "$journal")"
[[ "${ledger%% *}" == "33" || ( -n "$release_head" && "${ledger##* }" == "$release_head" ) ]] || { echo "HR migration history changed unexpectedly ($ledger)" >&2; exit 1; }
systemctl is-active --quiet sanaa-hr.service
curl -fsS --max-time 15 -o /dev/null -w 'HR HTTP: %{http_code}\n' http://127.0.0.1:4050/
echo "HR_PRODUCTION_SCHEMA_PREPARED=PASS"
echo "NOTE: New application version has NOT been deployed yet."
