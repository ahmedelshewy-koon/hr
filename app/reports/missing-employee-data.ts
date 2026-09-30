type RequiredField = { key: string; en: string; ar: string; missing: string };
const textField = (key: string, en: string, ar: string): RequiredField => ({ key, en, ar, missing: `NULLIF(BTRIM(e.${key}),'') IS NULL` });
const referenceField = (key: string, en: string, ar: string): RequiredField => ({ key, en, ar, missing: `e.${key} IS NULL` });

// Required by the employee wizard/backend, plus the company and HR completion
// requirements. Optional contact, identity, payroll and work-location data is excluded.
export const requiredEmployeeFields: RequiredField[] = [
  textField("name_ar", "Arabic name", "الاسم بالعربية"),
  textField("name_en", "English name", "الاسم بالإنجليزية"),
  textField("work_email", "Work email", "البريد الوظيفي"),
  referenceField("department_id", "Department", "القسم"),
  referenceField("job_title_id", "Job title", "المسمى الوظيفي"),
  textField("start_date", "Start date", "تاريخ المباشرة"),
  textField("end_date", "Contract end date", "تاريخ نهاية العقد"),
  textField("country", "Country", "الدولة"),
  { key: "company_id", en: "Company", ar: "الشركة", missing: "NOT EXISTS (SELECT 1 FROM companies co WHERE co.id=e.company_id AND co.status='active')" },
  { key: "hr_user_id", en: "HR responsible", ar: "مسؤول الموارد البشرية", missing: "NOT EXISTS (SELECT 1 FROM hr_responsibles h JOIN users hu ON hu.id=h.user_id JOIN roles hr ON hr.id=hu.role_id LEFT JOIN employees he ON he.id=hu.employee_id WHERE h.user_id=e.hr_user_id AND h.status='active' AND hu.status='active' AND hr.name IN ('HR Manager','Super Admin') AND hu.employee_id IS NOT NULL AND hu.employee_id<>e.id AND he.employment_status IN ('active','probation','notice_period'))" },
  { key: "access_role", en: "Access role", ar: "دور المستخدم", missing: "NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.employee_id=e.id)" },
  { key: "leave_types", en: "Assigned leave types", ar: "أنواع الإجازات المسندة", missing: "NOT EXISTS (SELECT 1 FROM employee_leave_types elt JOIN leave_types lt ON lt.id=elt.leave_type_id WHERE elt.employee_id=e.id)" },
];

export const MISSING_EMPLOYEE_LIMIT = 10000;
export const MISSING_EMPLOYEE_COLUMNS = ["employee_code", "employee_name", "company", "work_location", "missing_fields"];

/** The missing filter precedes the cap, so complete employees never consume it. */
export function missingEmployeeQuery(where: string[], hrSql="e.hr_user_id") {
  const missing = requiredEmployeeFields.map(field => `CASE WHEN ${field.missing.replaceAll("e.hr_user_id",hrSql)} THEN '${field.key}' END`).join(",");
  return `SELECT * FROM (
    SELECT e.id,e.employee_code,e.name_en,e.name_ar,c.name AS company,e.work_location,
      ARRAY_REMOVE(ARRAY[${missing}],NULL) AS missing_keys
    FROM employees e LEFT JOIN companies c ON c.id=e.company_id
    WHERE e.employment_status!='deleted' AND ${where.join(" AND ") || "1=1"}
  ) incomplete WHERE CARDINALITY(missing_keys)>0 ORDER BY id LIMIT ${MISSING_EMPLOYEE_LIMIT + 1}`;
}

export function missingEmployeeRows(rows: Record<string, unknown>[], arabic: boolean) {
  return rows.map(row => ({
    employee_code: row.employee_code ?? "",
    employee_name: (arabic ? row.name_ar || row.name_en : row.name_en || row.name_ar) ?? "",
    company: row.company ?? "",
    work_location: row.work_location ?? "",
    missing_fields: requiredEmployeeFields.filter(field => Array.isArray(row.missing_keys) && row.missing_keys.includes(field.key)).map(field => field[arabic ? "ar" : "en"]).join(arabic ? "، " : ", "),
  }));
}
