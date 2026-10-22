-- Read-only checks for the data and non-schema operations of migrations 0031-0051 (see DATA_CHECKS in lineage.mjs).
-- Production's ledger does not record most of these migrations, so their hand-written data steps (seeds, backfills,
-- drops) may never have run there. Output: one line per check, "id<TAB>PASS|FAIL<TAB>evidence" (run with -At -F tab).
-- Nothing here changes data: a FAIL means a reviewer must decide (attest, or fix through a separately approved change).
WITH roles_needed AS (SELECT id, name FROM roles WHERE name IN ('HR Manager','Department Manager')),
-- 0042 seeds staffing_blueprint for three roles (HR Manager, Department Manager, Employee), 6 actions each.
staffing_roles AS (SELECT id, name FROM roles WHERE name IN ('HR Manager','Department Manager','Employee')),
admin_decisions AS (
  SELECT count(*) AS present FROM permissions p JOIN roles_needed r ON r.id = p.role_id
  WHERE p.module = 'administrative_decisions' AND p.action IN ('view','create')),
staffing AS (
  SELECT count(*) AS present FROM permissions p JOIN staffing_roles r ON r.id = p.role_id
  WHERE p.module = 'staffing_blueprint' AND p.action IN ('view','create','edit','approve','delete','manage_settings')),
history AS (
  SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id = e.id)) AS missing,
         count(*) AS employees,
         (SELECT count(*) FROM employee_job_history WHERE change_reason = 'current_assignment') AS backfilled
  FROM employees e WHERE e.employment_status <> 'deleted')
SELECT id, status, evidence FROM (
  SELECT 1 AS n, '0032_ip_port_index_dropped' AS id,
         CASE WHEN to_regclass('public.idx_attendance_devices_ip_port') IS NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'idx_attendance_devices_ip_port ' || CASE WHEN to_regclass('public.idx_attendance_devices_ip_port') IS NULL THEN 'absent' ELSE 'still present' END AS evidence
  UNION ALL
  SELECT 2, '0037_min_minutes_nullable',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='deduction_rules' AND column_name='min_minutes') = 'YES' THEN 'PASS' ELSE 'FAIL' END,
         'deduction_rules.min_minutes nullable=' || coalesce((SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='deduction_rules' AND column_name='min_minutes'), 'column missing')
  UNION ALL
  SELECT 3, '0038_company_request_type_key_dropped',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_workflows_company_id_request_type_key') THEN 'PASS' ELSE 'FAIL' END,
         'approval_workflows_company_id_request_type_key ' || CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_workflows_company_id_request_type_key') THEN 'still present' ELSE 'absent' END
  UNION ALL
  SELECT 4, '0039_0042_workforce_tables_absent',
         CASE WHEN to_regclass('public.workforce_plans') IS NULL AND to_regclass('public.workforce_plan_lines') IS NULL AND to_regclass('public.workforce_plan_events') IS NULL THEN 'PASS' ELSE 'FAIL' END,
         'present: ' || coalesce(nullif(concat_ws(',', CASE WHEN to_regclass('public.workforce_plans') IS NOT NULL THEN 'workforce_plans' END,
                                                        CASE WHEN to_regclass('public.workforce_plan_lines') IS NOT NULL THEN 'workforce_plan_lines' END,
                                                        CASE WHEN to_regclass('public.workforce_plan_events') IS NOT NULL THEN 'workforce_plan_events' END), ''), 'none')
  UNION ALL
  SELECT 5, '0039_0042_workforce_permissions_removed',
         CASE WHEN NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'workforce_planning') THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM permissions WHERE module = 'workforce_planning') || ' workforce_planning permission rows'
  UNION ALL
  SELECT 6, '0041_job_history_backfill',
         CASE WHEN (SELECT missing FROM history) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT missing FROM history) || ' of ' || (SELECT employees FROM history) || ' non-deleted employees have no job history; '
           || (SELECT backfilled FROM history) || ' current_assignment rows'
  UNION ALL
  SELECT 7, '0041_admin_decisions_permissions',
         CASE WHEN (SELECT present FROM admin_decisions) = 2 * (SELECT count(*) FROM roles_needed) THEN 'PASS' ELSE 'FAIL' END,
         (SELECT present FROM admin_decisions) || ' of ' || 2 * (SELECT count(*) FROM roles_needed) || ' expected (role, view/create) rows'
  UNION ALL
  SELECT 8, '0042_staffing_blueprint_permissions',
         CASE WHEN (SELECT present FROM staffing) = 6 * (SELECT count(*) FROM staffing_roles) THEN 'PASS' ELSE 'FAIL' END,
         (SELECT present FROM staffing) || ' of ' || 6 * (SELECT count(*) FROM staffing_roles) || ' expected (role, action) rows'
  UNION ALL
  SELECT 9, '0046_debit_account_nullable',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='cost_centers' AND column_name='debit_account') = 'YES' THEN 'PASS' ELSE 'FAIL' END,
         'cost_centers.debit_account nullable=' || coalesce((SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='cost_centers' AND column_name='debit_account'), 'column missing')
) checks ORDER BY n;
