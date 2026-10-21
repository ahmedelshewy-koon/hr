-- Informational preflight report (read-only). Shows who and what 0052-0054 will affect so the change can be announced.
\pset footer off
\echo
\echo ===== DATABASE =====
SELECT current_database() AS database, current_user AS db_user, version() AS server_version,
       pg_size_pretty(pg_database_size(current_database())) AS size;
\echo ===== OTHER CONNECTIONS TO THIS DATABASE (stop writers before apply) =====
SELECT pid, usename, application_name, client_addr, state, now() - xact_start AS xact_age
FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY xact_start NULLS LAST;

\echo ===== SESSION INVALIDATION =====
\echo After 0053 creates portal_session_activity, any portal session without a row there is rejected ("Session idle timeout").
\echo No existing session has a row, so EVERY signed-in user is logged out once and must sign in again.
SELECT count(*) AS active_users, count(*) FILTER (WHERE last_login_at > now() - interval '3 hours') AS signed_in_last_3h
FROM users WHERE status = 'active';

\echo ===== HR MANAGER ACCESS CHANGE =====
\echo Once hr_managers exists, HR Manager role users NOT listed in it: cannot open Timesheet or Payroll (403), see no
\echo employees in timesheet scope, and are not payroll-region approvers. Only admin_order=0 managers may set salaries
\echo or make privileged profile edits. Assign them with --hr-managers (see RUNBOOK) or in Payroll > HR Manager Setup.
SELECT u.id AS user_id, u.email, u.status, u.employee_id, e.employee_code, e.employment_status,
       coalesce(e.salary_country, e.country) AS payroll_country_hint
FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN employees e ON e.id = u.employee_id
WHERE r.name = 'HR Manager' ORDER BY u.status, u.id;

\echo ===== APPROVAL ROUTING CHANGE =====
\echo With hr_managers present, a request type with no active workflow for the employee gets a default
\echo manager -> HR chain (previously the legacy path). Active employees whose company has no active workflow at all:
SELECT count(*) AS employees_without_any_company_workflow FROM employees e
WHERE e.employment_status IN ('active','probation','notice_period')
  AND NOT EXISTS (SELECT 1 FROM approval_workflows w WHERE w.company_id = e.company_id AND w.active);

\echo ===== DATA SEEDED BY 0052/0053 =====
SELECT count(*) AS active_absence_rules,
       CASE WHEN count(*) = 0 THEN '0053 WILL INSERT 2 absence deduction rules (1 and 2 days of wage)' ELSE 'no deduction rules will be added' END AS effect
FROM deduction_rules WHERE rule_type = 'absence' AND status = 'active';
SELECT r.name AS role, count(p.id) AS existing_grants_on_new_pages
FROM roles r LEFT JOIN permissions p ON p.role_id = r.id AND p.module IN ('timesheetManagement','payrollElementSetup','payrollEligibility',
 'payrollEmployeeElements','payrollMatrixEntry','payrollVariableEntry','payrollMonthPreview','payrollRun','deductionRulesSetup',
 'savedAttendance','attendanceTypeSetup','shiftPlansSetup','vacationSetup','hrManagerSetup','businessUnitSetup','costCenterSetup',
 'buCostCenterMapping','wfhCheckin','zkAttendanceLogs','sajelErpSetup')
WHERE r.name IN ('Super Admin','HR Manager') GROUP BY r.name;
\echo (0052 grants timesheetManagement; 0053 grants view+edit on 19 payroll/attendance pages to Super Admin and HR Manager roles.)

\echo ===== BEHAVIOUR CHANGES =====
SELECT count(DISTINCT employee_id) AS employees_with_payroll_items,
       'trigger trg_reject_employee_payroll_delete will block deleting these employees' AS effect FROM payroll_items;
SELECT count(*) AS payroll_runs, 'existing runs keep currency NULL and totals 0 (new columns); history untouched' AS effect FROM payroll_runs;
