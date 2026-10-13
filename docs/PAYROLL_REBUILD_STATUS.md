# Payroll rebuild completion audit (2026-10-13)

The Payroll and Timesheet specifications are implemented in the existing TypeScript, Drizzle and PostgreSQL application. Claude's Timesheet Management implementation was reused and extended. This worktree has not been deployed, neither migration was applied to production, and no request was sent to the live Sajel ERP.

## Requirement audit

| Requirement | Implementation and evidence |
| --- | --- |
| Payroll Core and Run | Element setup and unique special flags, eligibility, recurring and matrix entries, monthly variables, 30 day salary proration, month preview, draft recalculation, stale input fingerprint, confirmation, rollback and detail are implemented in app/payroll and the Payroll routes. Confirmed runs and locked months reject conflicting changes. |
| Deductions and attendance bridge | Claude's Timesheet flow retains the 26th to 25th deduction period. Unclassified absences remain uncharged. The dedicated deduction rules screen edits notice rules; migration 0053 seeds the 1 and 2 wage day defaults only if there is no active absence policy. Deduction posting, rollback and reposting use transactions and month lock checks. |
| Time and Attendance | Claude's schedule, holiday, biometric ingestion, recalculate, manual edit, approval, email and Timesheet screens remain in place. Added attendance type setup, WFH check-in/out and force checkout, saved attendance confirmation, raw biometric log view, vacation balance integration, region specific approval routing, stale request escalation, and search, sort, export and print controls. |
| Master data | Business Units remain separate from companies. Business Unit, cost center, BU to cost center account mapping, currency, HR manager, ERP, vacation, shift plan, attendance type and deduction rule setup routes are present. Business Unit and cost center Excel imports are transactional. The employee mapping report lists company, current Business Unit and missing assignment; no assignment is inferred from company_id. |
| Employee configuration | Payroll country, salary currency, Working Business Unit, cost center, explicit termination date and Dopay employee number are editable through existing employee records. The employee card displays the mapped payroll debit account. Salary amounts and exports are gated to master admin and the designated HR head. Historical salary structures remain. |
| Permissions and sessions | The 20 specified route keys exist. Existing roles and authentication are reused; the latest user_permissions record can deny a role granted page. APIs enforce the page permission, HR Manager listing, region and linked Business Units. Timesheet access applies the personal page denial and active manager listing. Session activity enforces three hours idle after migration 0053. PostgreSQL employee delete trigger protects payroll and Timesheet history. |
| Sajel ERP | Batch number precedes AP invoice posting; invoices group by Working Business Unit and GL account, cost center and department. Preview shows payload and currency totals. A claimed run and per invoice attempt log prevent blind duplicate retries. Partial failures require recorded accounting reconciliation. A different master administrator must verify evidence before a failed attempt can be reset or a sent run rolled back. ERP tests use a fake transport only. |
| Historical data and legacy | Migrations are additive and preserve payroll items, salary structures, attendance and accounting data. Obsolete Payroll UI drawers and legacy mutation handlers were removed after checking references. Existing HR and Timesheet flows remain. |
| Bilingual and list controls | New screens follow Sanaa styling with Arabic and English text, RTL direction, filters, two-column sorting, Excel compatible export and print. Excel import is provided for the two setup catalogs specified for import. Claude's Timesheet export remains .xlsx; new Payroll exports use Excel XML .xls. |

## Verification

- Root TypeScript check passes. Scratch files under tmp/ are excluded from the project check.
- Full application build and automated suite pass: 545 passed, 3 pre-existing skips, 0 failed.
- The isolated E2E script creates a fresh local PostgreSQL database from the local schema, applies Timesheet migration 0052 and Payroll migration 0053, seeds synthetic records, exercises WFH and saved attendance, Deduction Summary post/rollback/repost, lock enforcement, stale run rejection, recalculation and confirmation, blocked variable edits, invoice preview and fake Sajel success/partial failure. It also checks the KSA approval chain and three day escalation, then drops the isolated database.
- Git whitespace check passes; Git reports only expected Windows line ending notices.

The isolated test calls application services with a real PostgreSQL transaction and a fake ERP transport. It does not connect to a Sajel sandbox or test a live accounting reversal. Browser interaction was covered by build and component level checks, not a production browser session.

## Migrations and production gate

Apply 0052_timesheet_management.sql before 0053_payroll_rebuild.sql only after explicit production approval and a backup. Neither has been applied to production. The new Payroll API returns HTTP 503 until the required tables are available. Migration 0053 does not assign an employee Business Unit from the company and does not delete historical records.

Before production release, an administrator must review missing employee Working Business Unit assignments in /business-unit-setup, salary currencies and SAR rates, Payroll countries, cost centers and BU to cost center debit accounts, active HR managers and their regions/units, deduction rules, and the Sajel URL/method/key. Payroll elements need the correct GL accounts. Configure mail transport and the worker schedule for attendance reminders, summaries and three day request escalation. Verify endpoint methods, invoice status and accounting reversal in a non-production Sajel environment, then obtain the user's explicit approval for any production migration, deployment or posting.

Production readiness: code and isolated tests ready for review; production rollout is gated on migration approval, organization mapping/configuration and non-production Sajel reconciliation validation.
