# SANA HR production schema upgrade: migrations 0052–0054

**Audience:** the administrator of the HR VPS (`209.42.23.12`).
**Status:** prepared and rehearsed against a copy of real HR data. **Not run on production.** Running `apply` needs explicit approval from the HR system owner.

## 1. Why this is needed

The deploy of the Payroll & Timesheet release was blocked by the schema gate (`ops/hr-schema-audit.sh`) with **27 missing tables** and **22 missing columns**. All 49 come from three migrations that were never applied to production:

| Migration | Adds |
|---|---|
| `0052_timesheet_management` | 9 tables: `timesheets`, `timesheet_edit_permissions`, `timesheet_month_locks`, `payroll_variable_entries`, `payroll_month_locks`, `shift_plans`, `shift_plan_details`, `shift_assignments`, `company_wfh_days`. 5 columns: `employees.attendance_type_id`, `employees.shift_plan_id`, `holidays.religion`, `attendance_types.early_exit_allowance_minutes`, `attendance_types.weekend_days` |
| `0053_payroll_rebuild` | 18 tables: `business_units`, `business_unit_cost_center_mapping`, `payroll_currencies`, `hr_managers`, `hr_manager_business_units`, `payroll_elements`, `payroll_element_eligibility`, `payroll_employee_elements`, `request_escalations`, `payroll_run_lines`, `payroll_erp_settings`, `payroll_erp_invoice_attempts`, `payroll_erp_reconciliations`, `employee_wfh_days`, `wfh_sessions`, `saved_attendance`, `user_permissions`, `portal_session_activity`. 17 columns: `employees.working_business_unit_id`, `.termination_date`, `.dopay_employee_number`, and 14 on `payroll_runs` (currency, totals, confirmation, accounting and ERP tracking) |
| `0054_deleted_employee_email` | No new objects. Rebuilds `idx_employees_work_email` so that deleted employees no longer reserve their e-mail address |

The **two columns that were not obvious** from a first reading are `attendance_types.early_exit_allowance_minutes` and `attendance_types.weekend_days`: 0052 adds them to a table that already exists. The exact expected gap is pinned in `expected-missing.txt`. The script refuses to run if production's gap differs from it by even one item.

## 2. What the script does

`hr-migrate-0052-0054.sh` has four modes. Each one writes its logs and evidence to `/root/sanaa-hr-migration-runs/<mode>-<timestamp>/`.

| Mode | Touches production? | What it does |
|---|---|---|
| `preflight` | Read-only | Checks file hashes, the schema gap, the guards and the migration history, and prints an **impact report**: who is affected and what gets seeded |
| `rehearse` | Read-only (`pg_dump`) | Takes a fresh backup and restores it into a **throwaway PostgreSQL container with no network**, using the same image and the same non-superuser owner as production. Then it applies the full migration and validates it, compares the result with a from-scratch build of all 55 migrations, checks that a second run is refused, and checks that rollback works |
| `apply` | **Yes** | Requires a passing rehearsal less than 24 hours old with identical package files, plus a typed confirmation. Stops HR, takes a final backup, verifies that backup by restoring it, applies everything in **one transaction**, validates, restarts HR and runs the official gate |
| `rollback` | **Yes** | Logical rollback of one `apply` run. Refuses if the new tables or columns already hold data |

### Safeguards inside the single transaction

1. **Guards** (`guards.sql`):
   - none of the 49 objects may exist yet;
   - the prerequisite tables and indexes exist;
   - no duplicate `payroll_runs` periods and no duplicate active work e-mails (either would break the new unique indexes);
   - the migrating user owns the altered tables;
   - the migration history is exactly 0000–0032.
2. **Data-preservation fingerprint** (`fingerprint-begin.sql` / `fingerprint-end.sql`). Before any DDL runs, every existing table is hashed: row count plus an md5 over every row, using only the columns that existed before. After the migrations it is hashed again. If any existing row was changed or deleted, or rows appeared anywhere except the expected seeds (`permissions`, `deduction_rules`), the whole transaction is rolled back.
3. **The three migration files, byte for byte** as committed. Their sha256 values are pinned in `files.sha256` together with the journal and the schema contract.
4. Optional **HR manager seeding** (`--hr-managers`), then **migration history** reconciliation (section 5).
5. **Validation** (`validate.sql`): the 27 tables, 22 columns, 26 indexes, trigger and seed rows, and the history. Only then `COMMIT`.

The transaction runs with `search_path=public`, `lock_timeout=10s` and `statement_timeout=15min`. Rehearsed on a copy of real HR data (107 tables, 5,695 rows), it took about 2 seconds.

## 3. Decisions needed before `apply`

1. **HR managers.** Once `hr_managers` exists, users with the *HR Manager* role who are **not listed** in it:
   - get **403 on Timesheet and Payroll**;
   - see no employees in the timesheet scope;
   - are not used as payroll-region approvers.

   Only listed managers with `admin_order = 0` can set salaries or make privileged profile edits. `preflight` lists the affected users. Choose one:
   - pass `--hr-managers "12:KSA,15:Egypt,20"`. Format: user id, then an optional region. Within a region, the first user listed becomes `admin_order 0`, the payroll head. No region means all regions. Without business-unit links, a manager sees every employee in their region;
   - **or** leave it out and assign managers after the deploy under *Payroll → HR Manager Setup*. HR managers are locked out until then.
2. **Migration history mode.** The default is `reconcile` (recommended, section 5). Use `--keep-ledger` only if the deployer requires exactly 33 rows; `preflight` warns if `/usr/local/sbin/sana-hr-deploy` mentions the ledger.
3. **Maintenance window.** About 10–15 minutes of HR downtime, mostly backup and restore verification. **Every user is signed out once** and must sign in again (section 6).

## 4. Step by step

Run everything as root on the VPS.

**Step 0: get the reviewed files.** Use a Linux checkout of the approved commit, or the CI release tarball for that commit. Don't copy them from a Windows machine: line-ending changes break the pinned hashes, and the script will refuse to run.

```bash
cd /root && git clone https://github.com/ahmedelshewy-koon/hr.git hr-migration && cd hr-migration
git checkout <approved-commit>
sha256sum --quiet -c ops/prod-migration-0052-0054/files.sha256 && echo FILES-OK
S=ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh
```

**Step 1: preflight** (read-only; any time):

```bash
bash "$S" preflight
```

The run must end with `PREFLIGHT=PASS`. Read the impact report: HR managers, the approval-routing count, deduction-rule seeding, and any other database connections.

**Step 2: rehearse** (read-only; any time; about 2–5 minutes). Pass the same options you will use for `apply`:

```bash
bash "$S" rehearse --hr-managers "<ids or omit>"
```

It must end with `REHEARSAL=PASS`. Keep the printed run directory for step 4. If it stops at step 4/7 with objects "missing on production", production differs from what the migration files define. **Stop and send the run directory to the developers.** Do not use `--accept-catalog-drift` without their review.

**Step 3: announce the maintenance window.** Tell users that HR will be unavailable for about 15 minutes and that everyone will need to sign in again.

**Step 4: apply** (approval required; within 24 hours of the rehearsal):

```bash
bash "$S" apply --rehearsal /root/sanaa-hr-migration-runs/rehearse-<ts> \
  --confirm APPLY-0052-0054-ON-sanaa_hr --hr-managers "<same as rehearsal>"
```

The run must end with `APPLY=COMPLETE`, and the official gate must print `HR_SCHEMA_STATUS=ALL_EXPECTED_COLUMNS_PRESENT`. HR then runs again on the **current** release.

**Step 5: re-run the deployment.** In GitHub Actions, run *Deploy HR to production (gated)* again (`workflow_dispatch` on `main`).

**Step 6: after the deploy:**
- sign in as Super Admin and as one HR Manager;
- open Timesheet, Payroll and Employees;
- assign HR managers if you didn't seed them;
- check that one leave request routes correctly (see risk R5).

## 5. Migration history (`drizzle.__drizzle_migrations`)

Production's history has 33 rows (0000–0032). However, the schema of 0033–0051 is already present: it was applied outside Drizzle, partly through the additive bridge. Keeping 33 rows is **not safe for future migrations**.

- Drizzle applies every migration whose journal timestamp is newer than the **latest** recorded `created_at`. The row count doesn't matter; the latest timestamp does.
- **Tested** with Drizzle's real migrator on the rehearsal copy:
  - **History kept at 33:** the next `drizzle-kit migrate` tries to replay 0033 and fails with `column "nationality_country" … already exists`. Every future migration stays blocked until someone repairs the history by hand. If a replay ever got further, the data-rewriting migrations would run again.
  - **History reconciled to 55:** a test migration 0055 applied on its own, as intended.
- `reconcile` therefore inserts the rows for 0033–0054, each with the file's sha256 and its journal timestamp, exactly as Drizzle would have written them. This happens inside the same transaction, and only after the rehearsal confirms that the restored production copy matches a from-scratch build of all 55 migrations. On the local copy the only difference was an extra unique key on `system_settings`, which is harmless.
- Five of the existing 0000–0032 rows have hashes that differ from the current files. Drizzle doesn't use hashes, so this is informational only.
- **After `reconcile`, `ops/hr-production-prepare.sh` is obsolete.** It asserts exactly 33 rows and would now stop with "HR migration history changed unexpectedly". Don't run it again. Update the deployer if it performs the same check.

## 6. Effects users will notice

| Effect | Who | When |
|---|---|---|
| Signed out once ("Session idle timeout") | Everyone | As soon as an app version that knows `portal_session_activity` runs against the new schema. `preflight` reports whether the current release already does |
| 403 on Timesheet/Payroll; empty timesheet scope | HR Manager role users not in `hr_managers` | Same moment; fixed by assigning them |
| New page grants | Super Admin and HR Manager roles get `timesheetManagement` plus view/edit on 19 payroll and attendance pages (90 rows) | At COMMIT |
| Two absence deduction rules created (1 and 2 days of wage) | Only if production has **no** active absence rule (`preflight` reports this) | At COMMIT |
| Employees with payroll or timesheet history can no longer be deleted (trigger) | HR admins | At COMMIT |
| Requests from employees with no matching active workflow get a default manager → HR chain instead of the legacy path | Employees whose company has no workflow for that request type (`preflight` gives a count) | When the new release runs |

## 7. Rollback and recovery

| Situation | What to do |
|---|---|
| `apply` fails before COMMIT | Nothing to do. The transaction rolled back, the schema is unchanged and HR was restarted automatically. Read `migration.log` |
| COMMIT done, but the new release fails to deploy | **Leave the schema in place.** The changes are additive (new tables, nullable or defaulted columns, a relaxed index), so the previous release keeps working; `apply` already restarted it on the new schema in step 6/6. The effects in section 6 still apply. Fix the deploy and retry |
| The schema must be removed and no real data is in the new objects yet | `bash "$S" rollback --run-dir /root/sanaa-hr-migration-runs/apply-<ts> --confirm ROLLBACK-0052-0054-ON-sanaa_hr`. This takes a safety backup, then reverses everything in one transaction: tables, columns, the original index definitions captured at apply time, seeded rows and history rows. It refuses if any new table or column holds data. The deployed release must then be the pre-0052 one |
| Data was written to the new objects, or anything else went wrong | **Full restore** from the verified final backup (`/root/sanaa-hr-cicd-backups/hr-before-0052-0054-final-<ts>.dump`, path in `<apply run>/BACKUP`). Anything written after the backup is lost |

**Full restore procedure.** Restore into a new database, then swap names. Never use `pg_restore --clean`: the new tables have foreign keys. Check which role is the superuser inside the container first; with the official image it is `POSTGRES_USER`.

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

Keep `sanaa_hr_failed_0052` until the incident is closed, then drop it. **Copy each backup off the server**: the backups and the database currently share one disk.

## 8. Risk assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Existing HR, employee, attendance or payroll data is altered | Very low | High | The migrations only add objects. The in-transaction fingerprint of every existing row aborts the transaction on any change; tested by injecting an update, a delete and an insert, all caught and rolled back. Final backup verified by a full restore with identical row counts |
| R2 | Migration fails halfway and leaves a partial schema | Very low | Medium | Single transaction with `ON_ERROR_STOP`; a partial state is impossible. Guards refuse to run on any partial state |
| R3 | Production differs from the reviewed state (extra drift, a different gap) | Low | Medium | Exact 49-item gap check; a 33-row history lineage check; a catalog comparison against a from-scratch build during rehearsal. All of these stop the run before production is touched |
| R4 | HR managers lose Timesheet/Payroll access | **Certain** unless seeded | Medium | `--hr-managers`, or assign them right after the deploy; affected users are listed by `preflight` |
| R5 | Requests in companies without workflows change approval route, or fail with "approver unavailable" | Medium | Medium | `preflight` gives a count; configure company workflows or HR managers before or right after the deploy; test one request |
| R6 | All users signed out | **Certain** | Low | Announce the window. One-time only |
| R7 | Future `drizzle-kit migrate` blocked | Certain with `--keep-ledger`; none with `reconcile` | High (future releases) | Default `reconcile`; tested with Drizzle's own migrator |
| R8 | Deployer or `hr-production-prepare.sh` asserts 33 history rows | Unknown (the deployer script is not in the repo) | Medium (deploy blocked) | `preflight` greps the deployer; retire `hr-production-prepare.sh`; or rehearse and apply with `--keep-ledger` and repair the history later |
| R9 | Lock waits or long locks on `employees` / `payroll_runs` | Very low | Low | HR is stopped and other connections are checked; `lock_timeout=10s`; small tables (about 2 s in rehearsal) |
| R10 | The deleted-employee trigger blocks a legitimate HR deletion | Low | Low | Intended behavior. Archive the employee instead |
| R11 | Backups lost together with the server | Low | High | Copy the `.dump` and `.sha256` files off the server after each run |
| R12 | Rehearsal container behaves differently from production | Low | Low | Same image and non-superuser owner, no network; the final backup is re-verified at apply time |

## 9. What was tested before handover

Everything below ran locally on PostgreSQL 18, against a copy of the HR database taken before 0052. That copy has the same 0000–0032 history as production and reproduces production's exact 27/22 gap. The real script ran its `preflight`, `rehearse`, `apply` and `rollback` phases with only Docker and systemd stubbed out. The production VPS itself was **not** accessed.

- Gap reproduced exactly; after `apply`, the official audit logic reports `ALL_EXPECTED_COLUMNS_PRESENT` (134 tables / 1,532 columns).
- Data preservation: 107 tables / 5,695 rows unchanged. The only new rows in existing tables were 90 `permissions` grants. Injected changes were caught and rolled back.
- A second `apply` was refused, and a changed package or changed `--hr-managers` was refused. Rehearsal was also tested with `--keep-ledger`.
- Rollback restored the identical original schema, and was refused once a real `shift_plans` row existed. The full restore-and-swap procedure produced the original schema and history.
- Drizzle's real migrator: with the reconciled history a future 0055 applied alone; with 33 rows it failed at 0033.
- **Not executed:** the Docker and systemd commands (`docker run`/`exec`, `systemctl`, `curl`) and the production image. They follow the pattern of the existing `ops/test-vps-bridge-on-clone.sh` and `ops/hr-production-prepare.sh`; `rehearse` on the VPS is their first real test, and it is read-only.

## 10. Files

| File | Purpose |
|---|---|
| `hr-migrate-0052-0054.sh` | Orchestrator (modes above) |
| `guards.sql`, `report.sql` | Blocking checks and the impact report |
| `fingerprint-begin.sql`, `fingerprint-end.sql` | In-transaction data-preservation proof |
| `ledger-record.sql`, `expected-ledger.sql` | Migration-history reconciliation; the expected history is generated |
| `validate.sql` | Post-migration validation |
| `rollback-template.sql` | Logical rollback (with the values captured at apply time) |
| `expected-missing.txt` | The exact 49-item gap this package was reviewed for |
| `files.sha256`, `gen-ledger-sql.mjs` | Pinned hashes of the migrations, journal and contract; the generator for them |
