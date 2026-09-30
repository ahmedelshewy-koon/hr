import { EMPLOYEE_MANAGER_SQL } from "../employees/hr-assignment.ts";
import { HR_ELIGIBLE_SQL } from "../organization/hr-roster.ts";

/**
 * Who a request is waiting on right now: the employee's direct manager (department manager fallback) and the
 * HR responsible that requireEmployeeHr would accept. The employee table must be aliased as e in callers.
 */
export function pendingApproverColumns(hrSql: string): string {
  const manager = `FROM employees me WHERE me.id=(${EMPLOYEE_MANAGER_SQL})`;
  const hr = `FROM users u JOIN roles r ON r.id=u.role_id JOIN hr_responsibles h ON h.user_id=u.id AND h.status='active' LEFT JOIN employees he ON he.id=u.employee_id WHERE u.id=${hrSql} AND ${HR_ELIGIBLE_SQL} AND u.employee_id<>e.id`;
  return `(SELECT me.name_en ${manager}) AS pending_manager_name,(SELECT COALESCE(me.name_ar,me.name_en) ${manager}) AS pending_manager_name_ar,(SELECT COALESCE(he.name_en,u.email) ${hr}) AS pending_hr_name,(SELECT COALESCE(he.name_ar,he.name_en,u.email) ${hr}) AS pending_hr_name_ar`;
}
