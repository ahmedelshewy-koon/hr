import type { TransactionDatabase } from '../../db/postgres';
import { validateReportingManager } from './reporting-line.ts';

export async function checkReportingManager(db:TransactionDatabase,employeeId:number,managerId:number|null){
  const rows=(await db.prepare('SELECT id,manager_id,employment_status FROM employees').all<{id:number;manager_id:number|null;employment_status:string}>()).results;
  try{validateReportingManager(rows,employeeId,managerId);}catch(error){throw new Response((error as Error).message,{status:400});}
}

export async function refreshReportingLevels(db:TransactionDatabase,employeeId:number){
  // Levels remain relative to a department; its designated manager is level 0.
  await db.prepare(`WITH RECURSIVE affected AS (
    SELECT e.id,e.department_id,CASE WHEN d.manager_employee_id=e.id THEN 0 WHEN m.department_id=e.department_id THEN COALESCE(m.organizational_level,0)+1 ELSE 1 END AS level,ARRAY[e.id] AS path
    FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=?
    UNION ALL
    SELECT e.id,e.department_id,CASE WHEN d.manager_employee_id=e.id THEN 0 WHEN e.department_id=a.department_id THEN a.level+1 ELSE 1 END,a.path||e.id
    FROM employees e JOIN affected a ON e.manager_id=a.id LEFT JOIN departments d ON d.id=e.department_id
    WHERE e.employment_status!='deleted' AND NOT e.id=ANY(a.path)
  ) UPDATE employees e SET organizational_level=a.level FROM affected a WHERE e.id=a.id`).bind(employeeId).run();
}
