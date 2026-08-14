ALTER TABLE "employees" ADD COLUMN "organizational_level" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE departments d
SET manager_employee_id = COALESCE(
  d.manager_employee_id,
  (
    SELECT e.id
    FROM employees e
    LEFT JOIN job_titles j ON j.id = e.job_title_id
    WHERE e.department_id = d.id
      AND e.employment_status <> 'deleted'
    ORDER BY
      CASE WHEN lower(COALESCE(j.name_en, '')) ~ '(manager|director|head|chief)' OR COALESCE(j.name_ar, '') LIKE '%مدير%' THEN 0 ELSE 1 END,
      e.id
    LIMIT 1
  )
)
WHERE d.status <> 'deleted';
--> statement-breakpoint
UPDATE employees e
SET manager_id = CASE WHEN e.id = d.manager_employee_id THEN NULL ELSE d.manager_employee_id END,
    organizational_level = CASE WHEN e.id = d.manager_employee_id THEN 0 ELSE 1 END
FROM departments d
WHERE e.department_id = d.id
  AND d.manager_employee_id IS NOT NULL
  AND e.employment_status <> 'deleted';
