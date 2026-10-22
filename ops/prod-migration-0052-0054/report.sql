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

\echo ===== APPROVAL ROUTING =====
\echo Unchanged by this migration: with no HR manager assigned, the new release keeps the current routing (legacy path
\echo when no workflow applies; configured workflows as today). Requests already in progress keep their stored route.
SELECT (SELECT count(*) FROM requests WHERE status LIKE 'pending%') AS requests_in_progress,
       (SELECT count(*) FROM approval_workflow_runs WHERE state = 'pending') AS workflow_runs_in_progress;
\echo Changes only AFTER HR managers are assigned (separate approval): for employees with a payroll country, the HR
\echo step goes to the regional HR managers; where no workflow applies, new requests get a manager -> HR chain.
SELECT count(*) FILTER (WHERE has_region AND NOT has_workflow) AS would_get_default_chain,
       count(*) FILTER (WHERE has_region AND has_workflow) AS hr_step_would_go_to_regional_managers,
       count(*) FILTER (WHERE NOT has_region) AS unchanged_no_payroll_country
FROM (SELECT lower(btrim(coalesce(e.salary_country,''))) IN ('egypt','eg','egy','مصر','جمهورية مصر العربية','ksa','saudi arabia','saudi','sa','kingdom of saudi arabia','السعودية','المملكة العربية السعودية') AS has_region,
             EXISTS (SELECT 1 FROM approval_workflows w WHERE w.company_id = e.company_id AND w.active) AS has_workflow
      FROM employees e WHERE e.employment_status IN ('active','probation','notice_period')) s;

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
