-- Tab-separated detail of the reconciliation proposal (run after recon-proposal.sql with -At -F tab, in a transaction
-- that is rolled back). Rendered by `lineage.mjs recon-render` into RECONCILIATION_PROPOSAL.md and CSV files.
SELECT 'JH', employee_id, coalesce(employee_code, ''), employment_status, status, coalesce(company_id::text, ''), coalesce(branch_id::text, ''),
       coalesce(department_id::text, ''), coalesce(section_id::text, ''), coalesce(job_title_id::text, ''), coalesce(position_id::text, ''),
       coalesce(start_date, ''), coalesce(date_source, '')
FROM hr_recon_jh ORDER BY employee_id;
SELECT 'RBAC', coalesce(role_id::text, ''), role_name, module, action, seed_allowed, status, coalesce(existing_allowed::text, ''), source
FROM hr_recon_rbac ORDER BY module, role_name, action;
SELECT 'COUNT', 'employees_non_deleted', count(*) FROM employees WHERE employment_status <> 'deleted'
UNION ALL SELECT 'COUNT', 'employees_without_job_history', count(*) FROM employees e WHERE e.employment_status <> 'deleted' AND NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id = e.id)
UNION ALL SELECT 'COUNT', 'employee_job_history_rows', count(*) FROM employee_job_history
UNION ALL SELECT 'COUNT', 'employee_job_history_current_assignment', count(*) FROM employee_job_history WHERE change_reason = 'current_assignment'
UNION ALL SELECT 'COUNT', 'permissions:administrative_decisions', count(*) FROM permissions WHERE module = 'administrative_decisions'
UNION ALL SELECT 'COUNT', 'permissions:staffing_blueprint', count(*) FROM permissions WHERE module = 'staffing_blueprint';
SELECT 'SUMMARY', :recon_jh_proposed, :recon_jh_missing_source, :'recon_jh_fp', :recon_rbac_insert, :recon_rbac_grants, :recon_rbac_preserved, :recon_rbac_role_missing, :'recon_rbac_fp';
