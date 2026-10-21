-- HR Manager access report (read-only). One row per account with the HR Manager role: who they are and what
-- access they will have after 0052-0054 + the new release. Nothing is assigned here: putting an account into
-- hr_managers (Payroll > HR Manager Setup, or --hr-managers) needs written approval of the user ids and regions.
-- payroll_country mirrors app/payroll/country.ts (stored salary_country only, no fallback).
SELECT u.id AS user_id,
       u.email,
       u.status AS account_status,
       to_char(u.last_login_at, 'YYYY-MM-DD') AS last_login,
       u.hr_data_scope,
       e.employee_code,
       e.employment_status,
       CASE WHEN lower(regexp_replace(btrim(coalesce(e.salary_country,'')),'\s+',' ','g')) IN ('egypt','eg','egy','مصر','جمهورية مصر العربية') THEN 'Egypt'
            WHEN lower(regexp_replace(btrim(coalesce(e.salary_country,'')),'\s+',' ','g')) IN ('ksa','saudi arabia','saudi','sa','kingdom of saudi arabia','السعودية','المملكة العربية السعودية') THEN 'KSA'
       END AS payroll_country,
       (SELECT count(*) FROM permissions p WHERE p.role_id = u.role_id AND p.allowed = 1) AS role_grants_today,
       CASE WHEN u.status <> 'active' THEN 'none (account not active)'
            ELSE 'Timesheet, Payroll pages, Saved Attendance and Vacation Setup: blocked (403) until listed in hr_managers. Salary and payroll-setup edits: Super Admin only. All other HR pages: unchanged (role permissions).'
       END AS access_after_migration_until_assigned,
       CASE WHEN u.status <> 'active' THEN 'not eligible (account not active)'
            WHEN e.id IS NULL THEN 'can be listed for Timesheet/Payroll access, but NOT as an approver: no linked employee'
            WHEN e.employment_status NOT IN ('active','probation','notice_period') THEN 'can be listed, but NOT as an approver: employee status ' || e.employment_status
            ELSE 'eligible; proposal for approval: region ' || coalesce(CASE WHEN lower(regexp_replace(btrim(coalesce(e.salary_country,'')),'\s+',' ','g')) IN ('egypt','eg','egy','مصر','جمهورية مصر العربية') THEN 'Egypt'
                 WHEN lower(regexp_replace(btrim(coalesce(e.salary_country,'')),'\s+',' ','g')) IN ('ksa','saudi arabia','saudi','sa','kingdom of saudi arabia','السعودية','المملكة العربية السعودية') THEN 'KSA' END, 'all regions (payroll country unresolved)')
       END AS if_assigned
FROM users u
JOIN roles r ON r.id = u.role_id AND r.name = 'HR Manager'
LEFT JOIN employees e ON e.id = u.employee_id
ORDER BY u.status, u.id;
