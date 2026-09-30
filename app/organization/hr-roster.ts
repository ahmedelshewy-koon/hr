import type { PostgresDatabase, TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';

type Db = PostgresDatabase | TransactionDatabase;

/**
 * The one eligibility rule for an HR responsible account, used by the roster, rule saves, employee overrides and
 * request routing. Aliases: u = users, r = roles, he = the employee linked to u.
 * An account must be active, hold the HR Manager or Super Admin role and be linked to a current employee.
 * Unlinked accounts are never eligible: HR responsibility belongs to a person on the employee register.
 */
export const HR_ELIGIBLE_SQL = "(u.status='active' AND r.name IN ('HR Manager','Super Admin') AND u.employee_id IS NOT NULL AND he.employment_status IN ('active','probation','notice_period'))";

/** Roster entries (hr_responsibles) with the facts the UI needs to explain eligibility. */
export const HR_ROSTER_SQL = `SELECT h.user_id,h.status,u.email,u.employee_id,u.status AS account_status,r.name AS role_name,he.employment_status AS employee_status,
  COALESCE(he.name_en,he.name_ar,u.email) AS name_en,COALESCE(he.name_ar,he.name_en,u.email) AS name_ar,he.employee_code,${HR_ELIGIBLE_SQL} AS eligible
  FROM hr_responsibles h JOIN users u ON u.id=h.user_id JOIN roles r ON r.id=u.role_id LEFT JOIN employees he ON he.id=u.employee_id ORDER BY name_en,h.user_id`;

export async function readHrRoster(db: Db): Promise<Row[]> {
  return (await db.prepare(HR_ROSTER_SQL).all()).results as Row[];
}

/** HR-role accounts that are not linked to an employee: the setup blocker administrators must resolve in Users. */
export async function readUnlinkedHrAccounts(db: Db): Promise<Row[]> {
  return (await db.prepare("SELECT u.id AS user_id,u.email,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.name IN ('HR Manager','Super Admin') AND u.employee_id IS NULL ORDER BY u.email").all()).results as Row[];
}

