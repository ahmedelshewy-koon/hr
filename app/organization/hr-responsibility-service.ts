import type { PostgresDatabase, TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { organizationReady, readOrganizationCatalog } from './assignment-service.ts';
import { resolveEmployeeHrResponsibility, type HrResolution } from './hr-responsibility.ts';
import { readHrRoster } from './hr-roster.ts';

type Db = PostgresDatabase | TransactionDatabase;

export { HR_ELIGIBLE_SQL, HR_ROSTER_SQL, readHrRoster, readUnlinkedHrAccounts } from './hr-roster.ts';

/** Every non-deleted employee's resolver inputs. Current-status filtering is left to the callers. */
export async function readHrEmployees(db: Db): Promise<Row[]> {
  return (await db.prepare("SELECT id,employee_code,name_en,name_ar,work_email,employment_status,company_id,branch_id,hr_user_id FROM employees WHERE employment_status<>'deleted' ORDER BY name_en,id").all()).results as Row[];
}

/** One employee's resolution with the shared resolver. Null before the organizational migration. */
export async function resolveEmployeeHrFromDb(db: Db, employeeId: number): Promise<HrResolution | null> {
  if (!await organizationReady(db as TransactionDatabase)) return null;
  const employee = await db.prepare('SELECT id,company_id,branch_id,hr_user_id FROM employees WHERE id=?').bind(employeeId).first<Row>();
  if (!employee) return null;
  const [catalog, roster] = await Promise.all([readOrganizationCatalog(db as TransactionDatabase), readHrRoster(db)]);
  return resolveEmployeeHrResponsibility({ employee, catalog, roster });
}
