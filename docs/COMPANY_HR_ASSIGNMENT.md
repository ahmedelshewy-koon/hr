# Company and HR responsibility

## Configure and use

1. Settings → Companies: add company names. Rename or deactivate instead of deleting linked records.
2. Settings → HR responsibles: enable existing active HR Manager or Super Admin accounts. This list does not create accounts or grant roles.
3. Employee profile → Employment: select company and HR responsible. The work-location/country fields retain their existing behavior.
4. Employee requests and attendance correction requests require an active assigned HR. Missing, disabled, ineligible or self-assigned HR returns an Arabic error before submission is stored.
5. Approval proceeds through the direct manager and then the assigned HR. Leave requests use both stages. Reassignment governs pending requests too; the former responsible cannot act and stale actionable notifications are removed. Users cannot approve their own requests.
6. Reports → File exports → Missing employee data: select company, country, work location and employment status, then export Excel. Only incomplete records in the caller's existing report scope are included. Optional personal/bank/contact fields are excluded. Unavailable company/HR assignments are flagged.

Existing employee records are retained without inventing company or HR assignments. Complete these in Settings and profiles before employees submit requests.

## Database deployment

`0029_employee_company_hr.sql` is additive and idempotent. Apply the normal migration chain on a fully tracked database. For this existing locally managed database, `node scripts/apply-company-hr-migration.mjs` applies only this migration in a transaction and verifies employee row counts. It does not advance the legacy Drizzle journal past earlier pending migrations. The matching schema snapshot prevents future generators from recreating these tables.

## Verification

- `node --test tests/*.test.mjs`
- `node tests/runtime-company-hr.mjs` (local fixtures created and removed)
- `npx tsc --noEmit`
- `npm run build`
