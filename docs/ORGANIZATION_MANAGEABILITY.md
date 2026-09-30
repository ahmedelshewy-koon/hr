# Organizational data — manageable from the UI

Implemented 2026-09-26. No live data was changed; no schema or migration was added; Stage 4 (Organizational Chart) not started.
Pre-task copies of edited files: `outputs/org-manageability/before/`. Evidence: `outputs/org-manageability/` (`unit-tests.log`, `lint.log`, `build.log`, `isolated-verification.json`).

## 1. Editability matrix

"Before" = state at the start of this task; "Now" = after it. *Safely change referenced value* means a change to a record that employees or other records already use.

| Entity / field | View | Create | Edit | Deactivate | Safely change referenced value — before → now | Remaining blockers (by design) |
|---|---|---|---|---|---|---|
| Companies | ✔ | ✔ | ✔ | ✔ (blocked by active use, listed) | Branch links: any use of the company blocked removal → only uses of that exact company+branch pair block | Active dependents block deactivation |
| Branches | ✔ | ✔ | ✔ | ✔ | Same pair-specific link rule from the branch side | — |
| company_branches | ✔ | ✔ | — | remove link | Removal blocked by employees / active HR rules / unit scopes / work-location users of that pair, each listed | Historical employees on the pair also block |
| Departments / Sections / Teams | ✔ | ✔ | ✔ | ✔ | Branch scope was locked once referenced → editable; blocked only if current unit employees would fall outside | Company/kind/parent stay locked while referenced (Stage 1) |
| Legacy units (no company) | ✔ | — | was read-only → adopt into a company (reviewed) or deactivate | ✔ | Adoption allowed when every current user is already in that company | Legacy units are never deleted |
| Inactive mapped units (e.g. U65–U71) | ✔ | — | ✔ | — | Reactivation now requires an explicit "Scope review required" confirmation | Never auto-activated |
| Positions | ✔ | ✔ | ✔ | ✔ (occupants listed) | Structural fields locked while referenced; UI now explains: new position + move occupants + deactivate | Kept (no silent occupant rewrite) |
| Job Titles | ✔ | ✔ | ✔ | archive (blocked by current users/active positions) | Rebinding was impossible once referenced → allowed with impact preview + confirmation; generic (NULL department) supported | Blocked if an active position uses the title in another department; no new binding to a legacy unit |
| Grades | ✔ | ✔ | ✔ | ✔ | Unchanged (no structural fields) | — |
| Work Locations | ✔ | ✔ | ✔ | ✔ | Branch locked while referenced (Stage 1) | Kept |
| HR rules | ✔ | ✔ | ✔ | ✔ | Unchanged | — |
| Delete (all master data) | — | — | — | — | Did not exist → "Delete permanently" only for never-referenced records | Referenced records must be deactivated |
| Employee Company | ✔ | ✔ | ✔ | — | Legacy unit/title forced impossible intermediates → one reviewed save validated on the final state | — |
| Employee Branch | ✔ | ✔ | ✔ | — | ✔ | — |
| Employee Department/Section/Team | ✔ | ✔ | ✔ | — | ✔ (legacy → new in one save) | — |
| Employee Position | ✔ | ✔ | ✔ | — | Company-level (CEO) positions no longer cleared by clearing the department / changing branch | — |
| Employee Job Title | ✔ | ✔ | ✔ | — | ✔ | — |
| Employee Manager | ✔ | ✔ | ✔ | — | Manager ↔ direct-report company deadlock required DB transactions → team organizational transfer | — |
| Employee HR override | ✔ | ✔ | ✔ | — | unchanged | — |

## 2. Architecture

UI → API (`/api/hr update_employee`, `/api/organization`, `/api/organization/team-transfer`, `/api/hr save_job_title`) → shared services → shared pure validators → one DB transaction (advisory lock 78231, row locks) → audit rows in the same transaction.

| Module | Role |
|---|---|
| `app/organization/org-errors.ts` | `OrganizationError` (code, field, message_ar/en, blocking_entity, details); API conversion; per-language message helper |
| `app/organization/assignment-policy.ts` | Single assignment policy: `assignmentIssues` (change / diagnose modes), `validateAssignment`, `assignmentDiagnostics`, `assignmentGroupIssues` / `validateAssignmentGroup` |
| `app/organization/assignment-service.ts` | Profile save validation = group of one |
| `app/organization/team-transfer.ts` | Team transfer preview/commit using the same group validator and persistence |
| `app/organization/impact-policy.ts` | Pure impact analysis (job-title rebinding, scope, adoption, reactivation, link removal, unit manager, occupants) |
| `app/organization/catalog-service.ts` | `prepareOrganizationEntity` (shared by preview and save), `enforcePlan`, `saveOrganizationEntity`, `deleteOrganizationEntity` |
| `app/organization/job-title-service.ts` | Job-title save/preview (moved out of `/api/hr`; audit now inside the transaction) |

## 3. Behaviour summary

- **Final-state validation.** A profile save validates the submitted final assignment; a retained legacy value is valid only while untouched. Intermediate states are never required.
- **Team transfer.** Manager + chosen subtree members, per-member Branch/Department/Section/Team/Position/Title; `manager_id` and `hr_user_id` cannot be submitted; partial moves → `PARTIAL_TEAM_TRANSFER`; commit requires each member's reviewed snapshot (`STALE_REVIEW` otherwise); per-employee audit rows (same shape as profile saves) plus one `team_transfer` summary row.
- **Impact preview.** Every edit of existing master data first calls `action=preview`; if anything is blocking or needs review the drawer shows it and the save needs the server's `confirmImpact` token (recomputed on save, so a stale review is refused).
- **Retained unit manager.** A unit's existing manager is re-validated only when the manager, company or activation changes; otherwise unrelated edits (e.g. renaming) are no longer blocked. New assignments get an exact reason (`INVALID_UNIT_MANAGER`: company assignment incomplete / other company / not current).
- **Direct-report rule** ignores soft-deleted (`deleted`) employees; all other statuses still count.

## 4. Verification

- Focused: 115 organization tests (new: `tests/organization-manageability.test.mjs` 23, render tests +4).
- Full suite: 306 tests, 302 pass, 3 skipped, 1 pre-existing failure (Arabic tanween in `login-form.tsx`, unchanged).
- `npx tsc --noEmit` passes; ESLint on changed files: 0 errors (5 pre-existing `<img>` warnings in `hr-app.tsx`); `npm run build` passes.
- Isolated PostgreSQL (`tests/runtime-org-manageability.mjs`, disposable cluster :5677 restored from backup, one rolled-back transaction): 13 checks pass; 87 tables identical after rollback.
- Regression on existing isolated suites: `runtime-stage3-profile.mjs` (9/9), `runtime-organization-assignments.mjs` (all) pass.

## 5. Still requiring direct DB access

None for normal supported organizational operations. By design (not DB-only, but deliberately refused in the UI):
changing company/kind/parent of a referenced unit, or structural fields of a referenced position/work location (use a new record + move + deactivate);
removing a company↔branch link used by historical employee records; deleting any referenced record.
