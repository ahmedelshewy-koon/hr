/**
 * Department hierarchy scoping shared by every access-control path.
 *
 * A Department Manager may act on their own department *and* everything nested
 * beneath it, so the scope has to be resolved recursively. The same CTE was
 * previously copy-pasted into eight modules; any divergence between those copies
 * would silently widen or narrow an authorization boundary, so it lives here once.
 *
 * Usage: prefix a query with the CTE and bind the manager's employee id as the
 * first parameter, then reference `managed` as a normal table:
 *
 *   db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT id FROM employees WHERE department_id IN (SELECT id FROM managed)`)
 *     .bind(managerEmployeeId)
 */
export const MANAGED_DEPARTMENTS_CTE =
  "WITH RECURSIVE managed AS (SELECT id FROM departments WHERE manager_employee_id=? AND status!='deleted' UNION ALL SELECT d.id FROM departments d JOIN managed m ON d.parent_id=m.id WHERE d.status!='deleted')";

/** Roles that always see the whole company, bypassing department scoping. */
export const COMPANY_WIDE_ROLES = ["Super Admin", "HR Manager"] as const;

/** True when the role is allowed to read every employee regardless of department. */
export function isCompanyWideRole(roleName: string) {
  return (COMPANY_WIDE_ROLES as readonly string[]).includes(roleName);
}
