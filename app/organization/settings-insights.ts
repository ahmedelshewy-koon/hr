import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { readHrEmployees, readHrRoster, readUnlinkedHrAccounts } from './hr-responsibility-service.ts';

const CURRENT = "('active','probation','notice_period')";

/**
 * Read-only facts the settings screens display but must not compute on the client: who occupies each position
 * (the CEO is derived from these), the HR resolver inputs (roster, employees, unlinked HR accounts), how many current employees each company/branch scope routes to HR, and the
 * legacy free-text work locations that were deliberately never mapped. Runs inside the same snapshot as the
 * catalog and usage counts.
 */
export async function readOrganizationInsights(db: TransactionDatabase) {
  const occupantRows = (await db.prepare(`SELECT position_id,id,employee_code,name_ar,name_en,employment_status FROM employees WHERE position_id IS NOT NULL AND employment_status IN ${CURRENT} ORDER BY position_id,name_en,id`).all()).results as Row[];
  const occupants: Record<string, Row[]> = {};
  for (const row of occupantRows) (occupants[String(row.position_id)] ??= []).push({ id: Number(row.id), employee_code: row.employee_code, name_ar: row.name_ar, name_en: row.name_en, employment_status: row.employment_status });

  const scopeRows = (await db.prepare(`SELECT company_id,branch_id,count(*)::int AS employees,count(hr_user_id)::int AS overrides FROM employees WHERE branch_id IS NOT NULL AND employment_status IN ${CURRENT} GROUP BY company_id,branch_id`).all()).results as Row[];
  const hrScopes = scopeRows.map(row => ({ company_id: row.company_id == null ? null : Number(row.company_id), branch_id: Number(row.branch_id), employees: Number(row.employees), overrides: Number(row.overrides) }));

  const legacyRows = (await db.prepare(`SELECT btrim(work_location) AS text,count(*)::int AS employees FROM employees WHERE work_location_id IS NULL AND btrim(COALESCE(work_location,''))<>'' AND employment_status IN ${CURRENT} GROUP BY btrim(work_location) ORDER BY count(*) DESC,btrim(work_location)`).all()).results as Row[];
  const legacyWorkLocations = legacyRows.map(row => ({ text: String(row.text), employees: Number(row.employees) }));

  // HR responsibility inputs: the Settings page resolves with the shared resolver, so counts match routing.
  const hrRoster = await readHrRoster(db);
  const hrEmployees = (await readHrEmployees(db)).map(row => ({ id: Number(row.id), employee_code: row.employee_code, name_en: row.name_en, name_ar: row.name_ar, work_email: row.work_email, employment_status: row.employment_status, company_id: row.company_id == null ? null : Number(row.company_id), branch_id: row.branch_id == null ? null : Number(row.branch_id), hr_user_id: row.hr_user_id == null ? null : Number(row.hr_user_id) }));
  const unlinkedHrAccounts = await readUnlinkedHrAccounts(db);

  return { occupants, hrScopes, legacyWorkLocations, hrRoster, hrEmployees, unlinkedHrAccounts };
}
