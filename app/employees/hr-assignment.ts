import { organizationReady } from '../organization/assignment-service.ts';
import { HR_ELIGIBLE_SQL } from '../organization/hr-roster.ts';
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;

// Same direct-manager fallback as the employee profile, excluding self references.
// The employee table must be aliased as e in callers.
export const EMPLOYEE_MANAGER_SQL = `COALESCE(NULLIF(e.manager_id,e.id),
  (SELECT COALESCE(NULLIF(d.manager_employee_id,e.id),NULLIF(pd.manager_employee_id,e.id))
   FROM departments d LEFT JOIN departments pd ON pd.id=d.parent_id WHERE d.id=e.department_id))`;

export async function assertEmployeeManager(db: Db, employeeId: number, actorEmployeeId: number | null): Promise<void> {
  const row = await db.prepare(`SELECT ${EMPLOYEE_MANAGER_SQL} AS manager_id FROM employees e WHERE e.id=? FOR SHARE OF e`).bind(employeeId).first<{manager_id:number|null}>();
  if (!actorEmployeeId || !row?.manager_id || Number(row.manager_id)!==actorEmployeeId || employeeId===actorEmployeeId) {
    throw new Response("هذا الطلب متاح فقط للمدير المباشر للموظف.", {status:403});
  }
}

/**
 * The HR resolver's precedence as SQL, for request routing, approval queues, notifications and reports that must
 * filter by it: employee override, then the active Company + Branch rule, then the active Branch Fallback.
 * Must stay equivalent to resolveEmployeeHrResponsibility (app/organization/hr-responsibility.ts); a rule whose
 * HR person is unavailable still wins, and requireEmployeeHr then refuses instead of falling through.
 */
export async function effectiveHrSql(db:Db):Promise<string>{
  if(!await organizationReady(db))return 'e.hr_user_id';
  return "COALESCE(e.hr_user_id,(SELECT rule.hr_user_id FROM hr_responsibility_rules rule WHERE rule.status='active' AND rule.branch_id=e.branch_id AND (rule.company_id=e.company_id OR rule.company_id IS NULL) ORDER BY (rule.company_id IS NOT NULL) DESC,rule.id LIMIT 1))";
}

// Resolve the current assignment on every operation, including existing requests.
export async function requireEmployeeHr(db: Db, employeeId: number): Promise<number> {
  const hrSql=await effectiveHrSql(db);
  const row = await db.prepare(`SELECT u.id FROM employees e
    JOIN users u ON u.id=${hrSql} AND u.status='active'
    JOIN roles r ON r.id=u.role_id AND r.name IN ('HR Manager','Super Admin')
    JOIN hr_responsibles h ON h.user_id=u.id AND h.status='active'
    LEFT JOIN employees he ON he.id=u.employee_id
    WHERE e.id=? AND ${HR_ELIGIBLE_SQL} AND u.employee_id<>e.id FOR SHARE OF e,u,h`).bind(employeeId).first<{id:number}>();
  if (!row) throw new Response("لا يمكن إرسال الطلب: لم يتم تعيين مسؤول موارد بشرية نشط لهذا الموظف. يرجى التواصل مع الإدارة لتحديث بيانات الموظف.", {status:409});
  return Number(row.id);
}

export async function assertEmployeeHr(db: Db, employeeId: number, actorUserId: number): Promise<void> {
  const hrUserId = await requireEmployeeHr(db, employeeId);
  if (hrUserId !== actorUserId) throw new Response("هذا الطلب متاح فقط لمسؤول الموارد البشرية المعيّن للموظف.", {status:403});
}
