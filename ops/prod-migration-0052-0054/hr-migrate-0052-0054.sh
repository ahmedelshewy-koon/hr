#!/usr/bin/env bash
# SANA HR production schema upgrade: migrations 0052 (Timesheet), 0053 (Payroll rebuild), 0054 (deleted-employee email).
# Adds the 27 tables / 22 columns the deploy gate reports missing. See RUNBOOK.md before running anything.
#
#   preflight   read-only: schema gap, guards, impact + HR Manager reports, deployer review, and MIGRATION LINEAGE
#               verification. Exit 4 + ADMIN_ACTION_REPORT.md when the lineage cannot be verified (production unchanged)
#   rehearse    preflight gates, then fresh verified backup -> isolated throwaway PostgreSQL -> full migration,
#               validation, from-scratch catalog comparison, rerun refusal, rollback tests (production unchanged)
#   apply       --rehearsal DIR --deployer-sha256 HASH --confirm APPLY-0052-0054-ON-sanaa_hr [--hr-managers ...]
#               SEPARATE WRITTEN APPROVAL REQUIRED. Verified lineage + attested ledger + approved deployer review only.
#   rollback    --run-dir DIR --confirm ROLLBACK-0052-0054-ON-sanaa_hr
#               logical rollback of an apply run; refused once any object 0052-0054 introduced holds data
# opts: --hr-managers "USER_ID[:Egypt|:KSA],..."  ONLY with written approval of these ids/regions; default: nobody
#       --accept-catalog-drift                     (rehearse: accept objects missing vs a from-scratch build, after review)
# Ledger policy: existing drizzle.__drizzle_migrations rows are never changed or deleted; 0033-0051 are never
# fabricated; only 0052-0054 are recorded, after they ran. The reconciliation is written to hr_ops.migration_audit.
set -Eeuo pipefail
umask 077

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "$HERE/../.." && pwd)"
CT="${HR_PG_CONTAINER:-sanaa-hr-postgres}"
DB="sanaa_hr"
DBU="sanaa_hr"
SVC="sanaa-hr.service"
APP_URL="http://127.0.0.1:4050/"
APP_DIR="/opt/sanaa-hr/app"
DEPLOYER="/usr/local/sbin/sana-hr-deploy"
BACKUP_DIR="/root/sanaa-hr-cicd-backups"
RUN_ROOT="/root/sanaa-hr-migration-runs"
CONFIRM_APPLY="APPLY-0052-0054-ON-$DB"
CONFIRM_ROLLBACK="ROLLBACK-0052-0054-ON-$DB"
MIGRATIONS=(0052_timesheet_management 0053_payroll_rebuild 0054_deleted_employee_email)
REHEARSAL_MAX_AGE_SECONDS=$((24 * 3600))
LINEAGE_EXIT=4

HR_MANAGERS=""
ACCEPT_DRIFT=0
CLONE=""
RUN_DIR=""
SERVICE_STOPPED=0
LINEAGE_JSON=""
DEPLOYER_SHA=""

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "${RUN_DIR:-/dev/null}/run.log" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ---------- database access (prod container, or a database inside the throwaway clone container) ----------
# target: "prod" | "clone:<db>" | "clone-su:<db>" (superuser, only for clone setup)
psql_to() {
  local target="$1"; shift
  case "$target" in
    prod)       docker exec -i "$CT" psql -X -q -v ON_ERROR_STOP=1 -U "$DBU" -d "$DB" "$@" ;;
    clone:*)    docker exec -i "$CLONE" psql -X -q -v ON_ERROR_STOP=1 -U "$DBU" -d "${target#clone:}" "$@" ;;
    clone-su:*) docker exec -i "$CLONE" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "${target#clone-su:}" "$@" ;;
    *) die "unknown target $target" ;;
  esac
}

# Exact row count of every public table (for backup verification).
table_counts() {
  psql_to "$1" -At -F $'\t' -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
}

# Normalized catalog (columns, indexes, constraints, triggers, functions) for from-scratch comparison.
catalog() {
  psql_to "$1" -At <<'SQL'
SELECT 'COL '||table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(replace(regexp_replace(column_default,'nextval\(''[^'']+''::regclass\)','nextval(seq)'),'CURRENT_TIMESTAMP','now()'),'')
FROM information_schema.columns WHERE table_schema='public'
UNION ALL SELECT 'IDX '||tablename||' '||regexp_replace(indexdef,'^CREATE (UNIQUE )?INDEX \S+ ON ','\1')||' AS '||indexname FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'CON '||conrelid::regclass::text||' '||contype::text||' '||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype IN ('p','u','f','c')
UNION ALL SELECT 'TRG '||tgrelid::regclass::text||' '||tgname FROM pg_trigger WHERE NOT tgisinternal
UNION ALL SELECT 'FUN '||proname FROM pg_proc WHERE pronamespace='public'::regnamespace
ORDER BY 1;
SQL
}

# Same comparison as ops/hr-schema-audit.sh, against any target. Exit 0 = complete, 3 = incompatible.
contract_check() {
  local target="$1" out="$2" tsv
  tsv="$(mktemp)"
  psql_to "$target" -At -F $'\t' -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2" > "$tsv"
  python3 -I - "$REPO/ops/hr-schema-contract.json" "$tsv" > "$out" <<'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
live = {}
for line in Path(sys.argv[2]).read_text().splitlines():
    if line.strip():
        t, c = line.split('\t', 1); live.setdefault(t, set()).add(c)
mt = [t['name'] for t in data['tables'] if t['schema'] == 'public' and t['name'] not in live]
mc = [t['name'] + '.' + c for t in data['tables'] if t['schema'] == 'public' and t['name'] in live for c in t['columns'] if c not in live[t['name']]]
print('HR_MISSING_TABLES=%d' % len(mt)); [print('MISSING_TABLE: ' + x) for x in mt]
print('HR_MISSING_COLUMNS_IN_EXISTING_TABLES=%d' % len(mc)); [print('MISSING_COLUMN: ' + x) for x in mc]
print('HR_SCHEMA_STATUS=' + ('INCOMPATIBLE' if mt or mc else 'ALL_EXPECTED_COLUMNS_PRESENT'))
sys.exit(3 if mt or mc else 0)
PY
  local rc=$?; rm -f "$tsv"; return $rc
}

# The gap must be exactly what 0052-0054 add; anything else means production differs from what was reviewed.
expect_reviewed_gap() {
  { grep -E '^MISSING_(TABLE|COLUMN): ' "$1" || true; } | LC_ALL=C sort > "$1.found"
  if [[ ! -s "$1.found" ]]; then
    die "nothing is missing: the schema is already complete (0052-0054 applied?); production unchanged"
  fi
  if ! diff -u "$HERE/expected-missing.txt" "$1.found" > "$1.diff"; then
    cat "$1.diff" >&2
    die "schema gap differs from the reviewed 27 tables / 22 columns (diff above); production unchanged"
  fi
}

# ---------- migration lineage (read-only) ----------
# Dumps the ledger and the 0031-0051 data checks, then classifies them (lineage.mjs). Returns 0 verified, 4 not.
lineage_check() {
  local target="$1" out="$2" discover="${3:-}"
  psql_to "$target" -At -F $'\t' -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id" > "$out/ledger.tsv"
  { echo "BEGIN TRANSACTION READ ONLY;"; cat "$HERE/data-checks.sql"; echo "ROLLBACK;"; } | psql_to "$target" -At -F $'\t' > "$out/data-checks.tsv"
  if [[ -n "$discover" ]]; then node "$HERE/lineage.mjs" discover --ledger "$out/ledger.tsv" --out "$out" >&2 || log "WARNING: journal discovery failed"; fi
  local rc=0
  node "$HERE/lineage.mjs" classify --repo "$REPO" --ledger "$out/ledger.tsv" --data-checks "$out/data-checks.tsv" --out "$out" >&2 || rc=$?
  [[ $rc == 0 || $rc == "$LINEAGE_EXIT" ]] || die "lineage classification failed ($rc)"
  LINEAGE_JSON="$out/lineage.json"
  return "$rc"
}

ledger_fingerprint_of() { node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).fingerprint)' "$1"; }

# ---------- deployer review ----------
# The VPS deployer is not in the repository; deployer-review.json pins the version reviewers examined and their verdict.
deployer_review() {
  if [[ ! -f "$DEPLOYER" ]]; then log "WARNING: $DEPLOYER not found; apply cannot be approved until it is located and reviewed"; return 0; fi
  DEPLOYER_SHA="$(sha256sum "$DEPLOYER" | cut -d' ' -f1)"
  echo "$DEPLOYER_SHA" > "$RUN_DIR/deployer.sha256"
  install -m 0600 "$DEPLOYER" "$RUN_DIR/deployer.copy"
  grep -nE -C3 'drizzle|migrat|ledger|__drizzle|schema|audit|prepare|psql|pg_|33' "$DEPLOYER" > "$RUN_DIR/deployer-excerpt.txt" || true
  local pinned status
  pinned="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha256||"")' "$HERE/deployer-review.json")"
  status="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status||"")' "$HERE/deployer-review.json")"
  if [[ "$DEPLOYER_SHA" == "$pinned" ]]; then
    log "deployer sha256=$DEPLOYER_SHA matches the pinned version; review status: $status"
  else
    log "ATTENTION: deployer sha256=$DEPLOYER_SHA differs from the pinned $pinned (status $status): the deployer changed; it must be reviewed again"
  fi
  if grep -qE 'drizzle-kit|db:migrate|migrate\(' "$DEPLOYER"; then
    log "ATTENTION: the deployer appears to run Drizzle migrations; with production's ledger head (2026-10-07) that would apply 0054 and skip 0052/0053"
  fi
}

deployer_approved_for() {
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(r.status==="approved"&&r.sha256===process.argv[2]?0:1)' "$HERE/deployer-review.json" "$1"
}

# ---------- SQL streams ----------
hr_managers_sql() {
  # Prints SQL seeding hr_managers from --hr-managers; sets nothing when empty.
  local spec="$1" item uid region n=0
  declare -A order=()
  local values=() ids=()
  IFS=',' read -r -a items <<< "$spec"
  for item in "${items[@]}"; do
    item="${item// /}"; [[ -z "$item" ]] && continue
    [[ "$item" =~ ^([0-9]+)(:(Egypt|KSA))?$ ]] || die "bad --hr-managers item '$item' (use USER_ID or USER_ID:Egypt / USER_ID:KSA)"
    uid="${BASH_REMATCH[1]}"; region="${BASH_REMATCH[3]:-}"
    local key="${region:-ALL}"; order[$key]=$(( ${order[$key]:--1} + 1 ))
    values+=("($uid, $([[ -n "$region" ]] && echo "'$region'" || echo NULL), ${order[$key]}, 1)")
    ids+=("$uid"); n=$((n + 1))
  done
  echo "\\set hr_manager_count $n"
  (( n == 0 )) && return 0
  [[ "$(printf '%s\n' "${ids[@]}" | sort -u | wc -l)" == "$n" ]] || die "--hr-managers lists a user twice"
  local idlist; idlist="$(IFS=,; echo "${ids[*]}")"
  cat <<SQL
SELECT count(*) <> $n AS hr_bad FROM users WHERE id IN ($idlist) AND status = 'active' \\gset
\\if :hr_bad
  DO \$\$ BEGIN RAISE EXCEPTION 'GUARD: --hr-managers contains a missing or inactive user'; END \$\$;
\\endif
INSERT INTO hr_managers (user_id, region, admin_order, is_active) VALUES
$(IFS=$'\n'; printf '%s\n' "${values[@]}" | paste -sd, -);
SELECT string_agg(u.id || ' ' || u.email || ' role=' || coalesce(r.name, '?'), '; ') AS hr_seeded FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id IN ($idlist) \\gset
\\echo HR_MANAGERS_SEEDED=:hr_seeded
SQL
}

migration_stream() {
  # $1 = COMMIT | ROLLBACK. Needs LINEAGE_JSON (verified classification) and RUN_DIR.
  echo "BEGIN;"
  echo "SET LOCAL search_path TO public;"
  echo "SET LOCAL lock_timeout = '10s';"
  echo "SET LOCAL statement_timeout = '15min';"
  cat "$HERE/expected-ledger.sql"
  node "$HERE/lineage.mjs" psql-vars --repo "$REPO"
  echo "\\set hr_check_ledger true"
  cat "$HERE/guards.sql" "$HERE/fingerprint-begin.sql"
  for m in "${MIGRATIONS[@]}"; do echo "\\echo HR_APPLYING $m"; cat "$REPO/drizzle-postgres/$m.sql"; echo; done
  hr_managers_sql "$HR_MANAGERS"
  cat "$HERE/ledger-record.sql" "$HERE/audit.sql"
  node "$HERE/lineage.mjs" audit-sql --lineage "$LINEAGE_JSON" --run-id "$(basename "$RUN_DIR")" --package "$(package_fingerprint)" --deployer "${DEPLOYER_SHA:-unknown}"
  cat "$HERE/validate.sql" "$HERE/fingerprint-end.sql"
  echo "$1;"
}

run_preflight_sql() {
  { echo "BEGIN TRANSACTION READ ONLY;"; cat "$HERE/expected-ledger.sql"; echo "\\set hr_check_ledger false"
    cat "$HERE/guards.sql" "$HERE/report.sql"
    echo "\\echo ===== HR MANAGER ACCESS (report only - nothing is assigned; full table in hr-manager-access.csv) ====="
    echo "\\x on"; cat "$HERE/hr-manager-access.sql"; echo "\\x off"; echo "ROLLBACK;"; } | psql_to "$1"
}

hr_manager_access_csv() {
  { echo "BEGIN TRANSACTION READ ONLY;"; cat "$HERE/hr-manager-access.sql"; echo "ROLLBACK;"; } | psql_to "$1" --csv
}

run_validate_sql() {
  { echo "BEGIN TRANSACTION READ ONLY;"; cat "$HERE/expected-ledger.sql"
    hr_managers_sql "$HR_MANAGERS" | grep '^\\set hr_manager_count'; cat "$HERE/validate.sql"; echo "ROLLBACK;"; } | psql_to "$1"
}

run_migration() {
  # $1 target, $2 log file, $3 COMMIT|ROLLBACK
  migration_stream "$3" | psql_to "$1" 2>&1 | grep -v 'NOTICE: ' | tee "$2"
  return "${PIPESTATUS[1]}"
}

# Before the migration: pre-apply ids and original index definitions, as psql \set lines.
capture_rollback_pre() {
  local target="$1" out="$2"
  psql_to "$target" -At <<'SQL' > "$out"
SELECT '\set perm_max_id ' || coalesce(max(id), 0) FROM permissions;
SELECT '\set dr_max_id ' || coalesce(max(id), 0) FROM deduction_rules;
SELECT '\set ledger_pre_max_id ' || coalesce(max(id), 0) FROM drizzle.__drizzle_migrations;
SELECT '\set orig_runs_idx ' || quote_literal(coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payroll_runs_month_year_country'), ''));
SELECT '\set orig_email_idx ' || quote_literal((SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_work_email'));
SELECT '\set wf_was_not_null ' || CASE WHEN is_nullable = 'NO' THEN 'true' ELSE 'false' END FROM information_schema.columns
 WHERE table_schema='public' AND table_name='approval_workflow_runs' AND column_name='workflow_id';
SQL
  grep -q '\\' <(grep orig_ "$out" | cut -d' ' -f3-) && die "index definition contains a backslash; rollback capture unsafe"
  grep -c '^\\set ' "$out" | grep -qx 6 || die "rollback capture incomplete: $out"
}

# Right after COMMIT (no writers): the baseline state of every object 0052-0054 introduced.
capture_rollback_baseline() {
  local target="$1" vars="$2" line
  line="$({ echo "BEGIN;"; cat "$vars" "$HERE/rollback-baseline.sql"
            echo "SELECT format('\\set rb_baseline %s', quote_literal(:'hr_rb_state')) WHERE :hr_rb_parts = 30;"; echo "ROLLBACK;"; } | psql_to "$target" -At)"
  [[ "$line" =~ ^\\set\ rb_baseline\ \'[a-z_:=/\;0-9a-f]+\'$ ]] || die "rollback baseline capture failed"
  echo "$line" >> "$vars"
}

run_rollback_sql() {
  # $1 target, $2 vars file (pre + baseline), $3 run id
  { echo "BEGIN;"; echo "SET LOCAL search_path TO public;"; echo "SET LOCAL lock_timeout = '10s';"
    cat "$HERE/expected-ledger.sql"; node "$HERE/lineage.mjs" psql-vars --repo "$REPO"; cat "$2"
    echo "\\set rollback_run_id '$3'"
    awk -v inc="$HERE/rollback-baseline.sql" '$0 == "\\i_rollback_baseline" { while ((getline l < inc) > 0) print l; next } { print }' "$HERE/rollback-template.sql"
    echo "COMMIT;"; } | psql_to "$1" 2>&1 | grep -v 'NOTICE: '
  return "${PIPESTATUS[1]}"
}

# ---------- host checks, backup, throwaway clone ----------
verify_files() {
  ( cd "$REPO" && sha256sum --quiet -c "$HERE/files.sha256" ) || die "release files differ from the reviewed hashes in files.sha256"
  for f in expected-ledger.sql guards.sql report.sql hr-manager-access.sql data-checks.sql fingerprint-begin.sql fingerprint-end.sql \
           ledger-record.sql audit.sql validate.sql rollback-baseline.sql rollback-template.sql expected-missing.txt lineage.mjs \
           known-migration-versions.json ledger-attestations.json deployer-review.json; do
    [[ -s "$HERE/$f" ]] || die "missing $HERE/$f"
  done
}

package_fingerprint() {
  cat "$HERE/files.sha256" "$HERE"/*.sql "$HERE"/*.mjs "$HERE"/*.json "$HERE/expected-missing.txt" "${BASH_SOURCE[0]}" | sha256sum | cut -d' ' -f1
}

host_checks() {
  [[ $EUID -eq 0 ]] || die "run as root"
  for cmd in docker python3 node sha256sum systemctl curl; do command -v "$cmd" >/dev/null || die "$cmd not found"; done
  node -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)' || die "node 18 or newer is required"
  [[ "$(docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null)" == true ]] || die "container $CT is not running"
  install -d -m 0700 "$BACKUP_DIR" "$RUN_ROOT"
  local free; free="$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $4}')"
  (( free > 2097152 )) || die "less than 2 GiB free in $BACKUP_DIR"
  log "service $SVC: $(systemctl is-active "$SVC" || true)"
  if [[ -s /etc/sanaa-hr/hr.env ]]; then
    local url_user; url_user="$(sed -n 's#^DATABASE_URL=["'\'']\{0,1\}postgres[a-z]*://\([^:@/]*\).*#\1#p' /etc/sanaa-hr/hr.env | head -n1)"
    [[ -z "$url_user" || "$url_user" == "$DBU" ]] || log "WARNING: the app connects as '$url_user', not '$DBU'; new tables will be owned by $DBU - grant access before deploying"
  fi
  if [[ -d "$APP_DIR" ]]; then
    if grep -rqs --include='*.js' portal_session_activity "$APP_DIR/dist" 2>/dev/null; then
      log "NOTE: the currently deployed app already knows portal_session_activity: users are logged out as soon as 0053 commits."
    else
      log "NOTE: the currently deployed app does not use portal_session_activity: users are logged out when the new release starts."
    fi
  fi
}

take_backup() {
  # $1 label; prints the verified dump path
  local file="$BACKUP_DIR/hr-before-0052-0054-$1-$(date -u +%Y%m%dT%H%M%SZ).dump"
  docker exec "$CT" pg_dump -U "$DBU" -d "$DB" -Fc --no-owner --no-acl > "$file"
  [[ -s "$file" ]] || die "backup is empty: $file"
  docker exec -i "$CT" pg_restore --list < "$file" > "$file.toc" || die "backup TOC unreadable: $file"
  sha256sum "$file" > "$file.sha256"
  chmod 0600 "$file" "$file.toc" "$file.sha256"
  echo "$file"
}

start_clone() {
  local image; image="$(docker inspect -f '{{.Config.Image}}' "$CT")"
  CLONE="sana-hr-mig-$$"
  docker run -d --rm --network none --name "$CLONE" --memory=1g --cpus=1 -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
  local i; for i in $(seq 1 60); do docker exec "$CLONE" pg_isready -q -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$CLONE" pg_isready -q -U postgres || die "throwaway PostgreSQL did not start"
  # Same non-superuser owner as production, so privilege problems surface here, not on production.
  psql_to clone-su:postgres -c "CREATE ROLE $DBU LOGIN NOSUPERUSER NOCREATEROLE" >/dev/null
  log "throwaway PostgreSQL $CLONE started from $image (no network)"
}

stop_clone() { [[ -n "$CLONE" ]] && docker rm -f "$CLONE" >/dev/null 2>&1 || true; CLONE=""; }

restore_into_clone() {
  # $1 db name, $2 dump file
  psql_to clone-su:postgres -c "CREATE DATABASE $1 OWNER $DBU" >/dev/null
  docker exec -i "$CLONE" pg_restore -U "$DBU" -d "$1" --no-owner --no-acl --exit-on-error < "$2"
}

build_reference() {
  # From-scratch database built from all 55 migrations, in journal order, one transaction each.
  psql_to clone-su:postgres -c "CREATE DATABASE hr_reference OWNER $DBU" >/dev/null
  local tag
  for tag in $(python3 -I -c "import json,sys; [print(e['tag']) for e in json.load(open(sys.argv[1]))['entries']]" "$REPO/drizzle-postgres/meta/_journal.json" | tr -d '\r'); do
    psql_to clone:hr_reference --single-transaction < "$REPO/drizzle-postgres/$tag.sql" >/dev/null 2>&1 || die "reference build failed at $tag"
  done
}

new_run_dir() { RUN_DIR="$RUN_ROOT/$1-$(date -u +%Y%m%dT%H%M%SZ)"; install -d -m 0700 "$RUN_DIR"; }

# Read-only gates shared by preflight, rehearse and apply. Sets LINEAGE_OK=1 when the lineage is verified.
production_gates() {
  deployer_review
  log "migration lineage (read-only): ledger, journal discovery, data checks of unrecorded migrations"
  LINEAGE_OK=1; lineage_check prod "$RUN_DIR" discover || LINEAGE_OK=0
  log "contract audit (read-only)"
  contract_check prod "$RUN_DIR/contract-before.txt" || true
  grep -E '^HR_' "$RUN_DIR/contract-before.txt" >&2
  expect_reviewed_gap "$RUN_DIR/contract-before.txt"
  log "guards + impact report (READ ONLY transaction)"
  run_preflight_sql prod > "$RUN_DIR/preflight.txt"
  grep -q '^HR_GUARDS=PASS' "$RUN_DIR/preflight.txt" || die "guards failed (preflight.txt)"
  hr_manager_access_csv prod > "$RUN_DIR/hr-manager-access.csv"
}

lineage_stop() {
  log "LINEAGE=UNVERIFIED: the production migration history cannot be verified with the committed evidence."
  log "Nothing was changed. Read $RUN_DIR/ADMIN_ACTION_REPORT.md, collect the evidence it lists, and send this run directory."
  exit "$LINEAGE_EXIT"
}

# ---------- phases ----------
cmd_preflight() {
  new_run_dir preflight; verify_files; host_checks
  production_gates
  cat "$RUN_DIR/preflight.txt"
  (( LINEAGE_OK )) || lineage_stop
  log "PREFLIGHT=PASS (lineage verified)  results: $RUN_DIR  (production unchanged)"
}

cmd_rehearse() {
  new_run_dir rehearse; verify_files; host_checks
  trap 'stop_clone' EXIT
  production_gates
  (( LINEAGE_OK )) || lineage_stop
  local prod_lineage="$LINEAGE_JSON"

  log "1/8 fresh backup of production (pg_dump, online snapshot)"
  local backup; backup="$(take_backup rehearsal)"; log "backup: $backup ($(du -h "$backup" | cut -f1))"
  table_counts prod > "$RUN_DIR/counts-prod.tsv"

  log "2/8 restore into throwaway PostgreSQL and verify the backup"
  start_clone
  restore_into_clone hr_clone "$backup"
  table_counts clone:hr_clone > "$RUN_DIR/counts-clone.tsv"
  [[ "$(cut -f1 "$RUN_DIR/counts-prod.tsv")" == "$(cut -f1 "$RUN_DIR/counts-clone.tsv")" ]] || die "restored backup has a different table list"
  diff "$RUN_DIR/counts-prod.tsv" "$RUN_DIR/counts-clone.tsv" > "$RUN_DIR/counts.diff" \
    && log "backup restore verified: identical row counts in $(wc -l < "$RUN_DIR/counts-prod.tsv") tables" \
    || log "backup restore verified; row counts moved in $(grep -c '^>' "$RUN_DIR/counts.diff") table(s) due to live traffic (see counts.diff)"
  contract_check clone:hr_clone "$RUN_DIR/contract-clone-before.txt" || true
  expect_reviewed_gap "$RUN_DIR/contract-clone-before.txt"
  mkdir -p "$RUN_DIR/clone-lineage"
  lineage_check clone:hr_clone "$RUN_DIR/clone-lineage" || die "the restored clone's lineage does not verify (clone-lineage/)"
  [[ "$(ledger_fingerprint_of "$RUN_DIR/clone-lineage/lineage.json")" == "$(ledger_fingerprint_of "$prod_lineage")" ]] || die "clone ledger differs from production's"
  LINEAGE_JSON="$prod_lineage"

  log "3/8 apply 0052-0054 in one transaction on the clone"
  capture_rollback_pre clone:hr_clone "$RUN_DIR/rollback-vars.sql"
  run_migration clone:hr_clone "$RUN_DIR/migration-clone.log" COMMIT || die "migration failed on the clone (see migration-clone.log); production unchanged"
  contract_check clone:hr_clone "$RUN_DIR/contract-clone-after.txt" || die "contract still incomplete on clone"
  run_validate_sql clone:hr_clone > "$RUN_DIR/validate-clone.txt"; grep -q '^HR_VALIDATION=PASS' "$RUN_DIR/validate-clone.txt" || die "post-commit validation failed on clone"

  log "4/8 compare with a from-scratch build of all 55 migrations"
  build_reference
  catalog clone:hr_clone > "$RUN_DIR/catalog-clone.txt"; catalog clone:hr_reference > "$RUN_DIR/catalog-reference.txt"
  comm -23 "$RUN_DIR/catalog-reference.txt" "$RUN_DIR/catalog-clone.txt" > "$RUN_DIR/catalog-missing-on-production.txt"
  comm -13 "$RUN_DIR/catalog-reference.txt" "$RUN_DIR/catalog-clone.txt" > "$RUN_DIR/catalog-extra-on-production.txt"
  log "objects only in production lineage (informational): $(wc -l < "$RUN_DIR/catalog-extra-on-production.txt")"
  if [[ -s "$RUN_DIR/catalog-missing-on-production.txt" ]]; then
    cat "$RUN_DIR/catalog-missing-on-production.txt" >&2
    if [[ "$ACCEPT_DRIFT" != 1 ]]; then
      die "objects defined by 0000-0054 are missing on production (above). Send this run to the developers; re-run with --accept-catalog-drift only after their review"
    fi
    log "WARNING: catalog drift accepted with --accept-catalog-drift (reviewed)"
  fi

  log "5/8 rerun must be refused"
  if run_migration clone:hr_clone "$RUN_DIR/rerun-clone.log" COMMIT >/dev/null 2>&1; then die "a second run was not refused"; fi
  grep -q 'state=APPLIED' "$RUN_DIR/rerun-clone.log" || die "second run failed for an unexpected reason (rerun-clone.log)"

  log "6/8 rollback test on a second restore (clean case must succeed)"
  restore_into_clone hr_rollback "$backup"
  catalog clone:hr_rollback > "$RUN_DIR/catalog-rollback-before.txt"; table_counts clone:hr_rollback > "$RUN_DIR/counts-rollback-before.tsv"
  capture_rollback_pre clone:hr_rollback "$RUN_DIR/rollback-vars-test.sql"
  run_migration clone:hr_rollback "$RUN_DIR/migration-rollback-db.log" COMMIT >/dev/null || die "migration failed on rollback test db"
  capture_rollback_baseline clone:hr_rollback "$RUN_DIR/rollback-vars-test.sql"
  run_rollback_sql clone:hr_rollback "$RUN_DIR/rollback-vars-test.sql" rehearsal > "$RUN_DIR/rollback-test.log" || die "rollback test failed (rollback-test.log)"
  catalog clone:hr_rollback > "$RUN_DIR/catalog-rollback-after.txt"; table_counts clone:hr_rollback > "$RUN_DIR/counts-rollback-after.tsv"
  diff "$RUN_DIR/catalog-rollback-before.txt" "$RUN_DIR/catalog-rollback-after.txt" > "$RUN_DIR/rollback-catalog.diff" || die "rollback did not restore the original schema (rollback-catalog.diff)"
  diff "$RUN_DIR/counts-rollback-before.tsv" "$RUN_DIR/counts-rollback-after.tsv" > /dev/null || die "rollback did not restore original row counts"

  log "7/8 rollback must be refused once a new table holds data (portal_session_activity)"
  restore_into_clone hr_rollback_unsafe "$backup"
  capture_rollback_pre clone:hr_rollback_unsafe "$RUN_DIR/rollback-vars-unsafe.sql"
  run_migration clone:hr_rollback_unsafe "$RUN_DIR/migration-rollback-unsafe.log" COMMIT >/dev/null || die "migration failed on unsafe rollback test db"
  capture_rollback_baseline clone:hr_rollback_unsafe "$RUN_DIR/rollback-vars-unsafe.sql"
  psql_to clone:hr_rollback_unsafe -c "INSERT INTO portal_session_activity (token_hash, user_id) SELECT 'rehearsal-probe', min(id) FROM users" >/dev/null
  if run_rollback_sql clone:hr_rollback_unsafe "$RUN_DIR/rollback-vars-unsafe.sql" rehearsal > "$RUN_DIR/rollback-unsafe-test.log"; then die "rollback was NOT refused with data in portal_session_activity"; fi
  grep -q 'ROLLBACK REFUSED' "$RUN_DIR/rollback-unsafe-test.log" || die "unsafe rollback failed for an unexpected reason (rollback-unsafe-test.log)"

  log "8/8 write rehearsal result"
  cat > "$RUN_DIR/REHEARSAL_RESULT" <<EOF
RESULT=PASS
TIMESTAMP=$(date -u +%s)
PACKAGE_FINGERPRINT=$(package_fingerprint)
LEDGER_FINGERPRINT=$(ledger_fingerprint_of "$prod_lineage")
HR_MANAGERS=$HR_MANAGERS
DEPLOYER_SHA256=${DEPLOYER_SHA:-missing}
BACKUP=$backup
EOF
  log "REHEARSAL=PASS  results: $RUN_DIR  (production unchanged)"
  log "Send the whole run directory for approval (it holds no database dump; the backup stays in $BACKUP_DIR)"
}

restore_service() {
  if (( SERVICE_STOPPED )); then
    log "starting $SVC again"; systemctl start "$SVC" || log "WARNING: could not start $SVC - start it manually"
    SERVICE_STOPPED=0
  fi
  stop_clone
}

cmd_apply() {
  local rehearsal="$1" confirm="$2" deployer_sha="$3"
  [[ "$confirm" == "$CONFIRM_APPLY" ]] || die "confirmation must be exactly --confirm $CONFIRM_APPLY"
  new_run_dir apply; verify_files; host_checks
  [[ -f "$DEPLOYER" ]] || die "$DEPLOYER not found; the deployer must be reviewed before apply"
  [[ "$deployer_sha" =~ ^[0-9a-f]{64}$ ]] || die "--deployer-sha256 <hash of the reviewed deployer> is required"
  [[ "$(sha256sum "$DEPLOYER" | cut -d' ' -f1)" == "$deployer_sha" ]] || die "$DEPLOYER differs from the reviewed version; review the current one first"
  deployer_approved_for "$deployer_sha" || die "deployer-review.json does not record an approved review of $deployer_sha"
  local r="$rehearsal/REHEARSAL_RESULT"
  [[ -s "$r" ]] || die "no rehearsal result at $r"
  grep -qx 'RESULT=PASS' "$r" || die "rehearsal did not pass"
  grep -qx "PACKAGE_FINGERPRINT=$(package_fingerprint)" "$r" || die "package changed since the rehearsal; rehearse again"
  grep -qx "HR_MANAGERS=$HR_MANAGERS" "$r" || die "--hr-managers differs from the rehearsal"
  grep -qx "DEPLOYER_SHA256=$deployer_sha" "$r" || die "the deployer changed since the rehearsal; rehearse again"
  local age=$(( $(date -u +%s) - $(sed -n 's/^TIMESTAMP=//p' "$r") ))
  (( age < REHEARSAL_MAX_AGE_SECONDS )) || die "rehearsal is older than 24h; rehearse again"

  production_gates
  (( LINEAGE_OK )) || lineage_stop
  grep -qx "LEDGER_FINGERPRINT=$(ledger_fingerprint_of "$LINEAGE_JSON")" "$r" || die "production's ledger changed since the rehearsal; rehearse again"

  trap 'restore_service' EXIT
  log "1/7 stopping $SVC (maintenance window starts)"
  systemctl stop "$SVC"; SERVICE_STOPPED=1
  local i others=1
  for i in $(seq 1 30); do
    others="$(psql_to prod -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")"
    [[ "$others" == 0 ]] && break; sleep 1
  done
  if [[ "$others" != 0 ]]; then
    psql_to prod -c "SELECT pid, usename, application_name, client_addr, state FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'" >&2
    die "other clients are still connected (above); stop them and retry"
  fi

  log "2/7 final backup with no writers, verified by a full restore"
  local backup; backup="$(take_backup final)"; log "backup: $backup"
  table_counts prod > "$RUN_DIR/counts-prod.tsv"
  start_clone; restore_into_clone hr_verify "$backup"; table_counts clone:hr_verify > "$RUN_DIR/counts-restored.tsv"; stop_clone
  diff "$RUN_DIR/counts-prod.tsv" "$RUN_DIR/counts-restored.tsv" > "$RUN_DIR/counts.diff" || die "final backup restore differs from production (counts.diff)"
  echo "$backup" > "$RUN_DIR/BACKUP"
  log "backup verified: identical row counts in $(wc -l < "$RUN_DIR/counts-prod.tsv") tables"

  log "3/7 capturing pre-apply rollback information"
  capture_rollback_pre prod "$RUN_DIR/rollback-vars.sql"

  log "4/7 applying 0052-0054 on production in ONE transaction"
  if ! run_migration prod "$RUN_DIR/migration.log" COMMIT; then
    die "migration transaction failed and was rolled back; production schema unchanged (see $RUN_DIR/migration.log)"
  fi
  grep -q '^HR_DATA_PRESERVATION=PASS' "$RUN_DIR/migration.log" || die "COMMIT happened without the data check marker - investigate $RUN_DIR/migration.log"
  echo "$HR_MANAGERS" > "$RUN_DIR/HR_MANAGERS"

  log "5/7 capturing the rollback baseline (HR still stopped)"
  capture_rollback_baseline prod "$RUN_DIR/rollback-vars.sql"

  log "6/7 post-commit validation"
  run_validate_sql prod > "$RUN_DIR/validate.txt" || true
  contract_check prod "$RUN_DIR/contract-after.txt" || true
  grep -q '^HR_VALIDATION=PASS' "$RUN_DIR/validate.txt" && grep -q 'ALL_EXPECTED_COLUMNS_PRESENT' "$RUN_DIR/contract-after.txt" \
    || die "post-commit validation failed (validate.txt / contract-after.txt). See RUNBOOK 'Recovery'."

  log "7/7 restarting $SVC (current release) and running the official gate"
  restore_service
  for i in $(seq 1 30); do curl -fsS --max-time 5 -o /dev/null "$APP_URL" && break; sleep 2; done
  curl -fsS --max-time 10 -o /dev/null -w 'HR HTTP %{http_code}\n' "$APP_URL" || log "WARNING: HR did not answer on $APP_URL"
  bash "$REPO/ops/hr-schema-audit.sh" "$REPO/ops/hr-schema-contract.json" | tee "$RUN_DIR/official-audit.txt" | grep '^HR_SCHEMA_STATUS' >&2 || true
  log "APPLY=COMPLETE  run dir: $RUN_DIR  backup: $backup"
  log "Next: re-run the production deployment only if approved. Users must sign in again. HR manager assignment is a separate, approved step."
}

cmd_rollback() {
  local dir="$1" confirm="$2"
  [[ "$confirm" == "$CONFIRM_ROLLBACK" ]] || die "confirmation must be exactly --confirm $CONFIRM_ROLLBACK"
  [[ -s "$dir/rollback-vars.sql" && -s "$dir/BACKUP" ]] || die "$dir is not a completed apply run"
  grep -q '^\\set rb_baseline ' "$dir/rollback-vars.sql" || die "$dir has no rollback baseline; use the backup restore procedure"
  new_run_dir rollback; verify_files; host_checks
  trap 'restore_service' EXIT
  log "1/3 stopping $SVC"; systemctl stop "$SVC"; SERVICE_STOPPED=1
  log "2/3 safety backup of the current (post-0052) state"
  local backup; backup="$(take_backup pre-rollback)"; log "backup: $backup"
  log "3/3 logical rollback in ONE transaction (refused if any new object holds data)"
  run_rollback_sql prod "$dir/rollback-vars.sql" "$(basename "$RUN_DIR")" | tee "$RUN_DIR/rollback.log" \
    || die "rollback refused or failed and was rolled back; schema unchanged (rollback.log). Use the verified backup restore procedure (RUNBOOK section 7)."
  restore_service
  log "ROLLBACK=COMPLETE. The deployed release must be the pre-0052 version."
}

main() {
  local cmd="${1:-}"; shift || true
  local rehearsal="" confirm="" rundir="" deployer_sha=""
  while (( $# )); do
    case "$1" in
      --hr-managers) HR_MANAGERS="${2:-}"; shift 2 ;;
      --deployer-sha256) deployer_sha="${2:-}"; shift 2 ;;
      --accept-catalog-drift) ACCEPT_DRIFT=1; shift ;;
      --rehearsal) rehearsal="${2:-}"; shift 2 ;;
      --confirm) confirm="${2:-}"; shift 2 ;;
      --run-dir) rundir="${2:-}"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  hr_managers_sql "$HR_MANAGERS" > /dev/null   # validate the spec early
  case "$cmd" in
    preflight) cmd_preflight ;;
    rehearse)  cmd_rehearse ;;
    apply)     cmd_apply "$rehearsal" "$confirm" "$deployer_sha" ;;
    rollback)  cmd_rollback "$rundir" "$confirm" ;;
    *) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 2 ;;
  esac
}

# Sourcing the file (tests) loads the functions without running anything.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
