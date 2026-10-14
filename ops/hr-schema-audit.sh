#!/usr/bin/env bash
# Compare actual live public tables/columns to the exact source Drizzle contract.
# Read-only SQL: no migrations, updates, restarts or accounts accessed.
set -Eeuo pipefail
umask 077

[[ "$EUID" == 0 && "$#" -eq 1 ]] || { echo "Usage as root: hr-schema-audit /path/to/hr-schema-contract.json" >&2; exit 2; }
contract="$1"
[[ -s "$contract" ]] || { echo "Schema contract absent" >&2; exit 1; }
ct="sanaa-hr-postgres"
docker inspect -f '{{.State.Running}}' "$ct" | grep -qx true
systemctl is-active --quiet sanaa-hr.service

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

docker exec "$ct" psql -X -U sanaa_hr -d sanaa_hr -At -F $'\t' -v ON_ERROR_STOP=1 -c "
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, column_name;
" > "$tmp/live.tsv"

python3 - "$contract" "$tmp/live.tsv" <<'PY'
import json, sys
from pathlib import Path
data=json.loads(Path(sys.argv[1]).read_text())
assert data['schema_version']=='hr-vps-contract-v1'
assert len(data['tables'])>=100
live={}
for line in Path(sys.argv[2]).read_text().splitlines():
    if not line.strip(): continue
    tbl,col=line.split('\t',1)
    live.setdefault(tbl,set()).add(col)
missing_tables=[]
missing_cols=[]
for table in data['tables']:
    if table['schema']!='public':
        continue
    name=table['name']
    if name not in live:
        missing_tables.append(name)
    else:
        for col in table['columns']:
            if col not in live[name]:
                missing_cols.append(name+'.'+col)
print('HR_EXPECTED_TABLES='+str(len(data['tables'])))
print('HR_EXPECTED_COLUMNS='+str(sum(len(t['columns']) for t in data['tables'])))
print('HR_EXISTING_PUBLIC_TABLES='+str(len(live)))
print('HR_MISSING_TABLES='+str(len(missing_tables)))
for name in missing_tables:
    print('MISSING_TABLE: '+name)
print('HR_MISSING_COLUMNS_IN_EXISTING_TABLES='+str(len(missing_cols)))
for name in missing_cols:
    print('MISSING_COLUMN: '+name)
if missing_tables or missing_cols:
    print('HR_SCHEMA_STATUS=INCOMPATIBLE (read-only audit; production unchanged)')
    sys.exit(3)
print('HR_SCHEMA_STATUS=ALL_EXPECTED_COLUMNS_PRESENT')
PY
