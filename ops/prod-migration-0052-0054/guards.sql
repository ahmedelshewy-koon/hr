-- Blocking checks for applying 0052-0054. Read-only: runs in preflight (READ ONLY transaction) and again at the
-- start of the migration transaction. Requires expected-ledger.sql to be loaded first. Any failure raises.

-- 1. Schema state must be exactly "before 0052": none of the 27 tables and none of the 22 columns exist.
SELECT count(*) FILTER (WHERE to_regclass('public.'||t) IS NOT NULL) AS hr_tables_present
FROM unnest(ARRAY['timesheets','timesheet_edit_permissions','timesheet_month_locks','payroll_variable_entries',
 'payroll_month_locks','shift_plans','shift_plan_details','shift_assignments','company_wfh_days','business_units',
 'business_unit_cost_center_mapping','payroll_currencies','hr_managers','hr_manager_business_units','payroll_elements',
 'payroll_element_eligibility','payroll_employee_elements','request_escalations','payroll_run_lines','payroll_erp_settings',
 'payroll_erp_invoice_attempts','payroll_erp_reconciliations','employee_wfh_days','wfh_sessions','saved_attendance',
 'user_permissions','portal_session_activity']) t \gset
SELECT count(*) AS hr_columns_present FROM information_schema.columns c
JOIN unnest(ARRAY['employees.attendance_type_id','employees.shift_plan_id','holidays.religion',
 'attendance_types.early_exit_allowance_minutes','attendance_types.weekend_days','employees.working_business_unit_id',
 'employees.termination_date','employees.dopay_employee_number','payroll_runs.sar_currency_rate','payroll_runs.currency',
 'payroll_runs.total_gross','payroll_runs.total_deductions','payroll_runs.total_net','payroll_runs.employee_count',
 'payroll_runs.input_fingerprint','payroll_runs.confirmed_by','payroll_runs.confirmed_at','payroll_runs.sent_to_accounting_by',
 'payroll_runs.sent_to_accounting_at','payroll_runs.erp_post_started_at','payroll_runs.erp_post_failed_at',
 'payroll_runs.erp_batch_number']) x(q) ON c.table_schema='public' AND c.table_name||'.'||c.column_name = x.q \gset
\echo HR_STATE_TABLES_PRESENT=:hr_tables_present/27 HR_STATE_COLUMNS_PRESENT=:hr_columns_present/22
SELECT (:hr_tables_present = 27 AND :hr_columns_present = 22) AS hr_already_applied,
       (:hr_tables_present + :hr_columns_present > 0) AS hr_not_pending \gset
\if :hr_already_applied
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: 0052-0054 objects already exist (state=APPLIED); nothing to do'; END $$;
\elif :hr_not_pending
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: partial 0052-0054 state found; stop and investigate (no changes made)'; END $$;
\endif

-- 2. Objects the migrations depend on.
SELECT coalesce(string_agg(t, ', '), '') AS hr_missing_prereq FROM unnest(ARRAY['employees','users','roles','permissions','deduction_rules',
 'cost_centers','requests','approval_workflow_runs','payroll_runs','payroll_items','attendance_types','holidays']) t
WHERE to_regclass('public.'||t) IS NULL \gset
SELECT (:'hr_missing_prereq' <> '') AS hr_bad \gset
\if :hr_bad
  \echo GUARD FAILED: missing prerequisite tables: :hr_missing_prereq
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: prerequisite tables missing'; END $$;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_work_email') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: index idx_employees_work_email is missing; 0054 drops it without IF EXISTS'; END $$;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='idx_permissions_role_module_action' AND i.indisunique) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: unique index on permissions(role_id,module,action) missing; ON CONFLICT seeds would fail'; END $$;
\endif
SELECT count(*) <> 8 AS hr_bad FROM information_schema.columns WHERE table_schema='public' AND table_name='deduction_rules'
 AND column_name IN ('name_en','name_ar','rule_type','min_minutes','deduction_type','value','absence_notice','status') \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: deduction_rules lacks columns used by the 0053 seed'; END $$;
\endif
SELECT coalesce(string_agg(c.relname || ' (owner ' || pg_get_userbyid(c.relowner) || ')', ', '), '') AS hr_not_owned
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND c.relname IN ('employees','holidays','attendance_types','payroll_runs','approval_workflow_runs')
  AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) \gset
SELECT (:'hr_not_owned' <> '') AS hr_bad \gset
\if :hr_bad
  \echo GUARD FAILED: tables altered by 0052-0054 are not owned by the migrating user: :hr_not_owned
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: migrating user does not own the tables 0052-0054 alter'; END $$;
\endif
SELECT NOT has_table_privilege('drizzle.__drizzle_migrations', 'INSERT,DELETE') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: migrating user cannot write drizzle.__drizzle_migrations'; END $$;
\endif
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = current_user AND current_user <> 'public') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: a schema named after the DB user exists; unqualified DDL could land outside public'; END $$;
\endif

-- 3. Data that would break the new unique indexes.
SELECT count(*) AS hr_dupes FROM (SELECT 1 FROM payroll_runs GROUP BY month, year, country HAVING count(*) > 1) d \gset
SELECT :hr_dupes > 0 AS hr_bad \gset
\if :hr_bad
  \echo GUARD FAILED: :hr_dupes duplicate payroll_runs (month,year,country) groups
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: duplicate payroll_runs periods block idx_payroll_runs_month_year_country (0053)'; END $$;
\endif
SELECT count(*) AS hr_dupes FROM (SELECT 1 FROM employees WHERE employment_status <> 'deleted' AND work_email IS NOT NULL
 GROUP BY work_email HAVING count(*) > 1) d \gset
SELECT :hr_dupes > 0 AS hr_bad \gset
\if :hr_bad
  \echo GUARD FAILED: :hr_dupes duplicate non-deleted employee work_email values
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: duplicate work_email blocks idx_employees_work_email (0054)'; END $$;
\endif

-- 4. Migration history must be exactly the ledger that was reviewed and attested (ledger-attestations.json), row
--    for row (id, hash, created_at). Requires :attested_ledger_fp (lineage.mjs psql-vars) and expected-ledger.sql.
--    Production's lineage diverges from this repository, so nothing weaker than the exact reviewed state is accepted.
--    Preflight sets hr_check_ledger=false (lineage.mjs classifies and reports instead); the transaction sets true.
\if :hr_check_ledger
WITH e(idx,tag,hash,created_at) AS :expected_ledger
SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS hr_ledger_rows,
       (SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations) AS hr_ledger_head,
       (SELECT coalesce(max(id), 0) FROM drizzle.__drizzle_migrations) AS hr_ledger_max_id,
       (SELECT md5(coalesce(string_agg(id || ':' || hash || ':' || created_at, ',' ORDER BY id), '')) FROM drizzle.__drizzle_migrations) AS hr_ledger_fp,
       (SELECT count(*) FROM drizzle.__drizzle_migrations m JOIN e ON e.idx >= 52 AND (m.created_at = e.created_at OR m.hash = e.hash)) AS hr_ledger_package_rows \gset
\echo HR_LEDGER_ROWS=:hr_ledger_rows HEAD=:hr_ledger_head FINGERPRINT=:hr_ledger_fp ATTESTED=:attested_ledger_fp
SELECT (:'hr_ledger_fp' <> :'attested_ledger_fp') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: drizzle.__drizzle_migrations differs from the attested ledger (or none is attested); run preflight and see ADMIN_ACTION_REPORT.md'; END $$;
\endif
SELECT (:hr_ledger_package_rows > 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: a ledger row for 0052-0054 already exists (drizzle-kit migrate may have run); stop and investigate'; END $$;
\endif
SELECT (:hr_ledger_head >= :head_when) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: ledger head is not older than 0054; recording 0052-0054 would not make it the head'; END $$;
\endif
\endif
SELECT NOT has_database_privilege(current_database(), 'CREATE') AND to_regnamespace('hr_ops') IS NULL AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'GUARD: the migrating user cannot create the hr_ops audit schema'; END $$;
\endif
\echo HR_GUARDS=PASS
