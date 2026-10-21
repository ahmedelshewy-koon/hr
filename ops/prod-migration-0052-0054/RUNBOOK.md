# SANA HR production schema upgrade: migrations 0052–0054

**Audience:** the administrator of the HR VPS (`209.42.23.12`).
**Status:** prepared and rehearsed against a copy of real HR data. **Not run on production.**

> **Stage 1 (now):** validate the environment, take a verified backup and run the isolated rehearsal. Then send the results back.
> **Stage 2 (later, only after written approval):** `apply`.
> Until then: no production database changes, no permission changes, no deployment.

## 1. Why this is needed

The deploy of the Payroll & Timesheet release was blocked by the schema gate (`ops/hr-schema-audit.sh`) with **27 missing tables** and **22 missing columns**. All 49 come from three migrations that were never applied to production:

| Migration | Adds |
|---|---|
| `0052_timesheet_management` | 9 tables: `timesheets`, `timesheet_edit_permissions`, `timesheet_month_locks`, `payroll_variable_entries`, `payroll_month_locks`, `shift_plans`, `shift_plan_details`, `shift_assignments`, `company_wfh_days`. 5 columns: `employees.attendance_type_id`, `employees.shift_plan_id`, `holidays.religion`, `attendance_types.early_exit_allowance_minutes`, `attendance_types.weekend_days` |
| `0053_payroll_rebuild` | 18 tables: `business_units`, `business_unit_cost_center_mapping`, `payroll_currencies`, `hr_managers`, `hr_manager_business_units`, `payroll_elements`, `payroll_element_eligibility`, `payroll_employee_elements`, `request_escalations`, `payroll_run_lines`, `payroll_erp_settings`, `payroll_erp_invoice_attempts`, `payroll_erp_reconciliations`, `employee_wfh_days`, `wfh_sessions`, `saved_attendance`, `user_permissions`, `portal_session_activity`. 17 columns: `employees.working_business_unit_id`, `.termination_date`, `.dopay_employee_number`, and 14 on `payroll_runs` (currency, totals, confirmation, accounting and ERP tracking) |
| `0054_deleted_employee_email` | No new objects. Rebuilds `idx_employees_work_email` so that deleted employees no longer reserve their e-mail address |

The **two columns that were not obvious** are `attendance_types.early_exit_allowance_minutes` and `attendance_types.weekend_days`: 0052 adds them to a table that already exists. The exact expected gap is pinned in `expected-missing.txt`. The script refuses to run if production's gap differs from it by even one item.

## 2. What the script does

`hr-migrate-0052-0054.sh` has four modes. Each one writes its logs and evidence to `/root/sanaa-hr-migration-runs/<mode>-<timestamp>/`.

| Mode | Touches production? | What it does |
|---|---|---|
| `preflight` | Read-only | Checks file hashes, the schema gap, the guards and the migration history. Prints the **impact report** and the **HR Manager access report** (also saved as CSV). Saves a copy, the sha256 and relevant excerpts of the VPS deployer for review |
| `rehearse` | Read-only (`pg_dump`) | Everything `preflight` does. Then takes a fresh backup and restores it into a **throwaway PostgreSQL container with no network**, using the same image and the same non-superuser owner as production. There it applies the full migration and validates it, compares the result with a from-scratch build of all 55 migrations, checks that a second run is refused, and checks that rollback works |
| `apply` | **Yes. Stage 2 only** | Requires all of: a passing rehearsal less than 24 hours old with identical package files; `--deployer-sha256` matching the deployer version the reviewers approved; and a typed confirmation. Stops HR, takes a final backup and verifies it by restoring it, applies everything in **one transaction**, validates, restarts HR and runs the official gate |
| `rollback` | **Yes** | Logical rollback of one `apply` run. Refuses if the new tables or columns already hold data |

### Safeguards inside the single transaction

1. **Guards** (`guards.sql`):
   - none of the 49 objects may exist yet;
   - the prerequisite tables and indexes exist;
   - no duplicate `payroll_runs` periods and no duplicate active work e-mails (either would break the new unique indexes);
   - the migrating user owns the altered tables;
   - the migration history is exactly 0000–0032.
2. **Data-preservation fingerprint.** Before any DDL runs, every existing table is hashed: row count plus an md5 over every row, using only the columns that existed before. After the migrations it is hashed again. If any existing row was changed or deleted, or rows appeared anywhere except the seeds the migrations are expected to add (`permissions`, `deduction_rules`), the whole transaction is rolled back.
3. **The three migration files, byte for byte** as committed. Their sha256 values are pinned in `files.sha256`.
4. **Migration history** reconciled to 0054 (section 5). No HR manager is assigned unless `--hr-managers` is given; that option needs separate written approval.
5. **Validation** (`validate.sql`): the 27 tables, 22 columns, 26 indexes, trigger and seed rows, and the history. Only then `COMMIT`.

Rehearsed on a copy of real HR data (107 tables, 5,695 rows), the transaction took about 2 seconds.

## 3. Stage 1: validate, back up, rehearse, report

Run everything as root on the VPS. **None of these steps changes production.**

**Step 0: get the reviewed files.** Use a Linux checkout of the commit named in the approval request (PR branch `ops/prod-migration-0052-0054`). Don't copy the files from a Windows machine: line-ending changes break the pinned hashes, and the script will refuse to run.

```bash
cd /root && git clone https://github.com/ahmedelshewy-koon/hr.git hr-migration && cd hr-migration
git checkout <commit from the approval request>
sha256sum --quiet -c ops/prod-migration-0052-0054/files.sha256 && echo FILES-OK
S=ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh
```

**Step 1: validate the environment** (read-only):

```bash
bash "$S" preflight
```

The run must end with `PREFLIGHT=PASS`.

**Step 2: verified backup and isolated rehearsal** (read-only; about 2–5 minutes). Run it **without** `--hr-managers`:

```bash
bash "$S" rehearse
```

The run must end with `REHEARSAL=PASS`. If it stops at step 4/7 with objects "missing on production", production differs from what the migration files define. Send the run directory as it is. Do not use `--accept-catalog-drift`.

**Step 3: send the results for approval.** Send the rehearsal run directory, `/root/sanaa-hr-migration-runs/rehearse-<ts>/`. It contains no database dump. The important files are:

| File | Reviewers check |
|---|---|
| `run.log`, `REHEARSAL_RESULT` | Every step passed; the backup path; the package fingerprint |
| `preflight.txt` | Guards, impact report, approval-routing counts, deduction-rule seeding, other connections |
| `hr-manager-access.csv` | Every HR Manager account and its expected access (section 6.1) |
| `deployer.sha256`, `deployer-excerpt.txt` (and `deployer.copy` if it holds no secrets) | Whether the VPS deployer is compatible with the 55-row history (section 5) |
| `migration-clone.log`, `validate-clone.txt`, `contract-clone-after.txt` | The migration, data-preservation and validation results on the clone |
| `catalog-missing-on-production.txt` (must be empty), `catalog-extra-on-production.txt` | Comparison with the from-scratch build |
| `rollback-test.log` | The rollback test |
| `counts.diff` | Live traffic during the backup (informational) |

Keep the backup it made (`/root/sanaa-hr-cicd-backups/hr-before-0052-0054-rehearsal-<ts>.dump` and its `.sha256`), and copy it off the server.

## 4. Stage 2: apply (only after written approval)

The approval must name:
- the commit;
- the approved deployer sha256;
- the maintenance window;
- whether any HR managers are to be assigned, and which ones. The default is none.

Then:
1. Announce the window: about 15 minutes of HR downtime, and everyone must sign in again.
2. If the rehearsal is more than 24 hours old, run `bash "$S" rehearse` again.
3. Apply:

   ```bash
   bash "$S" apply --rehearsal /root/sanaa-hr-migration-runs/rehearse-<ts> \
     --deployer-sha256 <approved hash> --confirm APPLY-0052-0054-ON-sanaa_hr
   ```

   It must end with `APPLY=COMPLETE`, and the official gate must print `HR_SCHEMA_STATUS=ALL_EXPECTED_COLUMNS_PRESENT`.
4. Re-run the deployment only if the approval covers it. In GitHub Actions that is *Deploy HR to production (gated)*.
5. Smoke test: sign in as Super Admin, open Timesheet, Payroll and Employees, and submit one leave request.

## 5. Migration history (`drizzle.__drizzle_migrations`)

Production's history has 33 rows (0000–0032). However, the schema of 0033–0051 is already present: it was applied outside Drizzle, partly through the additive bridge. The package **always** records 0033–0054, so the history matches the schema. There is no option to skip this.

- **Why:** Drizzle applies every migration whose journal timestamp is newer than the **latest** recorded `created_at`. The row count doesn't matter; the latest timestamp does. Tested with Drizzle's real migrator on the rehearsal copy:
  - **History left at 33:** the next `drizzle-kit migrate` replays 0033 and fails with `column "nationality_country" … already exists`. Every future migration is blocked.
  - **History reconciled to 55:** a test migration 0055 applied on its own, as intended.
- Each row gets the file's sha256 and its journal timestamp, exactly as Drizzle writes them. The rows are recorded inside the migration transaction, and only after the rehearsal confirms the restored production copy matches a from-scratch build of all 55 migrations. On the local copy the only difference was an extra unique key on `system_settings`, which is harmless.
- **VPS deployer compatibility** (`/usr/local/sbin/sana-hr-deploy`, not in the repository). `preflight` and `rehearse` save its sha256, a copy and the relevant excerpts. Reviewers must confirm that it doesn't require exactly 33 history rows and doesn't call anything that does. `apply` runs only against that exact reviewed version. If the deployer needs a change, that change is reviewed and approved first, and then the rehearsal is run again.
- **`ops/hr-production-prepare.sh`** (the old bridge script) used to require exactly 33 rows. This PR changes it to also accept the reconciled history when it exactly matches the release's journal (row count and latest timestamp). So a deployer that still calls it keeps working after `apply`.
- Five of the existing 0000–0032 rows have hashes that differ from the current files. Drizzle doesn't use hashes, so this is informational only.

## 6. Effects on people and requests

### 6.1 HR Manager accounts (report only; nothing is assigned)

`preflight` writes `hr-manager-access.csv` with one row per account that has the HR Manager role:
- account status, last login, data scope and linked employee;
- payroll country, read from the stored `salary_country` only, as the app does;
- the number of role grants today;
- the **expected access after the migration while unassigned**;
- **eligibility if assigned**. An account without a linked active employee can get access but cannot be an approver.

Expected access for an HR Manager **not listed** in `hr_managers`:
- **blocked (403):** Timesheet, the Payroll pages, Saved Attendance and Vacation Setup;
- **Super Admin only:** salary and payroll-setup edits;
- **unchanged:** every other HR page (role permissions as today).

Putting accounts into `hr_managers` is a **separate decision requiring written approval** that names user ids and regions. It is done either under Payroll → HR Manager Setup after the deploy, or with `--hr-managers` on an approved apply.

### 6.2 Approval routing

This PR also changes the application. Until at least one HR manager is assigned, the new release **keeps the current approval routing**:
- requests with no applicable workflow keep the legacy manager/HR path;
- configured workflows behave as today.

Without this change, the moment the `hr_managers` table existed, requests from employees with no workflow would have been forced into a manager → HR chain. They would have failed with "approver unavailable" whenever the employee has no manager account. Unit tests cover the three states: table missing, table empty, and managers assigned.

- **Requests already in progress:** unaffected. Their route is stored with each request (`preflight` counts them).
- **Unavoidable once HR managers are assigned** (separate approval):
  - for employees with a payroll country, the HR step of new requests goes to the regional HR managers;
  - where no workflow applies, new requests get a manager → HR chain.

  `preflight` gives counts of employees in each group. On the local copy: 22 would get the default chain, 20 would have their HR step routed regionally, and 4 have no payroll country and stay as they are.
- Configuring company workflows, or linking HR managers to employees, before that approval minimizes the change.

### 6.3 Other effects

| Effect | Who | When |
|---|---|---|
| Signed out once ("Session idle timeout") | Everyone | When an app version that knows `portal_session_activity` runs against the new schema. `preflight` says whether the current release already does |
| New role page grants (90 rows) | Super Admin and HR Manager **roles** get `timesheetManagement` plus view/edit on 19 payroll/attendance pages. These rows come **from migrations 0052/0053 themselves**; they are part of what is approved for `apply` | At COMMIT |
| Two absence deduction rules created (1 and 2 days of wage) | Only if production has no active absence rule (`preflight` reports this) | At COMMIT |
| Employees with payroll or timesheet history cannot be deleted (trigger) | HR admins | At COMMIT |

## 7. Rollback and recovery

| Situation | What to do |
|---|---|
| `apply` fails before COMMIT | Nothing to do. The transaction rolled back, the schema is unchanged and HR was restarted automatically. Read `migration.log` |
| COMMIT done, but the new release fails to deploy | **Leave the schema in place.** The changes are additive (new tables, nullable or defaulted columns, a relaxed index), so the previous release keeps working; `apply` already restarted it on the new schema. Section 6.3 still applies. Fix the deploy and retry |
| The schema must be removed and no real data is in the new objects yet | `bash "$S" rollback --run-dir /root/sanaa-hr-migration-runs/apply-<ts> --confirm ROLLBACK-0052-0054-ON-sanaa_hr`. This takes a safety backup, then reverses everything in one transaction: tables, columns, the original indexes, seeded rows and history rows. It refuses if any new table or column holds data. The deployed release must then be the pre-0052 one |
| Data was written to the new objects, or anything else went wrong | **Full restore** from the verified final backup (path in `<apply run>/BACKUP`). Anything written after the backup is lost |

**Full restore procedure.** Restore into a new database, then swap names. Never use `pg_restore --clean`. Check which role is the superuser inside the container first; with the official image it is `POSTGRES_USER`.

```bash
B=/root/sanaa-hr-cicd-backups/hr-before-0052-0054-final-<ts>.dump
sha256sum -c "$B.sha256"
systemctl stop sanaa-hr.service
docker exec sanaa-hr-postgres psql -U sanaa_hr -d postgres -c "CREATE DATABASE sanaa_hr_restore OWNER sanaa_hr"
docker exec -i sanaa-hr-postgres pg_restore -U sanaa_hr -d sanaa_hr_restore --no-owner --no-acl --exit-on-error < "$B"
docker exec sanaa-hr-postgres psql -U sanaa_hr -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='sanaa_hr' AND pid<>pg_backend_pid()" \
  -c "ALTER DATABASE sanaa_hr RENAME TO sanaa_hr_failed_0052" \
  -c "ALTER DATABASE sanaa_hr_restore RENAME TO sanaa_hr"
systemctl start sanaa-hr.service   # with the pre-0052 release deployed
```

Keep `sanaa_hr_failed_0052` until the incident is closed. **Copy every backup off the server**: the backups and the database share one disk.

## 8. Risk assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Existing HR, employee, attendance or payroll data is altered | Very low | High | The migrations only add objects. The in-transaction fingerprint of every existing row aborts on any change; tested with an injected update, delete and insert, all caught and rolled back. Final backup verified by a full restore with identical row counts |
| R2 | Migration fails halfway and leaves a partial schema | Very low | Medium | Single transaction with `ON_ERROR_STOP`; guards refuse any partial state |
| R3 | Production differs from the reviewed state | Low | Medium | Exact 49-item gap check, 33-row history lineage check, and a catalog comparison against a from-scratch build. All stop the run before production is touched |
| R4 | HR managers lose Timesheet/Payroll/Saved Attendance/Vacation Setup access | **Certain** until assigned | Medium | Access report for approval; assignment is a separate approved step; plan it into the deploy window |
| R5 | Approval routing changes | None until HR managers are assigned; then expected | Medium | The application keeps current routing while no HR manager is assigned (unit-tested); `preflight` gives counts of who changes once assigned; configure workflows first |
| R6 | All users signed out | **Certain** | Low | Announce the window. One-time only |
| R7 | Future `drizzle-kit migrate` blocked | None (history always reconciled) | High if it happened | Tested with Drizzle's own migrator |
| R8 | VPS deployer incompatible with the 55-row history | Unknown until reviewed | Medium (deploy blocked) | Deployer copy and hash collected in stage 1; `apply` is locked to the reviewed hash; `hr-production-prepare.sh` updated to accept the reconciled history |
| R9 | Lock waits on `employees` / `payroll_runs` | Very low | Low | HR stopped, other connections checked, `lock_timeout=10s`, about 2 s runtime |
| R10 | The deletion trigger blocks a legitimate deletion | Low | Low | Intended; archive the employee instead |
| R11 | Backups lost together with the server | Low | High | Copy `.dump` and `.sha256` files off the server |
| R12 | Rehearsal container behaves differently from production | Low | Low | Same image and non-superuser owner, no network; the final backup is re-verified at apply time |

## 9. What was tested before handover

Everything below ran locally on PostgreSQL 18, against a copy of the HR database taken before 0052. That copy has the same 0000–0032 history as production and reproduces production's exact 27/22 gap. The real script ran its `preflight`, `rehearse`, `apply` and `rollback` phases with only Docker and systemd stubbed out and a stand-in deployer file. The production VPS was **not** accessed.

- Gap reproduced exactly; after `apply`, the official audit logic reports `ALL_EXPECTED_COLUMNS_PRESENT` (134 tables / 1,532 columns).
- Data preservation: 107 tables / 5,695 rows unchanged; the only new rows were 90 `permissions` grants. Injected changes were caught and rolled back.
- `apply` was refused without a deployer hash, with a wrong hash, with a changed package, with changed `--hr-managers`, and for `--keep-ledger` (option removed). A second `apply` was refused because the schema is already complete.
- Rollback restored the identical schema and was refused once a real `shift_plans` row existed. The full restore-and-swap procedure was tested.
- Drizzle's real migrator: reconciled history → a future 0055 applies alone; 33 rows → fails at 0033.
- Approval routing: unit tests for table missing, empty, and assigned. The payroll tests pass.
- **Not executed:** the Docker and systemd commands and the production image. Stage 1 on the VPS is their first real run, and it is read-only.

## 10. Files

| File | Purpose |
|---|---|
| `hr-migrate-0052-0054.sh` | Orchestrator (modes above) |
| `guards.sql`, `report.sql`, `hr-manager-access.sql` | Blocking checks, impact report, HR Manager access report |
| `fingerprint-begin.sql`, `fingerprint-end.sql` | In-transaction data-preservation proof |
| `ledger-record.sql`, `expected-ledger.sql` | Migration-history reconciliation; the expected history is generated |
| `validate.sql` | Post-migration validation |
| `rollback-template.sql` | Logical rollback (with the values captured at apply time) |
| `expected-missing.txt` | The exact 49-item gap this package was reviewed for |
| `files.sha256`, `gen-ledger-sql.mjs` | Pinned hashes of the migrations, journal and contract; the generator for them |
