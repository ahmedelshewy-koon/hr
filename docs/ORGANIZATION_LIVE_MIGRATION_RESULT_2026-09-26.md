# Live migration 0030 — execution result

**Succeeded.** Only `0030_organizational_assignments` was applied, committed at **2026-09-26 13:01:04 UTC** (16:01:04 Cairo). No legacy mapping, backfill, reset, cleanup, employee rewrite or Stage 2 operation was run.

## Final preflight

All seven user-required conditions passed:

1. Configured URL and actual connected server both resolved to **127.0.0.1:5545 / koon_hr**, role **koon_hr_admin**.
2. The sole pending migration was **0030_organizational_assignments**. The local migration journal contained exactly 31 entries, ending with 0030.
3. SQL SHA-256 matched **3aa2e4ffdc337c085aa45dac244ae0568b0448515efb02fac90f50364f11446a**.
4. Live journal contained 30 entries; 0030 and all seven new tables were absent.
5. The live schema-only dump matched the schema from the latest successfully rehearsed backup, after excluding dump comments and randomized pg_dump restriction tokens. No concurrent schema difference was found.
6. All original table data matched the latest backup snapshot. No refresh was required. The backup's file hash was revalidated.
7. The approved SQL contains additive DDL only. Execution split and ran that exact file and added its required migration-journal entry; it did not invoke the general migration runner or any application initialization/cleanup command.

Backup: `D:\HR\outputs\organization-implementation\rehearsal-2026-09-26T12-46-06-305Z\pre-organization.dump` (388,958 bytes).

Backup SHA-256: `6c42159401a4ca47a71efa5fadb17fbd356dab9ff905022883896191df3fa284`.

## Execution and preservation

The SQL ran in one transaction with bounded lock/statement timeouts and the application's assignment advisory lock. Existing tables were locked against concurrent writes during preservation verification. The server, original data and journal were rechecked immediately before executing DDL. An integrity or preservation mismatch would have rolled back the transaction.

Fresh read-only verification immediately after commit confirmed:

| Check | Result |
| --- | --- |
| Migration journal | 31 entries; new id 31 has the approved SQL hash and timestamp 1790422744917 |
| Previous migration history | All 30 entries unchanged |
| New tables | All 7 present, each with 0 rows |
| Added columns | All 13 present |
| Existing public tables | All 79 original-column hashes and row counts unchanged |
| Employees | 48, with identical assignments and manager relationships |
| Orphaned company/department/job-title references | 0 / 0 / 0 |
| Missing managers / self-managers / reporting cycles | 0 / 0 / 0 |
| New employee assignment fields | Remain NULL for all 48 employees; no inferred mapping |

New tables: branches, company_branches, hr_responsibility_rules, job_grades, organization_branch_scopes, positions, work_locations.

Added columns: companies(name_ar, name_en, code); departments(company_id, organization_kind, branch_scope); employees(branch_id, section_id, team_id, position_id, grade_id, work_location_id, assignment_effective_date).

The additive `departments.branch_scope` column has its declared default `all`. All pre-existing column values remained unchanged.

## Application health and warnings

- Fresh `npm run build` completed with exit code 0 after migration.
- The existing application at `http://127.0.0.1:3000/` returned HTTP 200 with HTML and no internal-server-error response. No restart was needed for this check.
- Database access and schema queries succeeded in the read-only post-commit transaction.
- Build warnings: some bundles exceed 500 kB; Vinext cannot statically classify some routes; plugin timing advisory. No build failure occurred.
- No unexpected database changes were detected. Authenticated live workflows were not submitted because some existing GET/initialization paths can write balances or authentication state. The startup check was an HTTP page fetch without executing client JavaScript.

## Evidence

- Preflight: `D:\HR\outputs\organization-implementation\live-preflight-2026-09-26T12-59-24-367Z\preflight.json`
- Execution and post-commit table-by-table counts/hashes: `D:\HR\outputs\organization-implementation\live-preflight-2026-09-26T12-59-24-367Z\execution.json`
- Compared schemas: `rehearsal-schema.sql` and `live-schema.sql` in the same evidence directory.
- Build log: `D:\HR\outputs\organization-implementation\post-migration-build.log`

Work stopped after the requested verification. No legacy mapping or Stage 2 cleanup followed.
