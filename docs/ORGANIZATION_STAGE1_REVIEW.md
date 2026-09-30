# Stage 1 review amendments — 2026-09-26

## Status and scope

The eight Stage 2 assessment dependencies are incorporated into the existing Stage 1 implementation. This is a source-code and migration-artifact update, not a production migration sign-off. No database migration or database-connected runtime test was run for this review. Existing unrelated workspace changes are preserved.

## Updated Stage 1 summary

- Deactivation and structural-change validation have separate entry points. The reference map also supplies authoritative usage counts to the settings API.
- Job Grades have an explicit editable `sort_order`; reads sort by `sort_order`, then English name and ID for deterministic ties.
- Known database unique violations produce bilingual HTTP 409 messages, including wrapped PostgreSQL errors.
- Company saves synchronize legacy `companies.name` using `name_en`, then `name_ar`, then the legacy name. After schema readiness, the legacy company API delegates to the same save service.
- Department roots cannot have parents; Sections require Department parents; Teams allow Department or Section parents. Same-company, active-parent and cycle checks remain for new, active or structurally changed records.
- `job_titles` remains the single catalog. Nullable `department_id` already supports generic titles. Position selection and assignment validation accept generic titles and titles belonging to the selected Department. Scoped legacy reads now include generic titles too.
- Settings UI, API and alternate legacy write paths preserve the settings permission and role boundary.
- Schema readiness checks include the grade ordering column and company-code constraint, rather than only the existence of `positions`. The existing settings UI includes the ordering field and the corrected root-parent behavior.

## Schema / migration delta

The pending `0030_organizational_assignments.sql`, `0030_snapshot.json`, and `db/schema.ts` are synchronized:

| Object | Change |
| --- | --- |
| `job_grades.sort_order` | Integer, NOT NULL, default 0; API accepts integers from 0 through 2147483647 |
| `companies_code_unique` | Unique constraint on nullable `companies.code`; legacy null codes remain allowed |
| Existing HR scope and CEO indexes | Retained: `hr_rules_active_scope`, `positions_company_ceo` |
| `job_titles.department_id` | Already nullable; no new catalog or schema change needed |

No legacy rows are automatically renamed, assigned a company, or reinterpreted. Company-name synchronization occurs on subsequent saves, not via a migration backfill. If 0030 has been applied in any target environment, do not replay or silently replace its migration history: produce a forward migration for this delta first.

## Validation and usage contract

`GET /api/organization` returns `{ready, catalog, usage}` after authorization. `usage[entity][recordId]` contains `total`, `active`, `historical`, and per-reference `{total, active}` counts keyed by `table:column`. Counts are aggregated server-side using the same map used by write validation. Catalog and counts are read in one repeatable-read, read-only transaction. Counts represent reference edges, not distinct people. The server rechecks writes under the existing organization advisory transaction lock; a displayed count does not authorize a later save.

| Master | References inspected |
| --- | --- |
| Company | Employees, organizational units, positions, HR rules, company/branch links |
| Branch | Employees, selected unit scopes, work locations, HR rules, company/branch links |
| Organizational unit | Employee Department/Section/Team assignments, child units, position unit assignments, linked job titles |
| Position | Employee position assignments |
| Grade | Employee and position grade assignments |
| Work location | Employee work-location assignments |
| Job title | Employees and positions |
| HR rule | No stored reverse references; removal changes rule resolution and fallback behavior |

For deactivation, employees in `active`, `probation`, or `notice_period` count as active dependents. Other master rows count when `status='active'`. Branch-scope links count as active only when their owning unit is active and uses selected branches. Company/branch association rows alone do not block deactivation. The `historical` count is `total-active` and therefore includes passive association rows as well as inactive records.

Historical references do not prevent status-only deactivation. This includes retiring a record whose ancestor is already inactive. Structural edits remain conservative: existing active or historical dependent references block changes to company, parent, kind, selected scope, or position assignment fields. Company/branch link rows themselves are excluded from structural blocking so an otherwise unused association can be removed. Actual dependent references still block company-branch removal. Records and historical foreign keys are retained.

Legacy job-title archive/update paths use this same distinction after schema readiness; before readiness they check existing employee references with the same active employment statuses. Legacy department deactivation and archive paths require settings management permission and use active-dependent checks.

## Duplicate errors

The common API error handler maps PostgreSQL SQLSTATE `23505` for these known constraints to HTTP 409, without returning SQL or database details:

- `companies_code_unique`, `branches_code_unique`, `positions_code_unique`, `job_grades_code_unique`, `work_locations_code_unique`: code already exists; choose another code.
- `hr_rules_active_scope`: an active HR responsibility rule already exists for this scope, including branch-wide fallback scopes.
- `positions_company_ceo`: this company already has an active CEO position.
- `idx_companies_name`: company name already exists.

Unknown database errors retain the existing generic error handling. Database uniqueness remains the final authority rather than relying only on preflight checks.

## Permission and transition notes

- Settings access requires `system_settings/view` and a Super Admin or HR Manager role. Writes require `system_settings/manage_settings` and the same role restriction; existing Super Admin permission bypass remains.
- Department or job-title grants do not expose Organizational Structure Settings. The original job-title editor remains available under its own catalog permissions.
- Read-only settings viewers do not receive the embedded HR-responsible management editor. Alternate company and department write routes enforce the same role restriction.
- Legacy Department add/edit remains available before schema readiness. After readiness, the UI directs users to Organizational Structure Settings; it does not open a legacy editor that the server will reject.
- Legacy chart hierarchy/deletion controls remain read-only; reporting edits belong to Employee Profile. Department cards explain the supported destination instead of opening the retired hierarchy save flow.
- Deploy the schema-compatible application and the settings UI as one coordinated release. Before live migration, verify an authorized administrator can reach the new settings page, and that the HR Manager's intended view/manage grants and global page availability are configured. Do not widen department/job-title permissions to work around missing settings access.

## Verification and remaining gates

Database-free regression coverage includes active versus historical references, structural blocking, company-name synchronization, grade-order validation, parent-kind/company/cycle rules, generic titles, settings role filtering, and all requested unique-error mappings. Migration baseline tests verify that the latest snapshot matches the TypeScript schema with no generated delta.

Verification completed: 39 focused tests passed; TypeScript `tsc --noEmit` passed; focused ESLint passed with zero errors and five existing image-element warnings in `hr-app.tsx`. No database rehearsal or browser acceptance run was performed.

Before migration rehearsal:

1. Confirm 0030 is pending on the rehearsal source; resolve applied-history differences with a forward migration if needed.
2. Provision the isolated rehearsal target and fresh backup; verify restore integrity and target isolation using the existing rehearsal script's checks. No live DDL is authorized by this work.
3. Record reviewed mappings for legacy units/companies and decide initial grade order. These are explicit data decisions; this patch does not infer them from names or creation order.

The rehearsal must then test actual PostgreSQL unique-constraint responses, active/inactive reference counts, rollback/restore preservation, and the API with authorized and unauthorized roles. Before live release, Stage 2 UI acceptance must verify the pre/post-migration transition, generic-title selection, grade ordering, settings access for intended administrators, and usage/error displays. The code changes alone do not establish those database/runtime/UI results.
