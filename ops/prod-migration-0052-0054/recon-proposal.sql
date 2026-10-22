-- Historical data reconciliation PROPOSAL for the data steps of 0041/0042 that never ran on production (the VPS
-- applied a generated schema-only migration instead). Writes only session-local temp tables; preflight runs it in a
-- transaction that is always rolled back, apply runs it inside the migration transaction right before
-- recon-apply.sql. Sets psql variables recon_* (counts and md5 fingerprints of exactly what would be inserted).
--
-- Job history (0041): one 'current_assignment' entry for each non-deleted employee with NO history at all, using only
-- values stored on the employee record. The start date must be a stored YYYY-MM-DD assignment_effective_date or,
-- failing that, start_date. 0041 fell back to CURRENT_DATE; that would invent a date, so such employees are
-- MISSING_SOURCE and are never inserted.
-- RBAC (0041/0042): exactly the (role, module, action, allowed) rows those migrations seed. A row that already exists
-- is never touched, whatever its value: custom grants and explicit denials are preserved and reported.
CREATE TEMP TABLE hr_recon_jh ON COMMIT DROP AS
SELECT e.id AS employee_id, e.employee_code, e.employment_status,
       e.company_id, e.branch_id, e.department_id, e.section_id, e.job_title_id, e.position_id,
       CASE WHEN btrim(coalesce(e.assignment_effective_date, '')) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(e.assignment_effective_date)
            WHEN btrim(coalesce(e.start_date, '')) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(e.start_date) END AS start_date,
       CASE WHEN btrim(coalesce(e.assignment_effective_date, '')) ~ '^\d{4}-\d{2}-\d{2}$' THEN 'assignment_effective_date'
            WHEN btrim(coalesce(e.start_date, '')) ~ '^\d{4}-\d{2}-\d{2}$' THEN 'start_date' END AS date_source
FROM employees e
WHERE e.employment_status <> 'deleted'
  AND NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id = e.id);
ALTER TABLE hr_recon_jh ADD COLUMN status text;
UPDATE hr_recon_jh SET status = CASE WHEN start_date IS NULL THEN 'MISSING_SOURCE' ELSE 'PROPOSED' END;

CREATE TEMP TABLE hr_recon_rbac ON COMMIT DROP AS
WITH seeds (role_name, module, action, allowed, source) AS (
  -- 0041: administrative_decisions view/create = 1 for HR Manager and Department Manager
  SELECT r.name, 'administrative_decisions', a.action, 1, '0041_employee_profile_and_decisions'
  FROM unnest(ARRAY['HR Manager','Department Manager']) AS r(name) CROSS JOIN unnest(ARRAY['view','create']) AS a(action)
  UNION ALL
  -- 0042: staffing_blueprint for HR Manager, Department Manager and Employee; 1 only for HR Manager view..delete
  SELECT r.name, 'staffing_blueprint', a.action,
         CASE WHEN r.name = 'HR Manager' AND a.action IN ('view','create','edit','approve','delete') THEN 1 ELSE 0 END, '0042_staffing_blueprint'
  FROM unnest(ARRAY['HR Manager','Department Manager','Employee']) AS r(name)
  CROSS JOIN unnest(ARRAY['view','create','edit','approve','delete','manage_settings']) AS a(action))
SELECT s.role_name, s.module, s.action, s.allowed AS seed_allowed, s.source, ro.id AS role_id,
       p.id AS existing_id, p.allowed AS existing_allowed,
       CASE WHEN ro.id IS NULL THEN 'ROLE_MISSING'
            WHEN p.id IS NULL THEN 'PROPOSED_INSERT'
            WHEN p.allowed = s.allowed THEN 'PRESENT_MATCHES'
            ELSE 'PRESERVED_CUSTOM' END AS status
FROM seeds s
LEFT JOIN roles ro ON ro.name = s.role_name
LEFT JOIN permissions p ON p.role_id = ro.id AND p.module = s.module AND p.action = s.action;

SELECT count(*) FILTER (WHERE status = 'PROPOSED') AS recon_jh_proposed,
       count(*) FILTER (WHERE status = 'MISSING_SOURCE') AS recon_jh_missing_source,
       md5(coalesce(string_agg(concat_ws('|', employee_id, coalesce(company_id::text, ''), coalesce(branch_id::text, ''),
             coalesce(department_id::text, ''), coalesce(section_id::text, ''), coalesce(job_title_id::text, ''),
             coalesce(position_id::text, ''), start_date, date_source), E'\n' ORDER BY employee_id) FILTER (WHERE status = 'PROPOSED'), '')) AS recon_jh_fp
FROM hr_recon_jh \gset
SELECT count(*) FILTER (WHERE status = 'PROPOSED_INSERT') AS recon_rbac_insert,
       count(*) FILTER (WHERE status = 'PROPOSED_INSERT' AND seed_allowed = 1) AS recon_rbac_grants,
       count(*) FILTER (WHERE status = 'PRESERVED_CUSTOM') AS recon_rbac_preserved,
       count(*) FILTER (WHERE status = 'ROLE_MISSING') AS recon_rbac_role_missing,
       md5(coalesce(string_agg(concat_ws('|', role_id, module, action, seed_allowed), E'\n' ORDER BY role_id, module, action)
             FILTER (WHERE status = 'PROPOSED_INSERT'), '')) AS recon_rbac_fp
FROM hr_recon_rbac \gset
\echo HR_RECON_PROPOSAL job_history_proposed=:recon_jh_proposed missing_source=:recon_jh_missing_source fp=:recon_jh_fp rbac_insert=:recon_rbac_insert grants=:recon_rbac_grants preserved_custom=:recon_rbac_preserved role_missing=:recon_rbac_role_missing fp=:recon_rbac_fp
