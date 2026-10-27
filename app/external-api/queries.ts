import type { PostgresDatabase } from "../../db/postgres";
import { EMPLOYEE_MANAGER_SQL } from "../employees/hr-assignment";
import type { PageQuery } from "./access";

type Row = Record<string, unknown>;

export type EmployeeFilters = PageQuery & {
  statuses: string[] | null;
  departmentId: number | null;
  companyId: number | null;
  updatedSince: string | null;
};

/** Demo records (TEST-…) stay hidden unless demo data is switched on, as on the HR screens. */
async function demoEnabled(db: PostgresDatabase) {
  const row = await db.prepare("SELECT value_json FROM system_settings WHERE setting_key='demo_data'").first<{ value_json: string }>();
  try {
    return Boolean(JSON.parse(row?.value_json || "{}").enabled);
  } catch {
    return false;
  }
}

// Work information only: no salary, identity, bank or personal details.
const EMPLOYEE_COLUMNS = `e.id,e.employee_code,e.name_en,e.name_ar,e.work_email,e.work_phone,e.employment_status,e.employment_type,
  e.start_date,e.country AS work_country,e.department_id,e.section_id,e.team_id,e.updated_at,
  co.id AS company_id,co.code AS company_code,co.name_en AS company_name_en,co.name_ar AS company_name_ar,
  br.id AS branch_id,br.name_en AS branch_name_en,br.name_ar AS branch_name_ar,
  d.name_en AS department_name_en,d.name_ar AS department_name_ar,
  j.id AS job_title_id,j.name_en AS job_title_name_en,j.name_ar AS job_title_name_ar,
  m.id AS manager_id,m.employee_code AS manager_code,m.name_en AS manager_name_en,m.name_ar AS manager_name_ar`;

export async function readEmployees(db: PostgresDatabase, filters: EmployeeFilters) {
  const conditions = ["e.employment_status<>'deleted'"];
  const args: unknown[] = [];
  if (!(await demoEnabled(db))) conditions.push("e.employee_code NOT LIKE 'TEST-%'");
  if (filters.statuses) {
    conditions.push(`e.employment_status IN (${filters.statuses.map(() => "?").join(",")})`);
    args.push(...filters.statuses);
  }
  // A department filter includes its sections and teams.
  if (filters.departmentId) {
    conditions.push("(e.department_id=? OR e.section_id=? OR e.team_id=?)");
    args.push(filters.departmentId, filters.departmentId, filters.departmentId);
  }
  if (filters.companyId) {
    conditions.push("e.company_id=?");
    args.push(filters.companyId);
  }
  if (filters.updatedSince) {
    conditions.push("e.updated_at>=?::timestamptz");
    args.push(filters.updatedSince);
  }
  const where = conditions.join(" AND ");
  const [rows, total] = await Promise.all([
    db
      .prepare(
        `SELECT ${EMPLOYEE_COLUMNS} FROM employees e
          LEFT JOIN companies co ON co.id=e.company_id LEFT JOIN branches br ON br.id=e.branch_id
          LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id
          LEFT JOIN employees m ON m.id=(${EMPLOYEE_MANAGER_SQL})
          WHERE ${where} ORDER BY e.id LIMIT ? OFFSET ?`,
      )
      .bind(...args, filters.pageSize, filters.offset)
      .all<Row>(),
    db.prepare(`SELECT COUNT(*)::int AS count FROM employees e WHERE ${where}`).bind(...args).first<{ count: number }>(),
  ]);
  return { rows: rows.results, total: Number(total?.count) || 0 };
}

export async function readDepartments(db: PostgresDatabase, filters: PageQuery & { companyId: number | null }) {
  const where = filters.companyId ? "WHERE d.company_id=?" : "";
  const args = filters.companyId ? [filters.companyId] : [];
  const [rows, total] = await Promise.all([
    db
      .prepare(
        `SELECT d.id,d.name_en,d.name_ar,d.unit_type,d.parent_id,d.status,d.updated_at,
          co.id AS company_id,co.code AS company_code,co.name_en AS company_name_en,co.name_ar AS company_name_ar,
          m.id AS manager_id,m.employee_code AS manager_code,m.name_en AS manager_name_en,m.name_ar AS manager_name_ar,
          (SELECT COUNT(*)::int FROM employees e WHERE e.employment_status IN ('active','probation','notice_period')
            AND (e.department_id=d.id OR e.section_id=d.id OR e.team_id=d.id)) AS active_employees
        FROM departments d LEFT JOIN companies co ON co.id=d.company_id LEFT JOIN employees m ON m.id=d.manager_employee_id
        ${where} ORDER BY d.id LIMIT ? OFFSET ?`,
      )
      .bind(...args, filters.pageSize, filters.offset)
      .all<Row>(),
    db.prepare(`SELECT COUNT(*)::int AS count FROM departments d ${where}`).bind(...args).first<{ count: number }>(),
  ]);
  return { rows: rows.results, total: Number(total?.count) || 0 };
}
