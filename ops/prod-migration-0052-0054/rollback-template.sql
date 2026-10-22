-- Logical rollback of 0052-0054, run as ONE transaction by `hr-migrate-0052-0054.sh rollback`.
-- Allowed ONLY while every object 0052-0054 introduced is exactly as the migration left it. Any data in a new table
-- (hr_managers, portal_session_activity, timesheets, payroll tables, ...), any non-default value in a new column
-- (payroll_runs tracking fields, employees.working_business_unit_id, ...), any change to a seeded permission or
-- deduction rule, or any change to the recorded ledger rows refuses the rollback: restore the verified backup instead
-- (RUNBOOK section 7). Existing (pre-package) ledger rows are never touched. The approved reconciliation rows
-- (job history above hist_max_id, permissions above perm_max_id) are removed too, only while unchanged since apply.
-- Variables (rollback-vars.sql, captured at apply): perm_max_id, dr_max_id, hist_max_id, ledger_pre_max_id, orig_runs_idx,
-- orig_email_idx, wf_was_not_null, rb_baseline; plus attested_ledger_fp, expected_ledger, rollback_run_id.

-- Guard 1: every new table, the seeded rows and the package ledger rows match the post-apply baseline.
\i_rollback_baseline
SELECT coalesce(string_agg(coalesce(b.name, c.name), ', ' ORDER BY coalesce(b.name, c.name)), '') AS hr_rb_changed
FROM (SELECT split_part(x, '=', 1) AS name, split_part(x, '=', 2) AS val FROM unnest(string_to_array(:'rb_baseline', ';')) x) b
FULL JOIN hr_rb_fp c ON c.name = b.name
WHERE b.val IS DISTINCT FROM c.val \gset

-- Guard 2: no new column holds anything but its default (generic over all 22 columns 0052-0054 add).
CREATE TEMP TABLE hr_rb_cols (col text PRIMARY KEY, n bigint NOT NULL);
SELECT format('INSERT INTO hr_rb_cols SELECT %L, count(*) FROM public.%I WHERE %I IS DISTINCT FROM %s',
              c.table_name || '.' || c.column_name, c.table_name, c.column_name, coalesce(c.column_default, 'NULL'))
FROM information_schema.columns c
JOIN unnest(ARRAY['employees.attendance_type_id','employees.shift_plan_id','holidays.religion',
 'attendance_types.early_exit_allowance_minutes','attendance_types.weekend_days','employees.working_business_unit_id',
 'employees.termination_date','employees.dopay_employee_number','payroll_runs.sar_currency_rate','payroll_runs.currency',
 'payroll_runs.total_gross','payroll_runs.total_deductions','payroll_runs.total_net','payroll_runs.employee_count',
 'payroll_runs.input_fingerprint','payroll_runs.confirmed_by','payroll_runs.confirmed_at','payroll_runs.sent_to_accounting_by',
 'payroll_runs.sent_to_accounting_at','payroll_runs.erp_post_started_at','payroll_runs.erp_post_failed_at',
 'payroll_runs.erp_batch_number']) x(q) ON c.table_schema = 'public' AND c.table_name || '.' || c.column_name = x.q
ORDER BY 1 \gexec
SELECT count(*) AS hr_rb_cols_checked,
       coalesce(string_agg(col || '=' || n, ', ' ORDER BY col) FILTER (WHERE n > 0), '') AS hr_rb_cols_used,
       (SELECT count(*) FROM approval_workflow_runs WHERE workflow_id IS NULL) AS hr_rb_null_workflow
FROM hr_rb_cols \gset
\echo HR_ROLLBACK changed_objects=[:hr_rb_changed] new_columns_checked=:hr_rb_cols_checked/22 non_default=[:hr_rb_cols_used] workflow_runs_without_workflow=:hr_rb_null_workflow
SELECT (:'hr_rb_changed' <> '' OR :'hr_rb_cols_used' <> '' OR :hr_rb_cols_checked <> 22 OR :hr_rb_null_workflow > 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'ROLLBACK REFUSED: objects introduced by 0052-0054 hold data or were changed since apply. Restore the verified backup instead (RUNBOOK section 7).'; END $$;
\endif

DROP TRIGGER trg_reject_employee_payroll_delete ON employees;
DROP FUNCTION reject_employee_payroll_delete();
ALTER TABLE employees DROP COLUMN working_business_unit_id, DROP COLUMN termination_date, DROP COLUMN dopay_employee_number,
  DROP COLUMN attendance_type_id, DROP COLUMN shift_plan_id;
ALTER TABLE holidays DROP COLUMN religion;
ALTER TABLE attendance_types DROP COLUMN early_exit_allowance_minutes, DROP COLUMN weekend_days;
DROP INDEX idx_payroll_runs_period_currency;
DROP INDEX idx_payroll_runs_month_year_country;
ALTER TABLE payroll_runs DROP COLUMN sar_currency_rate, DROP COLUMN currency, DROP COLUMN total_gross, DROP COLUMN total_deductions,
  DROP COLUMN total_net, DROP COLUMN employee_count, DROP COLUMN input_fingerprint, DROP COLUMN confirmed_by, DROP COLUMN confirmed_at,
  DROP COLUMN sent_to_accounting_by, DROP COLUMN sent_to_accounting_at, DROP COLUMN erp_post_started_at, DROP COLUMN erp_post_failed_at,
  DROP COLUMN erp_batch_number;
SELECT (:'orig_runs_idx' <> '') AS hr_has_idx \gset
\if :hr_has_idx
  :orig_runs_idx;
\endif
DROP INDEX idx_employees_work_email;
:orig_email_idx;
-- No CASCADE: the only outside reference (employees.working_business_unit_id) was dropped above, so anything
-- unexpected depending on these tables makes the rollback fail instead of silently dropping it.
DROP TABLE timesheets, timesheet_edit_permissions, timesheet_month_locks, payroll_variable_entries, payroll_month_locks,
  shift_plan_details, shift_plans, shift_assignments, company_wfh_days, business_unit_cost_center_mapping, hr_manager_business_units,
  hr_managers, payroll_element_eligibility, payroll_employee_elements, request_escalations, payroll_run_lines, payroll_erp_settings,
  payroll_erp_invoice_attempts, payroll_erp_reconciliations, payroll_elements, business_units, payroll_currencies, employee_wfh_days,
  wfh_sessions, saved_attendance, user_permissions, portal_session_activity;
\if :wf_was_not_null
  ALTER TABLE approval_workflow_runs ALTER COLUMN workflow_id SET NOT NULL;
\endif
DELETE FROM permissions WHERE id > :perm_max_id;
DELETE FROM employee_job_history WHERE id > :hist_max_id;
DELETE FROM deduction_rules WHERE id > :dr_max_id AND rule_type = 'absence' AND name_en IN ('Absence with notice','Absence without notice');
-- Only the three rows this package recorded (id above the pre-apply maximum AND exactly a 0052-0054 hash/timestamp).
WITH e(idx,tag,hash,created_at) AS :expected_ledger
DELETE FROM drizzle.__drizzle_migrations m USING e
WHERE m.id > :ledger_pre_max_id AND e.idx IN (52, 53, 54) AND m.hash = e.hash AND m.created_at = e.created_at;
INSERT INTO hr_ops.migration_audit (run_id, event, classification, detail)
VALUES (:'rollback_run_id', 'rollback', 'logical_rollback', jsonb_build_object('ledger_pre_max_id', :ledger_pre_max_id));

SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE id > :ledger_pre_max_id) AS hr_rb_ledger_left,
       (SELECT md5(coalesce(string_agg(id || ':' || hash || ':' || created_at, ',' ORDER BY id), '')) FROM drizzle.__drizzle_migrations) AS hr_rb_ledger_fp,
       (SELECT count(*) FROM unnest(ARRAY['timesheets','hr_managers','portal_session_activity','payroll_run_lines']) t WHERE to_regclass('public.'||t) IS NOT NULL) AS hr_rb_left \gset
\echo HR_ROLLBACK package_ledger_rows_left=:hr_rb_ledger_left ledger_fp=:hr_rb_ledger_fp (attested :attested_ledger_fp) new_tables_left=:hr_rb_left
SELECT (:hr_rb_ledger_left <> 0 OR :'hr_rb_ledger_fp' <> :'attested_ledger_fp' OR :hr_rb_left <> 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'ROLLBACK VERIFICATION FAILED'; END $$;
\endif
\echo HR_ROLLBACK=PASS
