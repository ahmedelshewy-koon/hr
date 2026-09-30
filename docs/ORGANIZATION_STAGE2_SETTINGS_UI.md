# Stage 2 — Organizational Structure Settings UI

Settings feed the Employee Profile; the Employee Profile stores the actual assignment; the organization chart is
derived from assignments and manager lines. Stage 2 is the Settings half of that chain. No migration was created or
edited (0030 and its journal/snapshot are untouched) and Stage 3 (Employee Profile integration) has not started.

## Where things are

Settings → **Organizational Structure** (one panel, one grouped navigation, no nine top-level tabs):

| Section | Sub-views | Notes |
| --- | --- | --- |
| Companies & Branches | Companies, Branches | Names, code, status, branch ↔ company associations, derived CEO, usage |
| Departments | Departments, Sections, Teams | One shared unit per company with a branch scope (all / selected); legacy units flagged **Needs review** |
| Positions | Positions, Job Titles, Grades | Job titles remain the single catalog (generic titles have no department); grades sorted server-side order |
| Work Locations | — | Separate from Branch; legacy free text is reported, never mapped |
| HR Responsibility | Routing rules, Eligible roster | Precedence legend, company + branch resolution tester |

Code map: `app/organization-settings.tsx` (shell) → `app/settings/organization/*` (sections) →
`app/settings/settings-ui.tsx` (shared components) → `app/organization/settings-model.ts` and `selectors.ts`
(pure logic, unit-tested in Node).

## Shared components and hooks

`SettingsSubnav`, `MasterDataTable` (cards under 720px container width), `MasterDataToolbar` / `useMasterFilter`,
`MasterDataDrawer`, `TextField` / `SelectField` / `CheckField` / `CheckGroup`, `BilingualFields`, `StatusBadge`,
`UsageNotice` / `UsageCell` / `LockNotice`, `useOrganizationAccess` (permissions), `useOrganizationSnapshot` (one
repeatable-read server snapshot), `useDrawerForm`, and the selectors in `app/organization/selectors.ts`
(company branches, unit parents, optional sections/teams, generic + department job titles, grade order).

## Server changes (small, additive)

* `GET /api/organization` also returns `occupants` (current employees per position — the CEO is derived from these),
  `hrScopes` (current employees per company/branch and how many have an explicit HR override) and
  `legacyWorkLocations` (unmapped free-text locations). Implemented in `app/organization/settings-insights.ts`,
  read-only, same snapshot as the catalog and usage counts.
* `POST /api/organization` for `branches` accepts `companyIds` so a branch can serve several companies from the
  branch side. Same rules as the company side: active companies only, and removing an association is a structural
  change that is refused while the branch is referenced. Audit records the association set.

## Permissions

`system_settings/view` opens the area, `system_settings/manage_settings` enables writes, and both still require the
Super Admin or HR Manager role (server: `/api/organization`; UI: `organizationSettingsAccess`). Department and
job-title grants never open it. Viewers get a "View only" badge, "View" instead of "Edit", read-only drawers and no
create buttons; the server returns 403 for their writes. Job titles are written through the catalog's own
`job_titles` create/edit permission, so the Job Titles editor needs both grants (the UI says so).

## Usage, locks and blocked actions

Counts (total / active / historical) come from the server's reference map. The UI mirrors the server contract:
deactivation is locked by **active** dependents ("Locked: used by 12 active employees"), structural fields
(company, parent, scope, position assignment, grade, branch link removal…) are locked by **any** reference except
company/branch link rows. This is a display of server data; every write is re-validated and can still be refused
with a localized 409.

## Legacy retirement

* Company editing: the Stage 1 tabbed editor and the duplicate Companies form are gone once the schema exists;
  `CompanyHrSettings` only remains as the pre-migration fallback.
* Departments: Employees → Departments now shows **Manage in Settings** (authorized administrators land on
  Settings → Departments). The legacy department drawer only opens before the schema exists.
* Job titles: the Employees → Job titles tab is unchanged; the same catalog is surfaced under Positions → Job Titles.
* Chart hierarchy editing stays read-only.

## Not done here (by design)

No legacy mapping, no linking of accounts/employees, no HR assignment, no data backfill. Legacy units without a
company are only *shown* as Needs review; they cannot be edited here until a reviewed mapping exists (the server
rejects mapping a referenced unit, which is the Stage 1 rule).
