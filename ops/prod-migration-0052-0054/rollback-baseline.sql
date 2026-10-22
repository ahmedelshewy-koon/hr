-- State of everything 0052-0054 introduced, as one string (:hr_rb_state). Captured right after COMMIT while HR is
-- stopped (the baseline) and recomputed by rollback: any difference means data was written into the new objects
-- (including hr_managers, portal_session_activity, user_permissions), a seeded row was changed, or the recorded
-- ledger rows changed, or a reconciliation job-history row changed - and the logical rollback is refused.
-- Needs perm_max_id, dr_max_id, hist_max_id, ledger_pre_max_id.
-- Runs in a writable transaction (temp table); the caller ends it with ROLLBACK or uses it inside rollback.
CREATE TEMP TABLE IF NOT EXISTS hr_rb_fp (name text PRIMARY KEY, val text NOT NULL);
TRUNCATE hr_rb_fp;
SELECT format('INSERT INTO hr_rb_fp SELECT %L, count(*) || ''/'' || md5(coalesce(string_agg(t::text, chr(10) ORDER BY t::text), '''')) FROM public.%I t', 'table:' || x, x)
FROM unnest(ARRAY['timesheets','timesheet_edit_permissions','timesheet_month_locks','payroll_variable_entries',
 'payroll_month_locks','shift_plans','shift_plan_details','shift_assignments','company_wfh_days','business_units',
 'business_unit_cost_center_mapping','payroll_currencies','hr_managers','hr_manager_business_units','payroll_elements',
 'payroll_element_eligibility','payroll_employee_elements','request_escalations','payroll_run_lines','payroll_erp_settings',
 'payroll_erp_invoice_attempts','payroll_erp_reconciliations','employee_wfh_days','wfh_sessions','saved_attendance',
 'user_permissions','portal_session_activity']) x
WHERE to_regclass('public.' || x) IS NOT NULL ORDER BY x \gexec
INSERT INTO hr_rb_fp SELECT 'seed:permissions', count(*) || '/' || md5(coalesce(string_agg(p::text, chr(10) ORDER BY p.id), '')) FROM permissions p WHERE p.id > :perm_max_id;
INSERT INTO hr_rb_fp SELECT 'recon:employee_job_history', count(*) || '/' || md5(coalesce(string_agg(h::text, chr(10) ORDER BY h.id), '')) FROM employee_job_history h WHERE h.id > :hist_max_id;
INSERT INTO hr_rb_fp SELECT 'seed:deduction_rules', count(*) || '/' || md5(coalesce(string_agg(d::text, chr(10) ORDER BY d.id), '')) FROM deduction_rules d WHERE d.id > :dr_max_id;
INSERT INTO hr_rb_fp SELECT 'ledger:package', count(*) || '/' || md5(coalesce(string_agg(m.id || ':' || m.hash || ':' || m.created_at, ',' ORDER BY m.id), ''))
FROM drizzle.__drizzle_migrations m WHERE m.id > :ledger_pre_max_id;
SELECT string_agg(name || '=' || val, ';' ORDER BY name) AS hr_rb_state, count(*) AS hr_rb_parts FROM hr_rb_fp \gset
