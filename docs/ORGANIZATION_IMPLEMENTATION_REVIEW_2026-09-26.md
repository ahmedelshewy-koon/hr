# Organizational assignments — implementation and migration gate

**Subsequent status:** the user later conditionally authorized execution after final preflight. Migration 0030 was successfully applied on 2026-09-26; see [live execution result](./ORGANIZATION_LIVE_MIGRATION_RESULT_2026-09-26.md). The remainder of this document is the original pre-approval assessment.

Implementation is ready for review. **Migration 0030 has not been applied to the live database.** Live execution requires the user's explicit approval of the exact target below. No automatic legacy mapping is included.

## Review stages

1. **Additive model:** `db/schema.ts`, migration `0030_organizational_assignments.sql`, snapshot and journal. Reuses companies, departments, job titles and employee manager relationships. Position is a separate master record; CEO is a position occupied by an employee. Sections and teams are optional department records with explicit organization kinds.
2. **Shared validation:** `app/organization/assignment-policy.ts`, `assignment-service.ts`, `catalog-service.ts`, `reference-policy.ts`, and `reporting-line.ts`. Employee creation, ATS conversion, profile changes, lifecycle/status changes and biometric updates call the central employee validator. Assignment and catalog writes share an advisory transaction lock. Active references block master-record deactivation; existing and historical references protect against structural changes.
3. **Existing service integration:** effective HR is resolved from an explicit profile override, company-and-branch rule, then branch fallback. Approval, notification, dashboard and profile consumers reuse this resolution. No resolved HR copy or separately maintained employee tree is persisted.
4. **UI:** settings master records feed profile dropdowns; position-defined fields are prefilled and locked. Saving profile assignments and manager relationships changes the chart. Existing profile drawers and permissions are reused. The chart supports company, branch, department, status and text filters; collapse/expand, zoom, fit, center, printing and opening profiles. Manual hierarchy mutation endpoints are retired.

Unchanged legacy assignments remain intact on unrelated edits. Legacy organizational values are not guessed from names or automatically mapped into the new model. A future legacy mapping needs separate review. The old work-location text is retained alongside the new optional reference.

## 1. Generated migration summary

`drizzle-postgres/0030_organizational_assignments.sql` creates seven tables: branches, company_branches, organization_branch_scopes, positions, job_grades, work_locations and hr_responsibility_rules. It adds thirteen columns to existing tables, foreign keys and uniqueness indexes, including one active CEO position per company and one active HR rule per scope.

Inspection found no DROP, TRUNCATE, data UPDATE/DELETE/INSERT or assignment backfill. Employee assignment references are nullable. The existing department unit_type representation and existing employee values are preserved.

Rehearsed SQL SHA-256: `3aa2e4ffdc337c085aa45dac244ae0568b0448515efb02fac90f50364f11446a`.

## 2. Backup details

Latest custom-format pg_dump, taken against an exported repeatable-read snapshot:

`D:\HR\outputs\organization-implementation\rehearsal-2026-09-26T12-46-06-305Z\pre-organization.dump`

Size: **388,958 bytes**. SHA-256: `6c42159401a4ca47a71efa5fadb17fbd356dab9ff905022883896191df3fa284`.

An earlier successful rehearsal is retained separately. A fresh backup/rehearsal was performed because operational account/security tables changed while implementation was in progress. No organizational live writes were executed.

## 3. Isolated restore result

**Passed.** PostgreSQL 18 restored the dump with error-on-failure into `127.0.0.1:5657 / sanad_org_rehearsal`, using a separate cluster under the output directory. The live cluster on port 5545 was not used for DDL or tests. Original-column hashes and row counts matched the exported snapshot after restore.

## 4. Migration rehearsal result

**Passed at 2026-09-26 12:48:32 UTC.** The isolated migration journal advanced from 30 to 31 entries. Re-running the migration runner was a no-op. Existing migration history matched exactly.

Machine-readable evidence:

`D:\HR\outputs\organization-implementation\rehearsal-2026-09-26T12-46-06-305Z\report.json`

## 5. Data preservation checks

All **79 original public tables**, including **48 employees**, retained exactly the same original-column values and row counts after migration. Hashes include organizational assignments, manager relationships and legacy values, not only row counts.

Final read-only live verification at **2026-09-26 12:48:58 UTC** found zero differences against the refreshed snapshot, 30 live migration entries, and no `public.positions` table. Evidence: `outputs/organization-implementation/live-readonly-verification.json`.

## 6. Exact live target requiring confirmation

| Setting | Value |
| --- | --- |
| Host | 127.0.0.1 |
| Port | 5545 |
| Database | koon_hr |
| Database role | koon_hr_admin |
| Proposed migration | 0030_organizational_assignments |

Only the additive migration above is proposed. No legacy mapping or data reset is authorized. Before an approved execution, recheck this target and the SQL hash and refresh the backup if live data has changed. This report is evidence for approval, not permission to execute.

## Validation and remaining limitation

- Production build and TypeScript checking passed.
- Latest full test run after concurrent review changes: **219 tests, 214 passed, 3 skipped, 2 failed**. One failure was a newly introduced missing Arabic translation for `Forbidden`; it was fixed and the Arabic suite rerun passed that check. The sole remaining failure is the pre-existing Arabic tanween spelling in `app/login-form.tsx`; that file matches the captured baseline hash, and the baseline test reproduces the same failure. The unrelated file was not edited. Eight additional organization review tests passed.
- Twelve isolated database integration checks passed, including optional units, legacy preservation, position contradictions, company/branch scope, manager cycles, CEO occupancy and dynamic HR resolution. Test fixtures were rolled back.
- Five HTTP integration checks passed against the isolated app, covering master CRUD, profile save and derived placement, invalid writes, profile metadata and scoped permissions. Their fixtures existed only in the earlier isolated clone.
- Browser QA confirmed the Arabic chart, company filter, collapse behavior, profile opening, persisted manager/branch metadata, locked position fields and blank optional section/team fields.
- Final lint: **0 errors, 9 image-optimization warnings**. The full lint rerun is recorded in `outputs/organization-implementation/final-lint.log`. TypeScript passed again after the concurrent changes. The production build passed in the latest full test run.
- `git diff --check` passed. No packages were installed and no commit, reset or live migration was performed. The original dirty workspace was preserved; baseline copies and hashes are in `outputs/organization-implementation/baseline` and `baseline-hashes.json`. Concurrent unrelated edits were retained.

The new organizational screens activate when the schema exists. Before live migration, compatibility paths remain available and the legacy chart is read-only.

Both isolated rehearsal clusters were stopped after verification. Backup files and reports remain available. Additional concurrent edits after the checks above require their own verification before deployment.
