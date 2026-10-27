type Row = Record<string, unknown>;

const id = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

/** `{ id, …names }` or null when the row has no such reference. */
function ref(row: Row, prefix: string, extra: Record<string, string> = {}) {
  if (row[`${prefix}_id`] === null || row[`${prefix}_id`] === undefined) return null;
  return {
    id: id(row[`${prefix}_id`]),
    ...Object.fromEntries(Object.entries(extra).map(([key, column]) => [key, text(row[column])])),
    name_en: text(row[`${prefix}_name_en`]),
    name_ar: text(row[`${prefix}_name_ar`]),
  };
}

export function formatEmployee(row: Row) {
  return {
    id: id(row.id),
    employee_code: text(row.employee_code),
    name_en: text(row.name_en),
    name_ar: text(row.name_ar),
    work_email: text(row.work_email),
    work_phone: text(row.work_phone),
    employment_status: text(row.employment_status),
    employment_type: text(row.employment_type),
    start_date: text(row.start_date),
    work_country: text(row.work_country),
    company: ref(row, "company", { code: "company_code" }),
    branch: ref(row, "branch"),
    department: row.department_id === null ? null : { id: id(row.department_id), name_en: text(row.department_name_en), name_ar: text(row.department_name_ar) },
    section_id: id(row.section_id),
    team_id: id(row.team_id),
    job_title: ref(row, "job_title"),
    // The direct manager, else the unit's manager (the same rule approvals use).
    manager: ref(row, "manager", { employee_code: "manager_code" }),
    updated_at: iso(row.updated_at),
  };
}

export function formatDepartment(row: Row) {
  return {
    id: id(row.id),
    name_en: text(row.name_en),
    name_ar: text(row.name_ar),
    unit_type: text(row.unit_type),
    parent_id: id(row.parent_id),
    status: text(row.status),
    company: ref(row, "company", { code: "company_code" }),
    manager: ref(row, "manager", { employee_code: "manager_code" }),
    active_employees: Number(row.active_employees) || 0,
    updated_at: iso(row.updated_at),
  };
}

export function page<T>(data: T[], query: { page: number; pageSize: number }, total: number) {
  return { data, page: query.page, page_size: query.pageSize, total, has_more: query.page * query.pageSize < total };
}
