-- Logical rollback of 0052-0054, run as ONE transaction by `hr-migrate-0052-0054.sh rollback`.
-- Needs the rollback-vars.sql captured at apply time (pre-migration max ids and original index definitions).
-- Only for use while the 0052-0054 objects hold no real data (e.g. the new release could not be deployed).
-- Once timesheets/payroll data exist, restore the verified backup instead (RUNBOOK "Full restore").
-- Variables: perm_max_id, dr_max_id, orig_runs_idx, orig_email_idx, wf_was_not_null, base_when.

-- Guard: refuse if the new tables or new columns already hold data that the rollback would destroy.
SELECT (SELECT count(*) FROM timesheets) + (SELECT count(*) FROM timesheet_edit_permissions) + (SELECT count(*) FROM timesheet_month_locks)
     + (SELECT count(*) FROM payroll_variable_entries) + (SELECT count(*) FROM payroll_month_locks) + (SELECT count(*) FROM shift_plans)
     + (SELECT count(*) FROM shift_plan_details) + (SELECT count(*) FROM shift_assignments) + (SELECT count(*) FROM company_wfh_days)
     + (SELECT count(*) FROM business_units) + (SELECT count(*) FROM business_unit_cost_center_mapping) + (SELECT count(*) FROM hr_manager_business_units)
     + (SELECT count(*) FROM payroll_elements) + (SELECT count(*) FROM payroll_element_eligibility) + (SELECT count(*) FROM payroll_employee_elements)
     + (SELECT count(*) FROM request_escalations) + (SELECT count(*) FROM payroll_run_lines) + (SELECT count(*) FROM payroll_erp_settings)
     + (SELECT count(*) FROM payroll_erp_invoice_attempts) + (SELECT count(*) FROM payroll_erp_reconciliations) + (SELECT count(*) FROM employee_wfh_days)
     + (SELECT count(*) FROM wfh_sessions) + (SELECT count(*) FROM saved_attendance) + (SELECT count(*) FROM user_permissions)
     + (SELECT count(*) FROM payroll_currencies WHERE code <> 'SAR') AS hr_rb_new_rows,
       (SELECT count(*) FROM employees WHERE working_business_unit_id IS NOT NULL OR termination_date IS NOT NULL OR dopay_employee_number IS NOT NULL
                                          OR attendance_type_id IS NOT NULL OR shift_plan_id IS NOT NULL)
     + (SELECT count(*) FROM holidays WHERE religion IS NOT NULL)
     + (SELECT count(*) FROM attendance_types WHERE early_exit_allowance_minutes <> 0 OR weekend_days <> '')
     + (SELECT count(*) FROM payroll_runs WHERE currency IS NOT NULL OR sar_currency_rate IS NOT NULL OR total_gross <> 0 OR total_deductions <> 0
                                           OR total_net <> 0 OR employee_count <> 0 OR input_fingerprint IS NOT NULL OR confirmed_by IS NOT NULL
                                           OR sent_to_accounting_at IS NOT NULL OR erp_batch_number IS NOT NULL OR erp_post_started_at IS NOT NULL)
     + (SELECT count(*) FROM approval_workflow_runs WHERE workflow_id IS NULL) AS hr_rb_new_values \gset
\echo HR_ROLLBACK rows_in_new_tables=:hr_rb_new_rows rows_using_new_columns=:hr_rb_new_values
SELECT (:hr_rb_new_rows + :hr_rb_new_values > 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'ROLLBACK REFUSED: 0052-0054 objects already hold data. Use the full backup restore procedure.'; END $$;
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
DELETE FROM permissions WHERE id > :perm_max_id AND role_id IN (SELECT id FROM roles WHERE name IN ('Super Admin','HR Manager'))
  AND module IN ('timesheetManagement','payrollElementSetup','payrollEligibility','payrollEmployeeElements','payrollMatrixEntry',
  'payrollVariableEntry','payrollMonthPreview','payrollRun','deductionRulesSetup','savedAttendance','attendanceTypeSetup',
  'shiftPlansSetup','vacationSetup','hrManagerSetup','businessUnitSetup','costCenterSetup','buCostCenterMapping','wfhCheckin',
  'zkAttendanceLogs','sajelErpSetup');
DELETE FROM deduction_rules WHERE id > :dr_max_id AND rule_type = 'absence'
  AND name_en IN ('Absence with notice','Absence without notice');
DELETE FROM drizzle.__drizzle_migrations WHERE created_at > :base_when;

SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS hr_rb_ledger,
       (SELECT count(*) FROM unnest(ARRAY['timesheets','hr_managers','portal_session_activity','payroll_run_lines']) t WHERE to_regclass('public.'||t) IS NOT NULL) AS hr_rb_left \gset
\echo HR_ROLLBACK ledger_rows=:hr_rb_ledger new_tables_left=:hr_rb_left
SELECT (:hr_rb_ledger <> 33 OR :hr_rb_left <> 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'ROLLBACK VERIFICATION FAILED'; END $$;
\endif
\echo HR_ROLLBACK=PASS
