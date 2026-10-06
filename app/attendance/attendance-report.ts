import { attendanceWorkbook } from "./attendance-report-workbook.ts";
import type { PostgresDatabase } from "../../db/postgres";
import { ABSENCE_EXCEPTION_STATUS_SQL, dayDeduction, loadDeductionRules, summarizeAttendanceDeductions, type DeductionRule } from "./attendance-deductions.ts";

export type AttendanceReportFilters = { employeeId: number; from: string; to: string; country: string };

export const ATTENDANCE_REPORT_PAGE_SIZE = 50;
export const ATTENDANCE_REPORT_EXPORT_LIMIT = 20000;
const MAX_RANGE_DAYS = 366;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/** employeeId 0 means every employee and an empty country means every country; the period is mandatory and capped so one request stays bounded. */
export function parseAttendanceReportFilters(url: URL): AttendanceReportFilters {
  const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
  if (!validDate(from) || !validDate(to)) throw new Response("Invalid attendance report dates", { status: 400 });
  if (from > to) throw new Response("The start date must not be after the end date", { status: 400 });
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) throw new Response("The report period cannot exceed 366 days", { status: 400 });
  const rawEmployee = url.searchParams.get("employeeId") || "";
  const employeeId = rawEmployee ? Number(rawEmployee) : 0;
  if (!Number.isInteger(employeeId) || employeeId < 0) throw new Response("Invalid employee", { status: 400 });
  const country = (url.searchParams.get("country") || "").trim();
  if (country.length > 60) throw new Response("Invalid country", { status: 400 });
  return { employeeId, from, to, country };
}

const FROM_CLAUSE = "FROM daily_attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments dep ON dep.id=e.department_id WHERE e.employment_status!='deleted' AND a.work_date>=? AND a.work_date<=? AND (?=0 OR a.employee_id=?) AND (?='' OR e.country=?) AND (?::int[] IS NULL OR a.employee_id=ANY(?::int[]))";
/** `employeeIds` limits the report to those employees (a branch HR); null means every employee. */
const bindings = (filters: AttendanceReportFilters, employeeIds: number[] | null = null) => [filters.from, filters.to, filters.employeeId, filters.employeeId, filters.country, filters.country, employeeIds, employeeIds];
const ROW_COLUMNS = "a.id,a.work_date,a.scheduled_in,a.scheduled_out,a.actual_in,a.actual_out,a.worked_minutes,a.required_minutes,a.late_minutes,a.early_minutes,a.overtime_minutes,a.status,e.id AS employee_id,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar," + ABSENCE_EXCEPTION_STATUS_SQL;
const DEDUCTION_COLUMNS = "a.status,a.scheduled_in,a.actual_in,a.late_minutes,a.overtime_minutes," + ABSENCE_EXCEPTION_STATUS_SQL;

/** Adds the matched deduction rule and its cost in days of wage (and any fixed amount) to each row. */
const withDeductions = <T extends Record<string, unknown>>(rules: DeductionRule[], rows: T[]) => rows.map(row => {
  const deduction = dayDeduction(rules, row);
  return { ...row, deduction_rule_id: deduction?.rule.id ?? null, deduction_rule_en: deduction?.rule.name_en ?? null, deduction_rule_ar: deduction?.rule.name_ar ?? null, deduction_wage_days: deduction ? Math.round(deduction.wageDays * 10000) / 10000 : 0, deduction_fixed_amount: deduction?.fixedAmount ?? 0 };
});
const deductionTotals = async (db: PostgresDatabase, rules: DeductionRule[], filters: AttendanceReportFilters, employeeIds: number[] | null) => {
  const days = (await db.prepare("SELECT " + DEDUCTION_COLUMNS + " " + FROM_CLAUSE).bind(...bindings(filters, employeeIds)).all()).results;
  const totals = summarizeAttendanceDeductions(rules, days, 1);
  return { deduction_wage_days: Math.round(totals.wageDays * 10000) / 10000, deduction_fixed_amount: totals.fixedAmount };
};
const ORDER = " ORDER BY a.work_date,e.name_en,a.id";

/** One row per employee for the period: attendance, lateness, overtime and the deduction each employee owes. */
type EmployeeTotals = Record<string, unknown> & { attended_days: number; absent_days: number; leave_days: number; late_days: number; late_minutes: number; early_minutes: number; overtime_minutes: number; worked_minutes: number; deduction_wage_days: number; deduction_fixed_amount: number };
async function employeeTotals(db: PostgresDatabase, rules: DeductionRule[], filters: AttendanceReportFilters, employeeIds: number[] | null): Promise<EmployeeTotals[]> {
  const days = (await db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + ORDER).bind(...bindings(filters, employeeIds)).all()).results;
  const totals = new Map<number, EmployeeTotals>();
  for (const day of withDeductions(rules, days)) {
    const id = Number(day.employee_id);
    const row = totals.get(id) ?? { id, employee_id: id, employee_code: day.employee_code, employee_name: day.employee_name, employee_name_ar: day.employee_name_ar, department_name: day.department_name, department_name_ar: day.department_name_ar, attended_days: 0, absent_days: 0, leave_days: 0, late_days: 0, late_minutes: 0, early_minutes: 0, overtime_minutes: 0, worked_minutes: 0, deduction_wage_days: 0, deduction_fixed_amount: 0 };
    if (String(day.actual_in ?? "").trim()) row.attended_days++;
    if (day.status === "absent") row.absent_days++;
    if (day.status === "leave") row.leave_days++;
    if (Number(day.late_minutes) > 0) row.late_days++;
    row.late_minutes += Number(day.late_minutes) || 0; row.early_minutes += Number(day.early_minutes) || 0; row.overtime_minutes += Number(day.overtime_minutes) || 0; row.worked_minutes += Number(day.worked_minutes) || 0;
    row.deduction_wage_days += Number(day.deduction_wage_days) || 0; row.deduction_fixed_amount += Number(day.deduction_fixed_amount) || 0;
    totals.set(id, row);
  }
  return [...totals.values()].map((row): EmployeeTotals => ({ ...row, deduction_wage_days: Math.round(row.deduction_wage_days * 10000) / 10000 })).sort((a, b) => String(a.employee_name).localeCompare(String(b.employee_name)));
}

export async function readAttendanceReport(db: PostgresDatabase, filters: AttendanceReportFilters, page: number, employeeIds: number[] | null = null) {
  const safePage = Math.max(1, Math.min(100000, Math.floor(page) || 1));
  const rules = await loadDeductionRules(db);
  if (!filters.employeeId) {
    const employees = await employeeTotals(db, rules, filters, employeeIds);
    return { mode: "employees" as const, summary: {}, records: employees.slice((safePage - 1) * ATTENDANCE_REPORT_PAGE_SIZE, safePage * ATTENDANCE_REPORT_PAGE_SIZE), rules: rules.length, page: safePage, pageSize: ATTENDANCE_REPORT_PAGE_SIZE, total: employees.length };
  }
  const [summary, records, deductions] = await Promise.all([
    db.prepare("SELECT count(*)::integer AS total_rows,count(*) FILTER (WHERE NULLIF(BTRIM(a.actual_in),'') IS NOT NULL)::integer AS attended_days,count(*) FILTER (WHERE a.late_minutes>0)::integer AS late_days,COALESCE(sum(a.late_minutes),0)::integer AS late_minutes,count(*) FILTER (WHERE a.early_minutes>0)::integer AS early_days,COALESCE(sum(a.early_minutes),0)::integer AS early_minutes,count(*) FILTER (WHERE a.overtime_minutes>0)::integer AS overtime_days,COALESCE(sum(a.overtime_minutes),0)::integer AS overtime_minutes,COALESCE(sum(a.worked_minutes),0)::integer AS worked_minutes,count(*) FILTER (WHERE a.status='absent')::integer AS absent_days,count(*) FILTER (WHERE a.status='leave')::integer AS leave_days " + FROM_CLAUSE).bind(...bindings(filters, employeeIds)).first<Record<string, number>>(),
    db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + ORDER + " LIMIT ? OFFSET ?").bind(...bindings(filters, employeeIds), ATTENDANCE_REPORT_PAGE_SIZE, (safePage - 1) * ATTENDANCE_REPORT_PAGE_SIZE).all(),
    deductionTotals(db, rules, filters, employeeIds),
  ]);
  return { mode: "days" as const, summary: { ...summary, ...deductions }, records: withDeductions(rules, records.results), rules: rules.length, page: safePage, pageSize: ATTENDANCE_REPORT_PAGE_SIZE, total: Number(summary?.total_rows) || 0 };
}

const STATUS_AR: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", holiday: "عطلة رسمية", remote: "عن بُعد", needs_review: "يحتاج مراجعة", non_working_day: "يوم راحة", scheduled: "مجدول" };
const STATUS_EN: Record<string, string> = { present: "Present", late: "Late", absent: "Absent", leave: "On leave", holiday: "Official holiday", remote: "Remote", needs_review: "Needs review", non_working_day: "Non-working day", scheduled: "Scheduled" };

// A cell that starts with = + - @ is executed as a formula by spreadsheet apps.
const cell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

export const weekday = (day: unknown, arabic: boolean) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? new Intl.DateTimeFormat(arabic ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(String(day) + "T12:00:00Z")) : "";

/** Day-by-day punches for each employee, followed by that employee's totals: lateness, overtime and the deduction. */
export async function exportAttendanceReportCsv(db: PostgresDatabase, filters: AttendanceReportFilters, arabic: boolean, employeeIds: number[] | null = null) {
  const rules = await loadDeductionRules(db);
  const rows = await db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + " ORDER BY e.name_en,e.id,a.work_date,a.id LIMIT ?").bind(...bindings(filters, employeeIds), ATTENDANCE_REPORT_EXPORT_LIMIT).all();
  const statuses = arabic ? STATUS_AR : STATUS_EN;
  const header = arabic
    ? ["رقم الموظف", "الموظف", "القسم", "التاريخ", "اليوم", "الدوام من", "الدوام إلى", "الحضور", "الانصراف", "دقائق العمل", "دقائق التأخير", "دقائق الانصراف المبكر", "دقائق العمل الإضافي", "الحالة", "قاعدة الخصم", "الخصم (أيام من الأجر)", "الخصم (مبلغ ثابت)"]
    : ["Employee code", "Employee", "Department", "Date", "Day", "Scheduled in", "Scheduled out", "Check-in", "Check-out", "Worked minutes", "Late minutes", "Early departure minutes", "Overtime minutes", "Status", "Deduction rule", "Deduction (days of wage)", "Deduction (fixed amount)"];
  const lines = [header.map(cell).join(",")];
  const days = withDeductions(rules, rows.results);
  const employeeName = (row: Record<string, unknown>) => String((arabic ? row.employee_name_ar || row.employee_name : row.employee_name) ?? "");
  for (let start = 0; start < days.length;) {
    let end = start;
    while (end < days.length && days[end].employee_id === days[start].employee_id) end++;
    const group = days.slice(start, end);
    const sum = (key: string) => group.reduce((total, row) => total + (Number((row as Record<string, unknown>)[key]) || 0), 0);
    for (const row of group) {
      lines.push([
        row.employee_code, employeeName(row), (arabic ? row.department_name_ar : row.department_name) || "", row.work_date, weekday(row.work_date, arabic),
        row.scheduled_in, row.scheduled_out, row.actual_in, row.actual_out, row.worked_minutes ?? 0, row.late_minutes ?? 0, row.early_minutes ?? 0, row.overtime_minutes ?? 0,
        statuses[String(row.status)] || row.status,
        (arabic ? row.deduction_rule_ar : row.deduction_rule_en) || "", row.deduction_wage_days || "", row.deduction_fixed_amount || "",
      ].map(cell).join(","));
    }
    const lateDays = group.filter(row => Number(row.late_minutes) > 0).length;
    lines.push([
      group[0].employee_code, (arabic ? "إجمالي " : "Total · ") + employeeName(group[0]), (arabic ? group[0].department_name_ar : group[0].department_name) || "", "", "", "", "", "", "",
      sum("worked_minutes"), sum("late_minutes"), sum("early_minutes"), sum("overtime_minutes"),
      (arabic ? "أيام التأخير: " : "Late days: ") + lateDays, "", Math.round(sum("deduction_wage_days") * 10000) / 10000, sum("deduction_fixed_amount"),
    ].map(cell).join(","));
    start = end;
  }
  const scope = filters.employeeId ? String(rows.results[0]?.employee_code || filters.employeeId).replace(/[^A-Za-z0-9_-]/g, "") : filters.country ? filters.country.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase() : "all";
  return { csv: "\uFEFF" + lines.join("\r\n"), filename: `attendance-report-${scope}-${filters.from}-${filters.to}.csv`, total: rows.results.length };
}

/** Excel version of the export: a per-employee summary sheet plus a colour-coded daily sheet. */
export async function exportAttendanceReportWorkbook(db: PostgresDatabase, filters: AttendanceReportFilters, arabic: boolean, employeeIds: number[] | null = null) {
  const rules = await loadDeductionRules(db);
  const rows = await db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + " ORDER BY e.name_en,e.id,a.work_date,a.id LIMIT ?").bind(...bindings(filters, employeeIds), ATTENDANCE_REPORT_EXPORT_LIMIT).all();
  const totals = await employeeTotals(db, rules, filters, employeeIds);
  const bytes = attendanceWorkbook({ days: withDeductions(rules, rows.results), totals, from: filters.from, to: filters.to, arabic });
  const scope = filters.employeeId ? String(rows.results[0]?.employee_code || filters.employeeId).replace(/[^A-Za-z0-9_-]/g, "") : filters.country ? filters.country.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase() : "all";
  return { bytes, filename: `attendance-report-${scope}-${filters.from}-${filters.to}.xlsx`, total: rows.results.length };
}
