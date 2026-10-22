# SANA HR production schema upgrade: migrations 0052–0054, with historical data reconciliation

**Audience:** the administrator of the HR VPS (`209.42.23.12`) and the reviewers of PR #7.
**Status:** **Not run on production.** PR #7 stays a draft. Nothing in this package authorizes a rehearsal, an apply or a deploy.

> **Before an isolated rehearsal can be authorized**, the evidence in section 7 must be delivered and reviewed, and three things committed through a reviewed PR:
> 1. the recovered VPS migration files;
> 2. the attested ledger fingerprint;
> 3. explicit approvals of the job-history backfill and of the RBAC rows (`reconciliation-approval.json`).
>
> Until then, `preflight` ends with exit 4 and an `ADMIN_ACTION_REPORT.md`, and `rehearse`/`apply` refuse to run.
>
> **The administrator follows only `ADMIN_HANDOFF.md`.** It has one read-only Stage 1 (`evidence`, which collects everything listed in section 7 into a single bundle), one reviewed PR (Checkpoint A), and one maintenance window with written checkpoints B–D. This RUNBOOK is the reviewers' background.

## 1. What is missing

- **Schema:** production lacks the 27 tables and 22 columns of 0052–0054 (`expected-missing.txt`).
- **Data:** production also lacks data steps of 0041/0042 that never ran there (section 3).

## 2. Findings

### 2.1 Confirmed by the VPS administrator's Stage 1 evidence (review of `30ee91e`)

| # | Finding |
|---|---|
| C1 | The original VPS migrations `0031_vps_current_schema` and `0032_vps_attendance_device_country` were recovered. Their SQL sha256 and journal timestamps match ledger rows #32 (`1791298824926`) and #33 (`1791372110232`) exactly |
| C2 | `0031_vps_current_schema` creates 17 tables and contains **no data inserts or permission seeds** |
| C3 | Job history: **1 of 45** employees has no history; there are **zero** `current_assignment` rows |
| C4 | `administrative_decisions` permissions: **0/4** present |
| C5 | `staffing_blueprint` permissions: **6/12** present, measured with the *previous* check; see R2 |
| C6 | Deployer `2df500bd…5fc7` (98 lines): **conditional PASS**. Read-only database prerequisite checks; runs the candidate release's schema audit before switching; no Drizzle migration commands; no hardcoded ledger counts |
| C7 | Running Drizzle migrations directly against production is still unsafe: the ledger head (2026-10-07) is newer than 0052/0053 |

### 2.2 Confirmed from the repository (this PR)

| # | Finding |
|---|---|
| R1 | Neither ledger timestamp appears in any committed journal on any ref. At `516d980` the journal ended at 0030 (31 entries) |
| R2 | **0042 seeds `staffing_blueprint` for three roles** (HR Manager, Department Manager, Employee) × 6 actions = 18 rows. The previous data check counted only two roles. It is corrected, so the VPS figure must be re-collected (section 7) |
| R3 | Repo migrations 0031–0046 create exactly **17** tables that still exist after 0042 drops the workforce tables. This is consistent with C2 |
| R4 | A missing permission row means **deny**: only `allowed=1` rows grant access. So `allowed=0` rows from 0042 change no access |
| R5 | No GitHub workflow, npm lifecycle script, build step or application module runs Drizzle migrations. `db:migrate` is manual only. The one script that calls `migrate()` (`scripts/rehearse-organization-migration.mjs`) is a manual clone-rehearsal tool |
| R6 | **The application changes the database at runtime:** <ul><li>idempotent DDL (`ADD COLUMN IF NOT EXISTS` on users/roles/holidays, `CREATE TABLE IF NOT EXISTS system_settings`);</li><li>when `system_settings.seed_version` differs from the release's `SEED_VERSION`, a reseed that remaps roles, deletes legacy-role permissions and **upserts `ROLE_DEFAULTS` permissions, overwriting custom values** for those modules.</li></ul>The reseed covers HR Manager `staffing_blueprint` (7 actions) and `timesheetManagement`. `SEED_VERSION` has been unchanged since 2026-08-24. **Fixed in this PR:** the reseed's permission writes are now insert-only (`app/api/hr/role-permission-seed.ts`, `ON CONFLICT DO NOTHING`), so a SEED_VERSION bump can no longer overwrite a customized permission; it only fills missing keys. The preflight gate stays, because the reseed still remaps legacy roles and would add missing keys |
| R7 | `ops/hr-schema-audit.sh` is read-only (only a `SELECT` on `information_schema.columns`) and exits 3 when anything is missing. Its sha256 is now pinned in `files.sha256` |

### 2.3 Assumptions (not verified; the evidence in section 7 settles them)

| # | Assumption | How it will be checked |
|---|---|---|
| A1 | Production's 6 `staffing_blueprint` rows are HR Manager rows written by the runtime reseed (R6), so the missing 12 are Department Manager/Employee **denials** | `rbac-proposal.csv` from the next preflight lists every row and its status |
| A2 | `0032_vps_attendance_device_country` corresponds to repo 0047 (`attendance_devices.country`) | Computed automatically (LINEAGE_REPORT "Schema introduced") once the files are committed |
| A3 | The employee without history (C3) has a stored assignment effective date or start date | `job-history-proposal.csv`: PROPOSED vs MISSING_SOURCE |
| A4 | Production's `seed_version` equals the release's, so a deploy will not run the reseed | `runtime.json` / LINEAGE_REPORT "Application startup"; apply refuses otherwise |

## 3. Audit of 0031–0051: data operations absent from production

The VPS applied a generated schema-only migration instead of repo 0031–0046 (C1, C2). Repo 0047's change came in via the VPS's `0032`, and 0048–0051 via the earlier bridge, all schema-only. Every non-schema step in the repo migrations:

| Repo migration | Data / non-schema step | On production |
|---|---|---|
| 0032 | drop `idx_attendance_devices_ip_port` | check PASS (C-report: three failures only) |
| 0037, 0046 | `DROP NOT NULL` | check PASS |
| 0038 | drop `approval_workflows_company_id_request_type_key` | check PASS |
| 0039 → 0042 | create then drop `workforce_*` tables; seed then delete `workforce_planning` permissions | net effect absent; check PASS |
| **0041** | **backfill `employee_job_history` (`current_assignment`)** | **missing** (C3) → job-history reconciliation |
| **0041** | **`administrative_decisions` view/create = 1 for HR Manager and Department Manager** | **missing** (C4) → RBAC reconciliation (4 grants) |
| **0042** | **`staffing_blueprint` × 3 roles × 6 actions** | **incomplete** (C5, R2) → RBAC reconciliation |
| 0033–0036, 0040, 0043–0045, 0047–0051 | none (additive schema only) | n/a |

## 4. Reconciliation design (proposed; nothing runs without approval)

Both parts are computed **read-only** by `preflight` (`recon-proposal.sql`, written to temp tables in a rolled-back transaction) and rendered as:
- `RECONCILIATION_PROPOSAL.md`, with exact employee IDs, roles, permission keys and before-counts;
- `job-history-proposal.csv`;
- `rbac-proposal.csv`.

Each part has its own **fingerprint** (md5 of exactly the rows that would be inserted).

### 4.1 Job history (0041)
- **Scope:** non-deleted employees with **no** history row at all, the same rule as 0041.
- **Values:** only what is stored on the employee: company, branch, department, section, job title, position.
- **Start date:** the stored `assignment_effective_date` if it is a valid `YYYY-MM-DD`; otherwise the stored `start_date`. 0041 fell back to `CURRENT_DATE`; that would **invent a date**, so employees without a stored date are `MISSING_SOURCE` and are **never inserted**. Their record must be corrected through the application's normal, separately approved process, or a reviewer attests the exception.
- **What the row means:** `change_reason='current_assignment'`, exactly as 0041 writes. It is a snapshot of the current assignment, not a historical event. The audit records which date source was used.
- **Safety:** idempotent. It inserts only if the employee still has no history; the table's unique "one open entry" index also prevents duplicates. No existing row is updated or deleted.

### 4.2 RBAC (0041/0042)
- **Seeds:** exactly the `(role, module, action, allowed)` rows 0041 and 0042 insert. A test keeps them in sync with the migration text.
- **Insert-only:** `ON CONFLICT DO NOTHING`. **Existing rows are never touched**, whatever their value: custom grants and explicit denials are preserved and reported as `PRESERVED_CUSTOM`. Roles that don't exist are reported (`ROLE_MISSING`) and block coverage.
- **Effect:** `allowed=1` rows are real **access grants** (expected: `administrative_decisions` view/create for HR Manager and Department Manager). `allowed=0` rows are explicit denials that restore parity with 0042 and change no access (R4).

### 4.3 Approval and execution
- **Separate approvals:** `reconciliation-approval.json` has one entry per part: `decision: approved` plus the exact `proposal_fingerprint` (and, for human review, the employee IDs and rows).
- **Same transaction:** the reconciliation runs inside the migration transaction, after 0052–0054 and the ledger recording. It **recomputes** the proposal; if anything changed since approval (an employee gained history, a permission was edited), it **aborts** and nothing is applied.
- **Verification:** counts must equal the proposal exactly. Afterwards, every source-backed employee has history, every seeded key exists, and preserved rows are unchanged. Every inserted row is written to `hr_ops.migration_audit`.
- **Rehearsal:** produces `RECONCILIATION_BEFORE_AFTER.md` from the clone. Approved rows remaining un-inserted fail the rehearsal. `apply` refuses unless production's proposal still has the fingerprints the rehearsal recorded.
- **Rollback:** the rollback baseline includes the reconciliation rows. A logical rollback removes them only if they are unchanged since apply; otherwise it is refused and the verified backup must be restored.

## 5. Migration history and ordering (unchanged policy)

- Existing ledger rows are never changed, deleted or re-dated, and 0033–0051 are not fabricated.
- Only 0052, 0053 and 0054 are recorded, after they ran. That makes 0054 the head, so nothing in this release stays pending and the next migration (newer than 0054) is the first one Drizzle applies.
- Rows #32/#33 are accepted only through `ledger-attestations.json` entries that **name the recovered files**. `lineage.mjs` hashes the committed files itself and checks the recovered journal's timestamps; a mismatch is blocking.
- The exact ledger fingerprint must be attested.
- **Never run `drizzle-kit migrate` against production** before this package is applied (C7).

## 6. Deployer, CI/CD and application-startup paths

- **Deployer:** conditional PASS (C6), recorded in `deployer-review.json`. `apply` needs `status: approved` for exactly the deployed sha256. Open conditions:
  - **Packaged schema-audit script:** repo side done (R7). The VPS must show the candidate release's file hashes (section 7, item 6).
  - **CI/CD:** repo side done (R5), and a regression test fails if a workflow, npm hook or application module starts running migrations.
  - **Service startup:** the systemd unit, timers and crontabs must be shown (section 7, item 5).
  - **Application startup:** the runtime DDL is limited to the reviewed idempotent statements, and a test fails on any new runtime DDL. The runtime reseed (R6) is now insert-only for permissions. Preflight still compares `seed_version` and **blocks** if a deploy would trigger it. `apply` saves an access snapshot (every permission, role, user role/status and the seed marker); `postdeploy` proves that the deployed release changed none of it.

## 7. Evidence still required before rehearsal can be authorized

The administrator runs the **read-only** Stage 1 `evidence` command (ADMIN_HANDOFF.md, Stage 1). It collects items 1–7 below automatically into a single bundle:
- recovered files byte-exact, with `SOURCE.txt`;
- `startup-paths.txt`, scanned for migration commands;
- `candidate.txt`;
- the preflight outputs;
- `APPROVAL_JOB_HISTORY.md` / `APPROVAL_RBAC.md`;
- `STAGE1_SUMMARY.md`, with the values to copy and the remaining blockers.

Developers then run `node ops/prod-migration-0052-0054/lineage.mjs ingest --bundle <dir> [--write]`. It refuses files that differ from `SOURCE.txt` or from the ledger hashes, copies them byte for byte, and prints (never writes) the attestation and approval entries.
```bash
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh evidence --recovered DIR --candidate DIR; echo "exit=$?"   # expected now: 4
```

What the bundle contains (for reference):
1. **Recovered VPS migrations, byte for byte:**
   - `0031_vps_current_schema.sql`;
   - `0032_vps_attendance_device_country.sql`;
   - the original VPS `meta/_journal.json`;
   - `SOURCE.txt`: where each file was found, its mtime and owner, and `sha256sum` computed on the VPS.

   Developers commit them under `evidence/vps-lineage/`.
2. **Ledger fingerprint and rows** from the new run (`LINEAGE_REPORT.md`, `ledger.tsv`).
3. **Reconciliation proposal:** `RECONCILIATION_PROPOSAL.md`, `job-history-proposal.csv`, `rbac-proposal.csv`, `recon.tsv`. The corrected staffing check will also be in `data-checks.tsv`.
4. **For each MISSING_SOURCE employee:** HR's confirmed assignment effective date (to be corrected through the application, separately approved), or a reviewed decision to leave the employee without history.
5. **Service-startup paths:**
   - `systemctl cat sanaa-hr.service` (ExecStart, ExecStartPre, EnvironmentFile);
   - `systemctl list-timers --all`;
   - `crontab -l` for root and sana-deploy.
6. **Candidate release:** its GitHub SHA, and `sha256sum ops/hr-schema-audit.sh ops/hr-schema-contract.json` inside it (must equal `files.sha256`).
7. **`runtime.json`:** production's `seed_version` versus the release's.
8. **The optional supplementary evidence offered** (original journal, remaining deployment history), for the record.

**Reviewers** then:
1. commit the evidence files;
2. set `production_ledger.fingerprint`;
3. approve each reconciliation part by fingerprint (by people allowed to approve HR data and access changes);
4. record the deployer verdict once its conditions are closed.

All of this goes through a reviewed PR. Only then is a preflight followed by an isolated rehearsal authorized.

## 8. Rehearsal and apply (later; apply needs separate written approval)

- **`rehearse`:**
  1. runs all preflight gates;
  2. takes a fresh verified backup and restores it into a throwaway container;
  3. applies 0052–0054 **plus the approved reconciliation** in one transaction;
  4. writes the before/after report and runs validation and the from-scratch catalog comparison;
  5. checks rerun refusal, a clean rollback, and a refused unsafe rollback.
- **`apply`:** additionally requires the deployer `status: approved`, the same ledger and reconciliation fingerprints as the rehearsal, and a typed confirmation.
- **Effects users notice:**
  - Everyone is signed out once.
  - HR Managers not listed in `hr_managers` lose Timesheet, Payroll, Saved Attendance and Vacation Setup until assigned (assignment is a separate approval).
  - Approved `administrative_decisions` grants take effect.
  - Approval routing is unchanged until HR managers are assigned.

## 9. Rollback and recovery

| Situation | Action |
|---|---|
| `apply` fails before COMMIT | Nothing changed; HR restarted |
| Committed; deploy fails | Leave the schema (additive) |
| Everything introduced (tables, columns, seeds, reconciliation rows, ledger rows) unchanged since apply | `rollback --run-dir <apply run> --confirm ROLLBACK-0052-0054-ON-sanaa_hr` |
| Anything changed, or the rollback is refused | **Restore the verified final backup**: restore into a new database, swap the names, never `pg_restore --clean` (commands below; the backup path is in `<apply run>/BACKUP`) |

```bash
B=/root/sanaa-hr-cicd-backups/hr-before-0052-0054-final-<ts>.dump; sha256sum -c "$B.sha256"
systemctl stop sanaa-hr.service
docker exec sanaa-hr-postgres psql -U sanaa_hr -d postgres -c "CREATE DATABASE sanaa_hr_restore OWNER sanaa_hr"
docker exec -i sanaa-hr-postgres pg_restore -U sanaa_hr -d sanaa_hr_restore --no-owner --no-acl --exit-on-error < "$B"
docker exec sanaa-hr-postgres psql -U sanaa_hr -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='sanaa_hr' AND pid<>pg_backend_pid()" \
  -c "ALTER DATABASE sanaa_hr RENAME TO sanaa_hr_failed_0052" -c "ALTER DATABASE sanaa_hr_restore RENAME TO sanaa_hr"
systemctl start sanaa-hr.service   # with the pre-0052 release deployed
```

## 10. Risk assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Existing HR, employee, attendance or payroll data altered | Very low | High | In-transaction fingerprint of every existing row; reconciliation is insert-only; verified backups |
| R2 | Partial schema or partial reconciliation | Very low | Medium | One transaction; exact count verification; abort on any drift |
| R3 | Production differs from the reviewed state | Low | Medium | 49-item gap check, catalog comparison, attested ledger fingerprint, approved reconciliation fingerprints |
| R4 | HR managers lose access to four pages | Certain until assigned | Medium | Access report; separate approval |
| R5 | Approval routing changes | None until HR managers are assigned | Medium | Application guard (tested) |
| R6 | All users signed out | Certain | Low | Announce |
| R7 | Ledger rows #32/#33 accepted without real evidence | Low | High | Accepted only when the committed recovered files hash to the ledger values (computed, never typed); attestation is reviewed |
| R8 | `drizzle-kit migrate` run before the package (skips 0052/0053) | Real until applied | High | Never run it; deployer confirmed it doesn't; regression test on CI/npm/startup paths |
| **R9** | **Job-history backfill misrepresents history** (the current assignment shown as held since `start_date`) | Medium for employees using `start_date` | Medium | `date_source` shown per employee for approval; `assignment_effective_date` preferred; no invented dates; MISSING_SOURCE excluded |
| **R10** | **RBAC grants approved without intent** | Low | Medium | Grants listed separately from parity denials; explicit, fingerprint-bound approval; existing grants and denials preserved |
| **R11** | **Production data changes between approval and apply** | Medium (live system) | Low | Fingerprint mismatch aborts with nothing applied; re-run preflight and re-approve |
| **R12** | **Runtime reseed on deploy overwrites role permissions** (R6) | Very low | High | Reseed permission writes are insert-only (tested on PostgreSQL); preflight blocks a `seed_version` mismatch; `postdeploy` diffs the access snapshot taken at apply |
| R13 | Deployer or startup path runs migrations | Low (conditional PASS) | High | Conditions in section 6; apply needs `approved` |
| R14 | Rollback destroys data written after apply | Very low | High | Baseline guard covers all new tables, columns, seeds, reconciliation rows and ledger rows; otherwise backup restore |
| R15 | New `hr_ops` audit schema on production | Certain at apply | Low | Outside the public contract and Drizzle; append-only |

## 11. Tests

- `tests/prod-migration-lineage.test.mjs` (always, CI): **27 tests**. New in this revision:
  - recovered-evidence classification (match, hash mismatch, file missing);
  - the committed attestation stays unverified without files and fingerprint;
  - reconciliation coverage (approved, fingerprint drift, MISSING_SOURCE, attested exception, missing role);
  - the runtime-reseed gate;
  - nothing enabled with the committed approval file;
  - seeds equal to the 0041/0042 text, and the corrected staffing check;
  - reconciliation SQL is insert-only, guarded and free of invented dates;
  - the report lists exact IDs, keys and counts;
  - no CI/CD, npm or startup migration path;
  - the runtime DDL allow-list;
  - the schema-audit script is pinned and read-only.
- `tests/prod-migration-postgres.test.mjs` (with `HR_MIGRATION_TEST_PG_BIN`/`_PORT`; skipped otherwise): **18 tests**. New:
  - an exact proposal on production-like gaps;
  - applied exactly and audited, with an explicit denial and a custom grant preserved, a missing-source employee not inserted, and the assignment effective date preferred;
  - idempotent (a second proposal is empty);
  - a clean rollback restores `employee_job_history` and `permissions` byte for byte;
  - rollback refused after a reconciled row changes;
  - refused with nothing applied when history or a permission changes after approval;
  - unverified without approval.
- `tests/prod-migration-handoff.test.mjs` (always, CI): **14 tests**:
  - the runtime reseed is insert-only (the only remaining upsert is the seed marker);
  - separate job-history and RBAC approval requests, and their entries approve exactly the current proposal;
  - the startup-path scanner;
  - `ingest` (dry run, byte-exact write with CRLF kept, refusal on altered files or on overwrite);
  - full verification needs the files, the fingerprint and both approvals;
  - Stage 1 summary blockers;
  - `collect_recovered` and `candidate_check`;
  - ADMIN_HANDOFF.md names only real commands, options and files;
  - Stage 1 and `postdeploy` are read-only.
- `tests/prod-migration-postgres.test.mjs` additionally (**21 tests** in total):
  - the reseed on a real schema keeps custom denials and grants and fills only missing keys (the replaced upsert is shown to revert them);
  - the access snapshot is stable and detects permission, role and seed changes;
  - Stage 1 `evidence` end to end produces one verifiable bundle (byte-exact files, approvals, summary that flags mismatched recovered files) and leaves the data, the ledger and the schema untouched.
- Not executed: Docker and systemd on the VPS.

## 12. Files

| File | Purpose |
|---|---|
| `ADMIN_HANDOFF.md` | The administrator's single procedure: commands, checkpoints, expected results, recovery, outstanding approvals |
| `hr-migrate-0052-0054.sh` | Orchestrator (`evidence`, `preflight`, `rehearse`, `apply`, `postdeploy`, `rollback`) |
| `access-snapshot.sql` | Access state saved at apply and compared by `postdeploy` |
| `lineage.mjs` | Lineage classification, evidence hashing, reconciliation coverage and reports, discovery, audit SQL |
| `ledger-attestations.json` | Reviewed lineage decisions (rows #32/#33 reference the recovered files; fingerprint pending) |
| `reconciliation-approval.json` | Explicit approvals of the job-history and RBAC reconciliation (pending) |
| `evidence/vps-lineage/` | Recovered VPS migrations (to be committed byte-exact) |
| `deployer-review.json` | Deployer verdict (conditional PASS) and open conditions |
| `recon-proposal.sql`, `recon-report.sql`, `recon-apply.sql` | Reconciliation proposal, report and guarded apply |
| `data-checks.sql` | Read-only checks of the 0031–0051 data steps (staffing corrected to three roles) |
| `guards.sql`, `report.sql`, `hr-manager-access.sql` | Gates and reports |
| `fingerprint-begin.sql`, `fingerprint-end.sql` | Data-preservation proof |
| `ledger-record.sql`, `audit.sql`, `expected-ledger.sql`, `validate.sql` | Ledger recording, audit trail, expected journal, validation |
| `rollback-baseline.sql`, `rollback-template.sql` | Rollback baseline and guarded logical rollback |
| `expected-missing.txt`, `files.sha256`, `known-migration-versions.json`, `gen-ledger-sql.mjs` | Reviewed gap, pinned hashes (now including the schema-audit script), committed versions, generator |
