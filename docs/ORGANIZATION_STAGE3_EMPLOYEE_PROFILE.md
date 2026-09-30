# Stage 3 — Employee Profile organizational integration

Implemented 2026-09-26 in D:\HR. No live employee data was mutated for verification. No organizational master mapping, activation, schema migration, or chart redesign was performed.

## 1. Files changed

| File | Change |
|---|---|
| app/organization-assignment-fields.tsx | Complete bilingual assignment controls, retained-value markers, setup blockers, HR resolution, before/after review |
| app/organization/assignment-policy.ts | Shared dropdown/filter/clearing policy, protected Position fields, review diff and stale-review check, HR display resolution, calendar-date validation |
| app/organization/assignment-service.ts | Calendar-date validation and HTTP 400 for malformed assignment IDs |
| app/employees/profile-update.ts (new) | Central locked, validated partial employee save with transactional audit and legacy-schema compatibility |
| app/employee-drawer.tsx | Per-employee review/confirm workflow, partial payloads, preservation of unset legacy assignments, distinct work-country label |
| app/employee-profile-360.tsx | Full read display, HR source/override distinction, effective date, cache invalidation and stale-response guards |
| app/api/hr/route.ts | Existing authorized employee-update endpoint delegates to shared service; create audit also moved inside transaction |
| app/api/employees/[id]/route.ts | Read-only resolved HR identity, resolution source and current approval availability |
| app/hr-app.tsx | Employee row editing opens the canonical profile when the organization model is ready |
| app/organization/reporting-service.ts | Import extension only, to run the existing service under isolated Node checks; no reporting algorithm change |
| app/organization-settings.css | Responsive before/after review table styling |
| tests/organization-profile-stage3.test.mjs (new) | Assignment policy, retention, review and date regressions |
| tests/organization-profile-render.test.mjs (new) | Actual English/Arabic control and review rendering |
| tests/runtime-stage3-profile.mjs (new) | Isolated PostgreSQL save, audit, rejection, rollback and preservation checks |
| tests/organization-settings-ui.test.mjs | Updated grade-control label/retention assertions; verifies configured grade ordering |
| tests/rendered-html.test.mjs | Verifies the centralized save delegate and underlying validation/persistence/audit service |
| docs/ORGANIZATION_STAGE3_EMPLOYEE_PROFILE.md | This report |

Pre-task copies of modified existing files are in outputs/stage3/before. Other workspace changes were preserved. No commit or deployment was requested or performed.

## 2. Implemented fields

Company; Branch; Department; optional Section; optional Team; Position; Direct Manager; Job Grade/Level; Work Location; employee HR override; separate resolved HR responsibility; Assignment Effective Date. The existing Job Title control remains separate from Position. Existing country is labeled Work country to distinguish it from the organizational Work Location master. Stored legacy work-location text remains visible and is not mapped.

Effective Date is assignment metadata, not a scheduler. The control explicitly explains that Save applies changes immediately. Invalid calendar dates, including February 30, are rejected in UI and server validation.

## 3. Dependency and clearing behavior

Available choices use active masters and explicit company/branch membership. Departments require an explicitly chosen company and branch in the UI; Sections belong to the chosen Department; Teams belong to the chosen Section or directly to the Department. Inactive Agency units are never newly offered. A company with no eligible Departments displays a Settings blocker.

| Draft field changed | Dependent draft values cleared |
|---|---|
| Company | Branch, Department, Section, Team, Position, Work Location |
| Branch | Department, Section, Team, Position, Work Location |
| Department | Section, Team, Position |
| Section | Team, Position |
| Team | Position |

Job Title, Grade, Direct Manager and HR override are preserved for explicit review instead of being silently replaced. Incompatible retained values are labeled and new structural assignments must pass server validation. Clearing is draft-only until confirmed and saved. No company/branch is inferred from legacy units, country, location, email or manager.

Grades sort by configured sort_order, English name, then ID. Locations are independent masters filtered by branch where they have a branch restriction.

## 4. Position-driven behavior

Selecting Position fills its defined Company, Department, Section, Team, Grade and Job Title fields. Obsolete optional Section/Team values are cleared by the existing prefill policy. Position-defined fields are disabled; the user must clear Position before editing those fields manually. The server rejects contradictory values, including tampered requests. A CEO Position clears Direct Manager in the draft and requires a root relationship; this change appears in the review. Existing CEO occupancy validation remains enforced.

## 5. Direct Manager validation

New choices are eligible active/probation/notice-period employees of the explicitly selected company, across its branches. Self-management, descendants/cycles, missing managers, inactive managers, and company conflicts are rejected. Retained legacy managers stay visible and are not replaced automatically. Company transfers still honor the existing direct-report consistency restriction; no related employee is automatically moved.

Employee manager_id remains authoritative. No chart-specific hierarchy storage or writes were added. Existing derived reporting-level refresh behavior is retained.

## 6. HR responsibility

Resolution precedence remains employee override, then company+branch rule, then branch-wide rule. The UI shows the effective person and source separately from the optional persisted override. It also marks missing/ineligible/self HR responsibility unavailable for approval. Changing Company or Branch never writes the resolved HR person into hr_user_id. An unavailable explicit override does not silently fall back to a rule. HR rules, eligible roster, and existing approval routing were not changed.

## 7. Legacy preservation

Inactive, out-of-scope, and missing catalog values remain visible with a retained/needs-review label, including a stable record ID when the catalog record is unavailable. These retained options cannot be newly selected. Unrelated edits do not require replacing legacy Department/Job Title values or filling an unset Company/Branch. Existing empty leave assignments are not forcibly changed by a profile edit.

The editor submits only changed fields. The service reads the current employee under the organization lock and row lock, preserves omitted fields, validates the proposed assignment, persists it, performs existing related save operations, and records actual before/after rows in audit_logs within the same transaction. An audit failure rolls back the save. Legacy assignment columns still persist in the supported pre-readiness fallback path.

## 8. Review and refresh

For organizational changes, Save first shows a per-employee before/after table, including explicit clears. A separate Confirm and save assignment action commits it. Any further edit invalidates the review. The payload includes the reviewed organizational snapshot; a changed server assignment returns HTTP 409 and requires reloading/reviewing rather than overwriting it.

This is a per-profile review workflow, not a bulk migration queue or approval engine. No business mapping recommendations are inferred. The existing authorization and write-origin checks remain at the API boundary.

Successful employee saves retain the existing hr-data-changed event. Profile caches now invalidate on that event; request versions prevent older responses from restoring obsolete employee data. Lists and the existing chart refresh from persisted employee data through the established reload flow. Employee-row editing also opens the profile so it does not bypass organizational review.

## 9. Verification

- Focused suite: 70 tests passed, including actual English/Arabic React server rendering of controls and the review table.
- Full suite: 279 tests; 275 passed, 3 skipped, 1 existing unrelated failure. The failure is the Arabic terminology check against unchanged app/login-form.tsx (the existing spelling أهلاً). It was not changed as part of this task.
- TypeScript: npx tsc --noEmit passed.
- Production build: npm run build passed, with chunk-size/plugin-timing warnings.
- Focused ESLint: zero errors; five pre-existing image-element warnings in app/hr-app.tsx.
- Independent code review found a pre-readiness assignment-save regression. A failing isolated regression reproduced it, the implementation was corrected, and verification passed afterward.

Isolated PostgreSQL verification used only 127.0.0.1:5659/agency_rehearsal, with an asserted database name, port and separate data-directory identity. It never connects to the live port or reads DATABASE_URL. Nine groups passed:

1. Persist every assignment field, preserve every unrelated employee field, and verify actual audit before/after rows.
2. Reject a stale reviewed snapshot with 409 and no employee change.
3. Reject malformed IDs, invalid dates, Position contradictions, incompatible work location, self-management and reporting cycles.
4. Reject inactive and cross-company managers.
5. Derive the existing chart from persisted employee assignments and manager_id.
6. Preserve legacy fields and defaults during an unrelated employee edit.
7. Resolve HR rules without storing an override; test explicit override and removal.
8. Roll back the employee update when the audit write fails.
9. Persist validated legacy assignment columns through the pre-readiness fallback.

All fixture writes were rolled back. Full row fingerprints/counts for every original public/drizzle table matched before and after. Test-only sequence advancement remains in the disposable isolated cluster. No browser-driven live employee save was performed; visual verification here is React rendering plus build checks, not a manual end-to-end browser session.

Evidence: outputs/stage3/isolated-verification.json, focused-tests.log, unit-tests.log, build.log, lint.log.

## 10. Remaining blockers before Stage 4

- Asus Cards master exists, but its Department mapping was stopped in the previous stage; no Departments were inferred or created here. Manager-company, CEO/title and dependent-report conflicts still need explicitly approved resolution.
- KOON Agency's seven units remain inactive pending business branch-scope review and approved activation. Stage 3 does not activate them.
- Existing employee Company, Branch, Department, Position and title mismatches need individual review. No bulk mapping was performed.
- Department branch scope has no supported pending state; this stage does not change that schema or make scope decisions.
- Job Title/Department inconsistencies, CEO placement and manager/direct-report company conflicts must be resolved through approved flows before those particular assignments can save.
- The unrelated login Arabic wording test remains a repository-wide validation issue.
- Stage 4 design and browser acceptance remain separate work. No Organizational Chart redesign was started.

Stopped after Stage 3 implementation and verification.
