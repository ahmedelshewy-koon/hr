# SANA HR production schema upgrade: migrations 0052–0054

**Audience:** the administrator of the HR VPS (`209.42.23.12`) and the reviewers of PR #7.
**Status:** **Not run on production.** The first Stage 1 preflight showed that production's Drizzle migration history diverges from this repository. The package now verifies that history and stops when it cannot.

> **Next authorized activity:** a read-only Stage 1 run of the updated package (section 4). It will very likely end with `LINEAGE=UNVERIFIED` (exit code 4) and an `ADMIN_ACTION_REPORT.md`. That is the expected, fail-closed result: collect the evidence it lists and send it.
> **The isolated rehearsal can only run after** developers have reviewed that evidence and committed a lineage attestation through a reviewed PR.
> **`apply` stays prohibited** until separate written approval.
> No production database changes, no permission changes, no deployment.

## 1. What is missing, and why

The Payroll & Timesheet deploy was blocked by the schema gate with **27 missing tables** and **22 missing columns**. All 49 come from 0052, 0053 and 0054; the list is in `expected-missing.txt`.
- **0052:** 9 tables, plus 5 columns. These include `attendance_types.early_exit_allowance_minutes` and `.weekend_days`.
- **0053:** 18 tables, plus 17 columns, including 14 payroll tracking fields on `payroll_runs`.
- **0054:** rebuilds one index.

## 2. Findings: production's migration history

### 2.1 What the administrator reported

- Production's `drizzle.__drizzle_migrations` has **33 rows**.
- Rows 1–31 line up with migrations 0000–0030.
- **Row 32:** `created_at = 1791298824926` (2026-10-06 15:00:24 UTC). **Row 33:** `1791372110232` (2026-10-07 11:21:50 UTC). Their hashes also differ from this repository's files.
- The current journal has 0031 at `1790773448045` and 0032 at `1790776914266`. Production's newest row is newer than 0052 and 0053.

### 2.2 What the repository history shows

- Drizzle stores the journal's **generation time** (`when`) as `created_at`, not the time a migration ran.
- **Neither timestamp appears in any committed journal or file.** That covers all 41 commits that touch `drizzle-postgres/`, on every branch, and every file in the working directory. Every committed journal always had 0031/0032 at the current timestamps.
- At commit `516d980` (2026-09-30) the journal ended at 0030 with exactly **31 entries**, the 31 production rows that match.
- Rows 32/33 were generated a few hours after commits `52cd837` (2026-10-06 11:46 UTC) and `79d6f72` (2026-10-07 11:07 UTC).
- Earlier local reports (`FINAL_VALIDATION_REPORT.md`) already found that 0017 and 0020 were **edited after being applied**, so hash mismatches on old rows are expected.

**Working hypothesis (unconfirmed):**
1. Production was migrated from a 0000–0030 checkout.
2. Two migrations were then generated outside git, probably by `drizzle-kit generate` from the schema at those times, and applied.
3. Generated migrations contain schema changes only, so the **hand-written data steps of 0031–0047** may never have run on production: permission seeds and the job-history backfill.

The package therefore treats rows 32/33 as **unknown lineage**. It never assumes they are equivalent to 0031/0032 just because the schema objects exist.

### 2.3 Ordering hazard today

Drizzle applies every journal entry newer than the **latest** `created_at`. Production's latest is 2026-10-07, which is newer than 0052 and 0053.

So **`drizzle-kit migrate` / `npm run db:migrate` run against production today would apply only 0054, record it, and skip 0052/0053 permanently.** This was reproduced with Drizzle's own migrator on a fixture. **Nobody may run Drizzle migrations against production** until this package has been applied.

## 3. The reconciliation design

| Principle | How it is enforced |
|---|---|
| **Existing ledger rows are never changed, deleted or re-dated** | No `UPDATE`/`DELETE` of `drizzle.__drizzle_migrations` anywhere except rollback. Rollback deletes only the three rows this package inserted (id above the pre-apply maximum **and** exact 0052–0054 hash and timestamp). Unit tests enforce this |
| **No fabricated history** | 0033–0051 are **not** recorded: Drizzle did not run them on production. Only 0052, 0053 and 0054 are recorded, inside the transaction, after they actually ran |
| **Safe ordering for future migrations** | Recording 0054 makes the latest `created_at` = 0054's, so nothing in this release is pending and the next migration (newer than 0054) is the first one Drizzle applies. Verified in the transaction (`drizzle_pending=0`) and with Drizzle's real migrator in tests (a probe 0055 applies alone) |
| **Lineage must be explained before anything runs** | `lineage.mjs` classifies every ledger row against three sources: the current journal; every committed historical version of every migration on every ref (LF and CRLF hashes, `known-migration-versions.json`); and reviewed attestations (`ledger-attestations.json`). Rows it cannot explain stop the run. Rows newer than the release, rows already recording 0052–0054, and duplicate timestamps are blocking even with an attestation |
| **The exact reviewed ledger is pinned** | The attestation records the ledger fingerprint `md5(id:hash:created_at …)`. The migration transaction refuses unless the live ledger has exactly that fingerprint, so a ledger that changed after review aborts with nothing applied |
| **Auditable** | A new `hr_ops.migration_audit` table (outside the public schema contract) gets, inside the same transaction: every existing ledger row with its classification and attestation; every unrecorded migration (`journal_entry_out_of_band`); every data check; and the package and deployer fingerprints. Rollback appends an event; nothing is deleted |
| **Data steps are not skipped silently or replayed** | For migrations the ledger does not record, the data steps are checked read-only (section 3.1). A failing check stops the run unless reviewers attest it. The package never replays 0033–0051 |

### 3.1 Audit of 0031–0051 (data and non-schema operations)

All other statements in 0031–0051 are additive schema changes, which the rehearsal verifies by comparing the result against a from-scratch build of all 55 migrations.

| Check (`data-checks.sql`) | Migration step it verifies |
|---|---|
| `0032_ip_port_index_dropped` | 0032 drops `idx_attendance_devices_ip_port` |
| `0037_min_minutes_nullable` | 0037 `deduction_rules.min_minutes DROP NOT NULL` |
| `0038_company_request_type_key_dropped` | 0038 drops `approval_workflows_company_id_request_type_key` |
| `0039_0042_workforce_tables_absent` | 0039 creates `workforce_*`, 0042 drops them (and refuses if they hold rows) |
| `0039_0042_workforce_permissions_removed` | 0039 seeds `workforce_planning` permissions, 0042 deletes them |
| `0041_job_history_backfill` | 0041 inserts a `current_assignment` job-history row for every non-deleted employee |
| `0041_admin_decisions_permissions` | 0041 seeds `administrative_decisions` view/create for HR Manager and Department Manager |
| `0042_staffing_blueprint_permissions` | 0042 seeds `staffing_blueprint` permissions for HR Manager and Department Manager |
| `0046_debit_account_nullable` | 0046 `cost_centers.debit_account DROP NOT NULL` |

A failing check is **not fixed by this package**. Production data and permissions stay untouched. Reviewers either attest it with a reason, or plan a separately approved corrective change.

### 3.2 Rollback guards

Right after COMMIT, while HR is still stopped, `apply` records a baseline of:
- the full content of each of the **27 new tables**;
- the seeded `permissions` and `deduction_rules` rows;
- the three recorded ledger rows.

A logical rollback recomputes that baseline and is **refused** if anything differs. That covers:
- any row in a new table: `hr_managers`, `portal_session_activity`, `user_permissions`, timesheets, payroll tables, and so on;
- any changed seed;
- any of the **22 new columns** holding a non-default value (checked generically from the catalog), including all `payroll_runs` tracking fields;
- any `approval_workflow_runs` row without a workflow.

A refused rollback means: **restore the verified backup** (section 7). It was tested against a hr_managers row, a session row, a user_permissions grant, a filled employee column, a changed seeded permission and a changed SAR rate; all six were refused.

### 3.3 VPS deployer

`deployer-review.json` pins the hash the administrator reported, `2df500bd…5fc7`, with status **pending**. Only the hash was provided; **the content has not been reviewed.** `apply` refuses unless:
- `status` is `approved`;
- that sha256 equals the deployer on the VPS;
- it equals `--deployer-sha256`.

The open review questions are listed in that file. The most important: does the deployer run Drizzle migrations? With the hazard in section 2.3, that would apply 0054 and skip 0052/0053.

## 4. Stage 1 (read-only): validate, collect lineage evidence, report

Run everything as root on the VPS, from a Linux checkout of the commit named in the review request. Don't copy files from Windows: the hashes are pinned. **Node 18+ is required** (the app's runtime).

```bash
cd /root && git clone https://github.com/ahmedelshewy-koon/hr.git hr-migration && cd hr-migration
git checkout <commit from the review request>
sha256sum --quiet -c ops/prod-migration-0052-0054/files.sha256 && echo FILES-OK
S=ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh
bash "$S" preflight; echo "exit=$?"
```

- **Exit 4 / `LINEAGE=UNVERIFIED` (expected now):** nothing was changed. Read `ADMIN_ACTION_REPORT.md` in the run directory (`/root/sanaa-hr-migration-runs/preflight-<ts>/`) and collect what it lists:
  1. `DISCOVERY.md` / `discovery.json`. The preflight searched `/opt/sanaa-hr`, `/home/sana-deploy`, `/root`, `/srv` and `/var/www`, read-only, for Drizzle journals whose entries match the ledger rows. If one matches, also send that journal and its SQL files.
  2. The release history: `ls -la --time-style=full-iso /opt/sanaa-hr/releases/`, plus the GitHub SHA of each release.
  3. Shell-history lines mentioning `drizzle-kit`, `db:migrate`, `db:generate` or `migrate(`, for root and sana-deploy, with dates. Redact secrets.
  4. The **full content** of `/usr/local/sbin/sana-hr-deploy` (`deployer.copy`). Redact secrets.
  5. Deployment logs from 2026-10-05 to 2026-10-09.
  6. Confirmation that nobody will run Drizzle migrations against production in the meantime.

  Send the whole run directory: `LINEAGE_REPORT.md`, `ledger.tsv`, `data-checks.tsv`, `lineage.json`, `preflight.txt`, `hr-manager-access.csv`, the `deployer.*` files, `DISCOVERY.md`, `ADMIN_ACTION_REPORT.md`, `run.log`.
- **Exit 1:** a gate failed (wrong schema gap, guards, missing tool). Send the run directory.
- **Exit 0 / `PREFLIGHT=PASS`:** only possible once an attestation exists. Continue with `bash "$S" rehearse`.

**Reviewers, after Stage 1:**
1. Identify where rows 32/33 came from, using the discovery output, releases and history.
2. Decide whether each unexplained row and each failed data check is acceptable.
3. Commit `ledger-attestations.json` (row decisions plus the exact ledger fingerprint from `LINEAGE_REPORT.md`) and the deployer verdict in `deployer-review.json`, through a reviewed PR.

Then a new Stage 1 run (preflight, then `rehearse`) is authorized. Rehearse refuses to start while the lineage is unverified.

## 5. Rehearsal (after attestation)

`bash "$S" rehearse` works as follows. Production is unchanged throughout.
1. Re-runs every preflight gate.
2. Takes a fresh backup and restores it into a throwaway container with no network.
3. Checks the clone's ledger has the same fingerprint as production's.
4. Applies 0052–0054 in one transaction.
5. Validates the result and compares it with a from-scratch build of all 55 migrations.
6. Checks that a rerun is refused.
7. Tests a clean logical rollback.
8. Checks that a rollback is refused after a session row is written.

Send the run directory for approval.

## 6. Apply (only after separate written approval)

The approval must name:
- the commit;
- the approved deployer sha256;
- the maintenance window;
- any HR managers to assign (default none).

```bash
bash "$S" apply --rehearsal /root/sanaa-hr-migration-runs/rehearse-<ts> \
  --deployer-sha256 <approved hash> --confirm APPLY-0052-0054-ON-sanaa_hr
```

Before touching production, `apply` re-checks:
- the lineage and the attested fingerprint;
- that the rehearsal saw the same ledger;
- the package fingerprint;
- that the rehearsal is less than 24 hours old;
- the deployer approval.

Then it:
1. stops HR and confirms nothing else is connected;
2. takes a final backup and verifies it by restoring it;
3. runs **one transaction**: guards, data fingerprint, 0052–0054, recording of the 0052–0054 history rows, the audit trail, validation, data-preservation check;
4. captures the rollback baseline;
5. restarts HR and runs the official gate.

**Effects users notice:**
- Everyone is signed out once.
- HR Managers are blocked from Timesheet, Payroll, Saved Attendance and Vacation Setup until someone assigns them. `hr-manager-access.csv` lists who is affected, and assigning them needs separate approval.
- 0052/0053 add 90 role permission rows for the Super Admin and HR Manager roles.
- Approval routing stays as it is today until HR managers are assigned. The application change in this PR keeps the legacy routing while none are assigned.

## 7. Rollback and recovery

| Situation | What to do |
|---|---|
| `apply` fails before COMMIT | Nothing to do. The transaction rolled back and HR was restarted |
| Committed, but the new release fails to deploy | Leave the schema in place: the changes are additive and the previous release runs on them |
| Schema must go, and the new objects are exactly as `apply` left them | `bash "$S" rollback --run-dir <apply run> --confirm ROLLBACK-0052-0054-ON-sanaa_hr`. Takes a safety backup, then reverses in one transaction. Existing ledger rows are untouched and the rollback is logged in the audit table |
| Rollback refused (any new data), or anything else | **Full restore** from the verified final backup (`<apply run>/BACKUP`). Data written after the backup is lost |

**Full restore procedure:**
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
Never use `pg_restore --clean`. Copy every backup off the server.

## 8. Risk assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Existing HR, employee, attendance or payroll data altered | Very low | High | Additive migrations; in-transaction fingerprint of every existing row; verified backups |
| R2 | Partial schema | Very low | Medium | One transaction; guards refuse any partial state |
| R3 | Production schema differs from the reviewed state | Low | Medium | Exact 49-item gap check, catalog comparison against a from-scratch build, attested ledger fingerprint |
| R4 | HR managers lose access to four pages | **Certain** until assigned | Medium | Access report; assignment is a separate approved step |
| R5 | Approval routing changes | None until HR managers are assigned | Medium | Application guard (unit-tested); preflight counts who would change |
| R6 | All users signed out | **Certain** | Low | Announce the window |
| **R7** | **Production lineage unexplained** (rows 32/33 from a journal outside git) | **Confirmed** | High | Fail-closed lineage gate; discovery of journals on the VPS; reviewed attestation pinned by fingerprint |
| **R8** | **`drizzle-kit migrate` run against production before this package**: applies 0054 and skips 0052/0053 forever | Real until applied | High | Never run it on production (action report item 6); deployer review question 1; the guard refuses if a 0052–0054 row already exists |
| **R9** | **Hand-written data steps of 0031–0047 never ran on production** (permission seeds, job-history backfill) | Plausible (hypothesis 2.2) | Medium | Read-only data checks; failures must be attested or fixed by a separately approved change; this package changes no data or permissions |
| R10 | Deployer incompatible (runs migrations, asserts row counts) | Unknown: content not reviewed | Medium–High | Pinned hash; apply locked to an approved review; `hr-production-prepare.sh` accepts a ledger whose head is 0054 |
| R11 | Rollback destroys data written after apply | Very low | High | Baseline guard over all 27 tables, 22 columns, seeds and ledger rows; otherwise backup restore |
| R12 | Backups lost with the server | Low | High | Copy `.dump` and `.sha256` files off the server |
| R13 | A new audit schema `hr_ops` on production | Certain at apply | Low | Outside the public schema contract and Drizzle; append-only; documented |

## 9. Tests

- `tests/prod-migration-lineage.test.mjs` (always runs, also in CI), 16 tests:
  - divergent history with unknown timestamps;
  - a wrong-hash attestation;
  - a ledger that changed after attestation;
  - committed LF/CRLF historical hashes versus unknown hashes;
  - blocking ordering conflicts (newer than the release, already recorded, duplicates);
  - data-check gating;
  - the fingerprint formula;
  - journal ordering and pinned files;
  - rollback and validation coverage of all 27 tables and 22 columns, derived by parsing the migrations;
  - no ledger `UPDATE`/`DELETE`;
  - the guard fails without an attestation;
  - the deployer pin;
  - journal discovery;
  - audit rows.
- `tests/prod-migration-postgres.test.mjs` (runs when `HR_MIGRATION_TEST_PG_BIN` and `HR_MIGRATION_TEST_PG_PORT` point at a disposable PostgreSQL; skipped otherwise), 12 tests on a production-like fixture:
  - a missing data step is detected;
  - Drizzle's own migrator reproduces the skip hazard;
  - a changed ledger is refused with nothing applied;
  - the happy path keeps all 33 rows byte-for-byte and records only 0052–0054;
  - Drizzle's migrator applies nothing afterwards, and a future 0055 alone;
  - six unsafe rollbacks are refused;
  - a clean rollback restores the attested ledger exactly.
- Not executed: Docker and systemd on the VPS. Stage 1 is their first real run and it is read-only.

## 10. Files

| File | Purpose |
|---|---|
| `hr-migrate-0052-0054.sh` | Orchestrator (preflight, rehearse, apply, rollback) |
| `lineage.mjs` | Lineage classification, VPS journal discovery, admin action report, audit SQL |
| `ledger-attestations.json` | Reviewed lineage decisions and the pinned ledger fingerprint (empty until review) |
| `known-migration-versions.json` | Every committed version of every migration (generated) |
| `deployer-review.json` | Pinned deployer hash and review verdict (pending) |
| `data-checks.sql` | Read-only checks of the 0031–0051 data steps |
| `guards.sql`, `report.sql`, `hr-manager-access.sql` | Blocking checks, impact report, HR Manager access report |
| `fingerprint-begin.sql`, `fingerprint-end.sql` | In-transaction data-preservation proof |
| `ledger-record.sql`, `audit.sql`, `expected-ledger.sql` | Recording 0052–0054 only; the audit trail; the expected journal (generated) |
| `validate.sql` | Post-migration validation |
| `rollback-baseline.sql`, `rollback-template.sql` | Rollback baseline and guarded logical rollback |
| `expected-missing.txt`, `files.sha256`, `gen-ledger-sql.mjs` | The reviewed 49-item gap, pinned hashes, generator |
