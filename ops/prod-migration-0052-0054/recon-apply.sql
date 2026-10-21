-- Applies the APPROVED historical data reconciliation inside the migration transaction (after recon-proposal.sql and
-- audit.sql). Variables from `lineage.mjs psql-vars`: recon_jh_enabled / recon_rbac_enabled (true only when
-- reconciliation-approval.json approves that part) and approved_jh_fp / approved_rbac_fp. If the freshly computed
-- proposal differs in any way from what was approved (an employee gained history meanwhile, a permission was edited),
-- the transaction aborts and nothing is applied. Inserts are guarded (NOT EXISTS / ON CONFLICT DO NOTHING), existing
-- rows are never updated or deleted, and every inserted row is written to hr_ops.migration_audit.
\if :recon_jh_enabled
SELECT (:'recon_jh_fp' <> :'approved_jh_fp') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'RECONCILIATION REFUSED: the job-history proposal differs from the approved one (re-run preflight and re-approve); nothing applied'; END $$;
\endif
WITH ins AS (
  INSERT INTO employee_job_history (employee_id, company_id, branch_id, department_id, section_id, job_title_id, position_id, start_date, change_reason)
  SELECT j.employee_id, j.company_id, j.branch_id, j.department_id, j.section_id, j.job_title_id, j.position_id, j.start_date, 'current_assignment'
  FROM hr_recon_jh j
  WHERE j.status = 'PROPOSED' AND NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id = j.employee_id)
  ORDER BY j.employee_id
  RETURNING id, employee_id, start_date),
aud AS (
  INSERT INTO hr_ops.migration_audit (run_id, event, tag, classification, detail)
  SELECT :'audit_run_id', 'recon_job_history', '0041_employee_profile_and_decisions', j.date_source,
         jsonb_build_object('employee_id', i.employee_id, 'employee_code', j.employee_code, 'job_history_id', i.id, 'start_date', i.start_date,
                            'date_source', j.date_source, 'company_id', j.company_id, 'branch_id', j.branch_id, 'department_id', j.department_id,
                            'section_id', j.section_id, 'job_title_id', j.job_title_id, 'position_id', j.position_id, 'approved_fp', :'approved_jh_fp')
  FROM ins i JOIN hr_recon_jh j USING (employee_id)
  RETURNING 1)
SELECT (SELECT count(*) FROM ins) AS hr_jh_inserted, (SELECT count(*) FROM aud) AS hr_jh_audited \gset
SELECT (:hr_jh_inserted <> :recon_jh_proposed OR :hr_jh_audited <> :hr_jh_inserted) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'RECONCILIATION FAILED: job-history rows inserted differ from the approved proposal'; END $$;
\endif
\else
\set hr_jh_inserted 0
\endif

\if :recon_rbac_enabled
SELECT (:'recon_rbac_fp' <> :'approved_rbac_fp') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'RECONCILIATION REFUSED: the RBAC proposal differs from the approved one (re-run preflight and re-approve); nothing applied'; END $$;
\endif
WITH ins AS (
  INSERT INTO permissions (role_id, module, action, allowed)
  SELECT r.role_id, r.module, r.action, r.seed_allowed FROM hr_recon_rbac r WHERE r.status = 'PROPOSED_INSERT'
  ORDER BY r.role_id, r.module, r.action
  ON CONFLICT (role_id, module, action) DO NOTHING
  RETURNING id, role_id, module, action, allowed),
aud AS (
  INSERT INTO hr_ops.migration_audit (run_id, event, tag, classification, detail)
  SELECT :'audit_run_id', 'recon_rbac', r.source, CASE WHEN i.allowed = 1 THEN 'grant' ELSE 'explicit_denial_parity' END,
         jsonb_build_object('permission_id', i.id, 'role_id', i.role_id, 'role_name', r.role_name, 'module', i.module, 'action', i.action,
                            'allowed', i.allowed, 'approved_fp', :'approved_rbac_fp')
  FROM ins i JOIN hr_recon_rbac r ON r.role_id = i.role_id AND r.module = i.module AND r.action = i.action
  RETURNING 1)
SELECT (SELECT count(*) FROM ins) AS hr_rbac_inserted, (SELECT count(*) FROM aud) AS hr_rbac_audited \gset
SELECT (:hr_rbac_inserted <> :recon_rbac_insert OR :hr_rbac_audited <> :hr_rbac_inserted) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'RECONCILIATION FAILED: permission rows inserted differ from the approved proposal'; END $$;
\endif
\else
\set hr_rbac_inserted 0
\endif

-- Verification: every source-backed employee now has history; every seeded (role, module, action) exists (preserved
-- custom rows count as present); preserved rows still hold exactly their previous value.
SELECT (SELECT count(*) FROM employees e WHERE e.employment_status <> 'deleted' AND NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id = e.id)) AS hr_jh_still_missing,
       (SELECT count(*) FROM hr_recon_rbac r WHERE r.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id = r.role_id AND p.module = r.module AND p.action = r.action)) AS hr_rbac_still_missing,
       (SELECT count(*) FROM hr_recon_rbac r JOIN permissions p ON p.id = r.existing_id WHERE p.allowed IS DISTINCT FROM r.existing_allowed) AS hr_rbac_changed_existing \gset
\echo HR_RECON_APPLIED job_history_inserted=:hr_jh_inserted still_without_history=:hr_jh_still_missing (missing_source=:recon_jh_missing_source) rbac_inserted=:hr_rbac_inserted rbac_still_missing=:hr_rbac_still_missing existing_rows_changed=:hr_rbac_changed_existing
SELECT (:hr_rbac_changed_existing > 0
        OR (:'recon_jh_enabled' = 'true' AND :hr_jh_still_missing <> :recon_jh_missing_source)
        OR (:'recon_rbac_enabled' = 'true' AND :hr_rbac_still_missing > 0)) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'RECONCILIATION VERIFICATION FAILED'; END $$;
\endif
\echo HR_RECON=PASS
