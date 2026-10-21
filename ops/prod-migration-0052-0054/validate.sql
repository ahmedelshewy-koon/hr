-- Post-migration validation. Runs inside the transaction before COMMIT and again read-only after COMMIT.
-- Expects psql variables: hr_manager_count, head_when (expected-ledger.sql).
SELECT coalesce(string_agg(t, ', '), '') AS hr_v_missing_tables
FROM unnest(ARRAY['timesheets','timesheet_edit_permissions','timesheet_month_locks','payroll_variable_entries',
 'payroll_month_locks','shift_plans','shift_plan_details','shift_assignments','company_wfh_days','business_units',
 'business_unit_cost_center_mapping','payroll_currencies','hr_managers','hr_manager_business_units','payroll_elements',
 'payroll_element_eligibility','payroll_employee_elements','request_escalations','payroll_run_lines','payroll_erp_settings',
 'payroll_erp_invoice_attempts','payroll_erp_reconciliations','employee_wfh_days','wfh_sessions','saved_attendance',
 'user_permissions','portal_session_activity']) t WHERE to_regclass('public.'||t) IS NULL \gset
SELECT coalesce(string_agg(x.q, ', '), '') AS hr_v_missing_columns
FROM unnest(ARRAY['employees.attendance_type_id','employees.shift_plan_id','holidays.religion',
 'attendance_types.early_exit_allowance_minutes','attendance_types.weekend_days','employees.working_business_unit_id',
 'employees.termination_date','employees.dopay_employee_number','payroll_runs.sar_currency_rate','payroll_runs.currency',
 'payroll_runs.total_gross','payroll_runs.total_deductions','payroll_runs.total_net','payroll_runs.employee_count',
 'payroll_runs.input_fingerprint','payroll_runs.confirmed_by','payroll_runs.confirmed_at','payroll_runs.sent_to_accounting_by',
 'payroll_runs.sent_to_accounting_at','payroll_runs.erp_post_started_at','payroll_runs.erp_post_failed_at',
 'payroll_runs.erp_batch_number']) x(q)
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name||'.'||c.column_name = x.q) \gset
SELECT coalesce(string_agg(i, ', '), '') AS hr_v_missing_indexes
FROM unnest(ARRAY['idx_timesheets_employee_date','idx_timesheets_date_status','idx_timesheet_edit_permissions_month_employee',
 'idx_timesheet_month_locks_month_country','idx_payroll_variable_entries_key','idx_payroll_variable_entries_period',
 'idx_payroll_month_locks_period_country','idx_shift_plan_details_plan_weekday','idx_shift_assignments_employee_date',
 'idx_company_wfh_days_date_country','idx_payroll_basic_flag','idx_payroll_delay_flag','idx_payroll_absence_flag',
 'idx_payroll_employee_elements_period','idx_payroll_runs_month_year_country','idx_payroll_runs_period_currency',
 'idx_request_escalations_run_step','idx_payroll_run_lines_run_employee','idx_payroll_erp_invoice_attempts_run',
 'idx_payroll_erp_reconciliations_run','idx_wfh_sessions_employee_date','idx_wfh_sessions_one_open','idx_saved_attendance_date',
 'idx_user_permissions_latest','idx_portal_session_activity_user','idx_employees_work_email']) i
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=i) \gset
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_reject_employee_payroll_delete' AND tgrelid='public.employees'::regclass) AS hr_v_trigger,
  (SELECT count(*) FROM pg_indexes WHERE indexname='idx_employees_work_email' AND indexdef LIKE '%WHERE%deleted%') AS hr_v_email_idx,
  (SELECT count(*) FROM pg_indexes WHERE indexname='idx_payroll_runs_month_year_country' AND indexdef LIKE '%currency IS NULL%') AS hr_v_runs_idx,
  (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='approval_workflow_runs' AND column_name='workflow_id') AS hr_v_wf_nullable,
  (SELECT count(*) FROM payroll_currencies WHERE code='SAR' AND sar_rate=1) AS hr_v_sar,
  (SELECT count(*) FROM hr_managers) AS hr_v_managers,
  (SELECT count(*) FROM permissions p JOIN roles r ON r.id=p.role_id WHERE r.name='Super Admin' AND p.module='timesheetManagement' AND p.allowed=1) AS hr_v_ts_perm,
  (SELECT count(*) FROM drizzle.__drizzle_migrations) AS hr_v_ledger_rows,
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations) AS hr_v_ledger_head \gset
\echo HR_VALIDATE missing_tables=[:hr_v_missing_tables] missing_columns=[:hr_v_missing_columns] missing_indexes=[:hr_v_missing_indexes]
\echo HR_VALIDATE trigger=:hr_v_trigger email_idx=:hr_v_email_idx runs_idx=:hr_v_runs_idx workflow_id_nullable=:hr_v_wf_nullable sar=:hr_v_sar hr_managers=:hr_v_managers/:hr_manager_count ledger=:hr_v_ledger_rows@:hr_v_ledger_head
SELECT (:'hr_v_missing_tables' <> '' OR :'hr_v_missing_columns' <> '' OR :'hr_v_missing_indexes' <> ''
        OR :hr_v_trigger <> 1 OR :hr_v_email_idx <> 1 OR :hr_v_runs_idx <> 1 OR :'hr_v_wf_nullable' <> 'YES'
        OR :hr_v_sar <> 1 OR :hr_v_managers <> :hr_manager_count OR :hr_v_ts_perm < 1
        OR :hr_v_ledger_rows <> 55 OR :hr_v_ledger_head <> :head_when) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'POST-MIGRATION VALIDATION FAILED'; END $$;
\endif
\echo HR_VALIDATION=PASS
