# Stage 4 — Organizational Chart

Implemented 2026-09-26/27. The chart is a read-only view derived from stored data. No schema change, no chart tables, no changes to live employee or organization data.
Pre-task copies of edited files: `outputs/stage4-org-chart/before/`. Evidence: `outputs/stage4-org-chart/` (`unit-tests.log`, `tsc.log`, `lint.log`, `build.log`, `qa/browser-qa.json` + screenshots, `live-snapshot-before.json` / `-after.json`).

## 1. Files

| File | Change |
|---|---|
| `app/organization/chart-model.ts` (new) | Pure derivation: `applyChartFilters`, `computeContextNodes`, `deriveReportingForest`, `deriveReportingView`, `deriveOrganizationView`, `computeChartDiagnostics`, `reviewItems`, `chartFilterOptions`, `searchEmployees` |
| `app/organization/latest-loader.ts` (new) | "Latest request wins" loader + `hr-data-changed` subscription |
| `app/organization-chart.tsx` | Rewritten: Reporting / Organization views, filters, context nodes, Needs Review, Quick View, search, list layout |
| `app/organization-chart.css` | Kept the existing tree connectors; added styles for context nodes, badges, list, unit view, review panel and Quick View |
| `app/hr-app.tsx` | `useHRData` now uses `createLatestLoader`; `OrgPage` looks up the selected employee by id and passes `fullAccess` / `canEdit` |
| `app/api/hr/route.ts` | Adds `manager_scope` for hidden managers and `employeeScope` (`full` / `limited`) to the response. The existing visibility scope is unchanged |
| `tests/organization-chart-stage4.test.mjs`, `tests/organization-chart-render.test.mjs` (new) | 31 model tests + 10 render tests |

## 2. Audit of the old chart

- **`organization-chart.tsx` (before):** it built the manager tree with `buildReportingForest`, which dropped reporting lines between companies. Its filters removed managers who didn't match, so reporting chains broke, and search worked as a filter. The file was replaced; the tree layout (connectors, the stack of 5 or more leaves, zoom, fit, print) was reused.
- **`reporting-tree.ts`:** superseded. The UI no longer uses it. It is kept because existing runtime tests import `buildReportingForest`.
- **`LegacyOrgPage` (hr-app.tsx):** the old department-based chart. It uses parent chains and guesses companies from names ("Managing Director", "Koon Software"). It is kept only as the fallback when the organization tables are missing, and it never renders on a migrated database. Its edit controls were already disabled, and its write actions return 410. A test pins its print header.
- **`organizational_level` / `refreshReportingLevels`:** department-relative levels. The chart does not use them.

## 3. Architecture

Data source: the existing `GET /api/hr` payload, which is already scoped by permission, plus the organization catalog. The hierarchy is always rebuilt in the browser from `employees.manager_id` and the assignment columns. Nothing chart-specific is stored or written.

- **Reporting view:** the tree is built from `manager_id` only. An employee whose manager is missing, filtered out or hidden becomes a root. Lines between companies are kept. A reporting cycle is cut at its smallest id (marked `cycleBreak`), so each employee renders once. There can be several roots. They are grouped by company, with an "Unassigned company" group.
- **Organization view:** employees are placed by stored assignment only (team, else section, else department).
  - Company → Company leadership (a company position with no unit) / Departments → Sections → Teams / Department not assigned / Legacy / Needs review.
  - In By Branch mode, the company level is followed by Branch, with a "Branch not assigned" group.
  - Legacy units, units from other companies and missing units are listed as retained records and are never merged by name. Inactive units show only while they still have employees.
- **Filters and context nodes:** filters cover Company, Branch, Department (including its sections and teams) and Status. "Not assigned" is available for Company and Branch.
  - A manager who doesn't match the filters is kept as a context node only in two cases: they are the direct manager of a matching employee, or they sit between a matching employee and a matching ancestor further up.
  - Each context node shows why it is outside the filter (another company or branch with its name, outside the department, or its status).
  - Every count comes from the set of matching employees, so context nodes never inflate totals.
- **Diagnostics:** `assignmentDiagnostics` is the same shared rule set the Employee Profile uses. The chart adds checks for missing Company, Branch, Department and Position, missing or deleted managers, cycles, and reporting across companies.
  - **Error:** broken relationship.
  - **Warning:** incomplete or retained data.
  - **Info:** optional setup.
  - A unit or branch that falls outside the company only because the employee's Company or Branch is unset counts as a Warning, not an Error.

## 4. Behaviour

- **Needs Review panel:** each row shows the employee, the problem, the field, the severity and an **Open Employee Profile** button. It follows the current filters and can be narrowed by severity.
- **Quick View:** a side panel showing:
  - identity and status;
  - Company, Branch, Department, Section, Team, Position and Job Title, with inactive/legacy/unavailable markers;
  - the direct manager (clickable), or "outside your access scope";
  - the number of direct reports;
  - the diagnostics.

  Its actions are Open Employee Profile (`EmployeeProfile360`), Edit Employee Profile (shown only with `employees/edit`; it opens the existing `EmployeeDetailsDrawer`) and Show in chart.
- **Search:** covers name (Arabic and English), employee code, Job Title and Position within the current view. Picking a result opens the path to that employee, scrolls to them and highlights them.
- **Expand / collapse:** the state is kept per employee id and survives data reloads. Above 300 nodes the chart opens only two levels by default. Above 1500 nodes, Expand all is disabled.
- **Mobile layout:** at 760px or less the Reporting view switches to an indented list (it can also be switched by hand). The Organization view is a nested list at every width.
- **Read-only:** the chart has no drag & drop, no inline editing and no API writes. A static test checks this.

## 5. Permissions

The chart only receives employees the API already allows the viewer to see:

- Super Admin and HR Manager see the whole company.
- A Department Manager sees themselves and the departments they manage.

A manager outside that scope is never shown. The chart shows the note "Reporting manager outside your access scope" instead. It never shows that manager's name or code, and never invents a node for them.

The server tells a limited viewer only `manager_scope='restricted'`. Only full-access viewers learn whether a hidden manager is missing or deleted.

Filter choices for limited viewers contain only the companies, branches and units their visible employees use. "Show empty units" is available only with full access.

## 6. Refresh

`useHRData` uses `createLatestLoader`. Each load gets a version number, and a response is applied only if it is still the newest, so an older response cannot overwrite newer data. Unmounting cancels any pending load. The page reloads on `hr-data-changed`, which fires after profile saves, team transfers and Settings changes. The page looks up the selected employee by id, so an open profile or Quick View always shows fresh data.

## 7. Verification

- **Stage 4 tests:** 41 pass. All organization tests: 158/158.
- **Full suite:** 347 tests: 343 pass, 3 skipped, 1 fails. The failure is the known Arabic tanween test for `login-form.tsx`, which is unrelated to this work.
- **Type check:** `tsc --noEmit` passes.
- **ESLint on changed files:** 0 errors. There are 6 `<img>` warnings, the same pattern already present.
- **Build:** `npm run build` passes.
- **Browser QA:** 84/84 checks pass (`outputs/stage4-org-chart/qa-browser.mjs`). It ran in headless Chrome against a clone of live (dumped from live with `pg_dump` into a separate PostgreSQL on port :5683) and a preview app on :3019, with synthetic users and synthetic `QA4-*` employees (a terminated manager and a reporting cycle).
  - Covered: Arabic RTL and English LTR at 1440, 820 and 390 px; the Reporting view; filters by company and by company + branch, with counts checked against the database; context nodes; search; Quick View; opening the profile; Needs Review; the Organization view by Department and by Branch (each employee placed exactly once); a Department Manager viewer (manager hidden, no identity shown); refresh on `hr-data-changed` with no page reload.
  - Nothing was written to employees or audit logs during the read-only checks.
- **Live data:** employee data is identical before and after (md5 `27b90f50…`). The only new live row is audit 1119, a normal login by user 40 on :3000 that did not come from this work.

## 8. Remaining limitations

- In the current live data, nobody appears under **Company leadership**. The CEO (E001) still keeps legacy unit U14, so the chart correctly lists them under Legacy / Needs review.
- All live companies have only the old `name` field (no Arabic or English name), so their names are not translated.
- Print is only for the tree layout of the Reporting view. It was checked only with the existing print-media method.
- The chart loads the full `/api/hr` payload, as the old page did. It has no dedicated lighter endpoint.
