UPDATE users
SET role_id=(SELECT id FROM roles WHERE name='Department Manager'),
    session_version=session_version+1,
    updated_at=CURRENT_TIMESTAMP
WHERE role_id=(SELECT id FROM roles WHERE name='Employee')
  AND employee_id IN (
    SELECT manager_employee_id
    FROM departments
    WHERE manager_employee_id IS NOT NULL AND status!='deleted'
  );
