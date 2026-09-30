# HR Responsibility Settings & Automatic Resolution

Done 2026-09-27. **No live data was changed**: no rules, no roster entries, no account links, and no employee overrides were written on live. The live database was not running during this work and was never contacted. There was no schema change.

Evidence folder: `outputs/hr-responsibility/`.

| File | Contents |
|---|---|
| `setup-cluster.mjs`, `cluster.json` | Disposable clone on :5701, restored from the verified Stage 5 live backup (SHA-256 checked) |
| `isolated-verification.json` | Runtime results of `tests/runtime-hr-responsibility.mjs` |
| `seed-qa.mjs`, `reset-qa.mjs`, `qa-lib.mjs`, `qa-browser.mjs`, `qa/` | Browser QA and its screenshots |
| `verify/` | Unit tests, tsc, lint and build logs |

## Resolution

There is one resolver, `resolveEmployeeHrResponsibility` in `app/organization/hr-responsibility.ts`. The first match wins:

1. **Employee override:** `employees.hr_user_id`, an explicit exception.
2. **Company + Branch rule** (active).
3. **Branch Fallback rule** (active, `company_id` NULL).
4. **None:** "Needs HR setup". Nobody is assigned silently.

Rules:

- If the matched person cannot act (inactive, not linked to an employee, not HR, or the employee themself), the result is **unavailable**. It never falls through to a lower rule, and requests are refused with the existing 409.
- The resolver never looks at department, job title, manager, country, work location or email.
- The resolved person is derived and is never written to `employees.hr_user_id`.
- Workflows filter by the same precedence written as SQL (`effectiveHrSql`). A unit test and an isolated runtime test check that the SQL and the resolver agree for every current employee.

**Eligibility:** there is one rule, `HR_ELIGIBLE_SQL` in `app/organization/hr-roster.ts`. An eligible person has:

- an active account;
- the HR Manager or Super Admin role;
- a link to a **current employee** (active, probation or notice period);
- an active entry on the roster (`hr_responsibles`).

Unlinked accounts are no longer accepted anywhere. Before this change, the rule check, override check, request routing, approval queue, dashboard, notifications and missing-data report all still accepted them.

## Settings → Organizational Structure → HR Responsibility

- **Summary:**
  - Active Rules
  - Employees Resolved
  - Employees With Overrides
  - Needs HR Setup
  - HR unavailable (shown only when the count is above zero)
- **Setup blockers:**
  - "No eligible HR Responsible is available…"
  - The HR-capable accounts that are not linked to an employee, by email.
- **Rules table:** Company, Branch, HR Responsible, Rule Type, Employees Affected (counted by the resolver, so overrides are excluded) and Status. Each row has Edit/View and Activate/Deactivate.
- **Rule drawer:**
  - Rule Type is explicit. The Company field only appears for Company + Branch.
  - Branch choices are the company's linked branches, or, for a Fallback, active branches linked to an active company. The unlinked junk "Branch 1" never appears.
  - A duplicate scope is warned about inline.
- **Impact preview before any change** (uses the existing preview → confirm token pattern):
  - how many employees resolve through the rule;
  - who moves to this rule's HR;
  - who switches to another rule;
  - who becomes "Needs HR setup";
  - who keeps an override.

  A token that no longer matches the current impact returns `STALE_REVIEW`.
- **Test HR Responsibility:**
  - By employee: Company, Branch, explicit override, resolved HR, source, matched rule and warnings.
  - By Company + Branch.
  - It writes nothing.
- **Eligible roster:** the existing roster, now with the reason when an entry is not eligible.

**Structured bilingual errors:**

- `HR_RULE_DUPLICATE` (also for the unique index)
- `HR_RULE_TYPE_INVALID`
- `HR_ACCOUNT_NOT_LINKED`
- `HR_EMPLOYEE_INACTIVE`
- `HR_RESPONSIBLE_INVALID`
- `BRANCH_NOT_LINKED`
- `STALE_REVIEW`
- `HR_ROUTING_CHANGE` (a confirmation warning)

## Employee Profile

- **Profile view:** shows Resolved HR Responsible (with "Needs HR setup" and the reason when unresolved), the source (for example "Asus Cards + Cairo rule" or "Riyadh Branch Fallback"), and the Employee HR override. The override shows "None — automatic HR assignment" when empty.
- **Edit form:**
  - The override select offers "No override — use automatic HR assignment" and eligible HR people only.
  - Underneath, a read-only derived line updates live as the company, branch or override changes.
  - Clearing the override stores NULL.
- **`AssignmentReview`:** adds a "Resolved HR Responsible (derived)" before/after row when the result changes. Note: a concurrent session removed this review panel and the form's explanatory paragraphs from the employee drawer on 2026-09-27 (09:49–09:57). The component and its tests are intact.
- **Permissions:** only HR Manager or Super Admin with `employees/edit` can set or clear an override. An HR Manager cannot change the override on their own record (403).

## Workflows now on the effective resolver

These were already on `effectiveHrSql` and now require a linked account:

- request submission and approval (leave, attendance corrections, requests) via `requireEmployeeHr` / `assertEmployeeHr`;
- the approvals queue;
- the dashboard;
- notifications.

Fixed:

- The employee list's HR name and the reports "HR responsible" filter used the raw override. They now use the effective HR.
- The profile API had its own rule query. It now calls the shared resolver.

Unchanged: historical approvals, request actions and audit rows. Rule saves never write employee records.

## Remaining setup on live

- **No eligible HR Responsible exists on live.** The HR-capable accounts `admin@koonhr.com`, `admin.demo@koonhr.com` and `hr.demo@koonhr.com` are not linked to employees.
  - **Blocker:** the interface has no way to link an *existing* account to an employee.
  - **Supported path:** in Users, a Super Admin creates an account for the HR person's employee record with the HR Manager role. That person is then added to the Eligible roster.
- **Company + Branch assignments need business approval:** 3 companies × 2 branches (Riyadh, Cairo), plus optional Branch Fallbacks. Until rules exist, every current employee shows "Needs HR setup" and requests are refused with the existing message.
